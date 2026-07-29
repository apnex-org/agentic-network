/**
 * Pure DriverLivenessWatchdog evaluator (bug-289 / driver_liveness_watchdog_impl0).
 *
 * This module deliberately has no repository or Message side effects.  It decides
 * whether a held WorkGraph driver has made graph-factual progress since a durable
 * baseline, and whether a concrete next action / role lane should trigger a
 * liveness warning.  It treats lease renewals, message ack/claim, reads, stale
 * notifications, and `updatedAt` churn as non-progress by construction.
 */
import type { NextActionProjection, WorkItem, WorkItemBlockedOn, WorkItemPhase } from "../entities/work-item.js";
import type { Selector } from "../state.js";
import { isParkedFromExecution } from "../entities/work-item-repository-substrate.js";

export type DriverProgressEventKind =
  | "workitem_transition"
  | "role_lane_dispatch"
  | "blocker_persisted"
  | "graph_no_action_proof"
  // Explicit non-progress classes.  Keeping them in the type makes tests and
  // future sweeper wiring prove they are ignored rather than accidentally
  // falling through as generic activity.
  | "renew_lease"
  | "message_claim"
  | "message_ack"
  | "state_read"
  | "stale_notification"
  | "updated_at";

export interface DriverProgressEvent {
  kind: DriverProgressEventKind;
  occurredAt: string;
  arcId: string;
  childId?: string;
  fromStatus?: WorkItemPhase;
  toStatus?: WorkItemPhase;
  driverProgressKind?: "role_lane_dispatch";
  targetRole?: string;
  targetAgentId?: string | null;
  sourceDriverId?: string;
  reason?: string;
  blocker?: { kind: string; ids?: string[]; reason: string };
  /** Required for graph_no_action_proof: the Hub recomputed it from current graph truth. */
  graphLocal?: boolean;
}

/**
 * Typed persisted role-lane dispatch payload.  A prose-only note must never be
 * treated as DriverProgress; every field below is load-bearing evidence that the
 * controller routed a concrete legal lane.
 */
export interface DriverRoleLaneDispatchPayload {
  driverProgressKind: "role_lane_dispatch";
  arcId: string;
  childId: string;
  targetRole: string;
  targetAgentId?: string | null;
  sourceDriverId: string;
  reason: string;
}

export interface DriverChildProgressFingerprint {
  status: WorkItemPhase | "missing";
  /** bug-423 F9 face 3: suspension leaves status/holder/evidence untouched, so without
   *  this field pause and unpause are INVISIBLE to progress detection. */
  suspended?: boolean;
  leaseHolder: string | null;
  blockedOnKey: string | null;
  evidenceCount: number;
}

export interface DriverLivenessBaseline {
  /** Durable baseline instant.  Progress at or before this instant does not reset the watchdog. */
  recordedAt: string;
  /** Optional child snapshot from the last evaluation/progress reset. */
  childFingerprints?: Record<string, DriverChildProgressFingerprint>;
  /** Optional driver snapshot from the last evaluation/progress reset. */
  driverFingerprint?: DriverChildProgressFingerprint;
}

export interface DriverRoleLaneProjection {
  role: string;
  projection: NextActionProjection;
}

export interface DriverLivenessWatchdogInput {
  driver: WorkItem;
  children: WorkItem[];
  /** Projection for work the driver holder can claim/advance directly. */
  driverNextAction: NextActionProjection;
  /** Other-role lanes the driver may need to dispatch/handoff. */
  roleLaneNextActions?: DriverRoleLaneProjection[];
  baseline: DriverLivenessBaseline;
  now: string;
  thresholdMs: number;
  progressEvents?: DriverProgressEvent[];
}

export type DriverLivenessWatchdogStatus = "ok" | "suppressed" | "warning";
export type DriverLivenessWatchdogReason =
  | "driver_not_active"
  | "progress_since_baseline"
  | "in_flight_child"
  | "blocked_child"
  | "caller_gated"
  | "no_graph_action"
  | "threshold_not_elapsed"
  | "no_progress_with_ready_action"
  // bug-423 F9: DELIBERATELY PARKED is a different state from "nobody is picking up
  // available work". Collapsing them is what made the watchdog either cry wolf over a
  // fenced arc or (worse) go silent on a real stall.
  | "all_remaining_work_parked";

export interface DriverLivenessActionRef {
  kind: "driver_next_action" | "role_lane_ready";
  childId: string;
  role?: string;
  readyCandidates: number;
}

export interface DriverLivenessWatchdogVerdict {
  status: DriverLivenessWatchdogStatus;
  reason: DriverLivenessWatchdogReason;
  arcId: string;
  holder: string | null;
  elapsedMs: number;
  action?: DriverLivenessActionRef;
  progress?: DriverProgressEvidence;
  childStatuses: Array<{
    id: string;
    status: WorkItemPhase;
    /** bug-423: suspension leaves `status` untouched, so a fenced row reports `ready`.
     *  This field is what stops that reading as claimable. */
    suspended: boolean;
    leaseHolder: string | null;
    blockedOn: WorkItemBlockedOn | null;
  }>;
}

export interface DriverProgressEvidence {
  source: "event" | "snapshot";
  kind: string;
  occurredAt?: string;
  childId?: string;
  details?: string;
}

const ACTIVE_DRIVER_STATES = new Set<WorkItemPhase>(["claimed", "in_progress", "blocked", "review"]);
const IN_FLIGHT_CHILD_STATES = new Set<WorkItemPhase>(["claimed", "in_progress", "review"]);
const NON_PROGRESS_EVENT_KINDS = new Set<DriverProgressEventKind>([
  "renew_lease",
  "message_claim",
  "message_ack",
  "state_read",
  "stale_notification",
  "updated_at",
]);

export function evaluateDriverLivenessWatchdog(input: DriverLivenessWatchdogInput): DriverLivenessWatchdogVerdict {
  const elapsedMs = Math.max(0, parseTime(input.now) - parseTime(input.baseline.recordedAt));
  const holder = input.driver.lease?.holder ?? null;
  const childStatuses = input.children.map((child) => ({
    id: child.id,
    status: child.status,
    // 🔴 bug-423: a projection reporting status:"ready" for a FENCED row lies to every
    // consumer. Suspension leaves `status` untouched, so without this field the two are
    // indistinguishable in the verdict.
    suspended: isParkedFromExecution(child),
    leaseHolder: child.lease?.holder ?? null,
    blockedOn: child.blockedOn,
  }));

  const baseVerdict = (status: DriverLivenessWatchdogStatus, reason: DriverLivenessWatchdogReason, extra: Partial<DriverLivenessWatchdogVerdict> = {}): DriverLivenessWatchdogVerdict => ({
    status,
    reason,
    arcId: input.driver.id,
    holder,
    elapsedMs,
    childStatuses,
    ...extra,
  });

  // 🔴 bug-423 F9 face 2: a SUSPENDED DRIVER keeps its active status and its lease, so
  // it passed this test and the watchdog kept evaluating an arc nobody was driving.
  if (isParkedFromExecution(input.driver) || !ACTIVE_DRIVER_STATES.has(input.driver.status) || !input.driver.lease) {
    return baseVerdict("ok", "driver_not_active");
  }

  const progress = findDriverProgress(input);
  if (progress) return baseVerdict("ok", "progress_since_baseline", { progress });

  const action = findGraphAction(input);
  if (!action) {
    const inFlight = input.children.find((child) => isLiveInFlight(child, input.now));
    if (inFlight) {
      return baseVerdict("suppressed", "in_flight_child", {
        progress: { source: "snapshot", kind: "in_flight_child", childId: inFlight.id },
      });
    }

    const blocked = input.children.find(hasConcreteBlocker);
    if (blocked) {
      return baseVerdict("suppressed", "blocked_child", {
        progress: {
          source: "snapshot",
          kind: "blocked_child",
          childId: blocked.id,
          details: blocked.blockedOn?.reason,
        },
      });
    }

    if (hasCallerGate(input.driverNextAction) || (input.roleLaneNextActions ?? []).some((lane) => hasCallerGate(lane.projection))) {
      return baseVerdict("suppressed", "caller_gated");
    }

    // 🔴 bug-423: "everything left is DELIBERATELY PARKED" is a DIFFERENT state from
    // "nobody is picking up available work", and collapsing them is what made this
    // watchdog untrustworthy in both directions. This is ACCURACY, NOT SUPPRESSION —
    // the verdict is still `ok`, but it now says WHY, and it only fires when EVERY
    // remaining child is parked. An arc with a parked child AND genuinely claimable
    // sibling work does not reach here: it takes the ready-action path above.
    const remaining = input.children.filter((child) => child.status !== "done" && child.status !== "abandoned");
    if (remaining.length > 0 && remaining.every((child) => isParkedFromExecution(child))) {
      return baseVerdict("ok", "all_remaining_work_parked");
    }

    return baseVerdict("ok", "no_graph_action");
  }

  if (elapsedMs < input.thresholdMs) {
    return baseVerdict("ok", "threshold_not_elapsed", { action });
  }

  return baseVerdict("warning", "no_progress_with_ready_action", { action });
}

export function findDriverProgress(input: DriverLivenessWatchdogInput): DriverProgressEvidence | null {
  const eventProgress = (input.progressEvents ?? []).find((event) => isDriverProgressEvent(event, input));
  if (eventProgress) {
    return {
      source: "event",
      kind: eventProgress.kind,
      occurredAt: eventProgress.occurredAt,
      childId: eventProgress.childId,
      details: eventProgress.reason,
    };
  }

  const driverSnapshotProgress = hasSnapshotProgress(input.driver, input.baseline.driverFingerprint, input.baseline.recordedAt);
  if (driverSnapshotProgress) {
    return { source: "snapshot", kind: "driver_state", childId: input.driver.id };
  }

  for (const child of input.children) {
    const baselineFingerprint = input.baseline.childFingerprints?.[child.id];
    if (hasSnapshotProgress(child, baselineFingerprint, input.baseline.recordedAt)) {
      return { source: "snapshot", kind: "child_state", childId: child.id };
    }
  }

  return null;
}

export function isDriverProgressEvent(event: DriverProgressEvent, input: DriverLivenessWatchdogInput): boolean {
  if (event.arcId !== input.driver.id) return false;
  if (parseTime(event.occurredAt) <= parseTime(input.baseline.recordedAt)) return false;
  if (NON_PROGRESS_EVENT_KINDS.has(event.kind)) return false;

  switch (event.kind) {
    case "workitem_transition":
      return Boolean(event.childId) && Boolean(event.fromStatus) && Boolean(event.toStatus) && event.fromStatus !== event.toStatus;
    case "role_lane_dispatch":
      return isTypedRoleLaneDispatchProgressEvent(event, input.driver.id);
    case "blocker_persisted":
      return Boolean(event.childId) && Boolean(event.blocker?.kind?.trim()) && Boolean(event.blocker?.reason?.trim());
    case "graph_no_action_proof":
      return event.graphLocal === true
        && !findGraphAction(input)
        && !hasCallerGate(input.driverNextAction)
        && !(input.roleLaneNextActions ?? []).some((lane) => hasCallerGate(lane.projection));
    default:
      return false;
  }
}

export function isTypedRoleLaneDispatchProgressEvent(
  event: DriverProgressEvent,
  arcId: string,
): event is DriverProgressEvent & DriverRoleLaneDispatchPayload {
  return event.kind === "role_lane_dispatch"
    && event.driverProgressKind === "role_lane_dispatch"
    && event.arcId === arcId
    && event.sourceDriverId === arcId
    && Boolean(event.childId?.trim())
    && Boolean(event.targetRole?.trim())
    && Boolean(event.reason?.trim())
    // targetAgentId is optional/null for a role lane, but if present it must be non-empty.
    && (event.targetAgentId == null || event.targetAgentId.trim().length > 0);
}

export function fingerprintWorkItemForDriverProgress(item: WorkItem): DriverChildProgressFingerprint {
  return {
    status: item.status,
    // 🔴 bug-423 F9 face 3: WITHOUT THIS, pause/unpause is INVISIBLE to progress
    // detection whenever phase, holder and evidence are unchanged — which is the normal
    // case, since suspension leaves all three alone. A fence and a lift both registered
    // as "nothing happened".
    suspended: item.suspended === true,
    leaseHolder: item.lease?.holder ?? null,
    blockedOnKey: blockedOnKey(item.blockedOn),
    evidenceCount: item.evidence.length,
  };
}

function hasSnapshotProgress(
  item: WorkItem,
  baselineFingerprint: DriverChildProgressFingerprint | undefined,
  baselineAt: string,
): boolean {
  const current = fingerprintWorkItemForDriverProgress(item);

  // 🔴 bug-461 / nodestate0b F2 — SUSPENSION IS AN ATTRIBUTE FLIP, NOT A PHASE DWELL, SO THE
  // DWELL GUARD BELOW MUST NOT ADJUDICATE IT.
  //
  // MEASURED, not reasoned: with the comparator fix alone, 28 of 40 real `pauseWork` calls were
  // still MISSED. `enteredCurrentStateAt` only moves if a millisecond happens to tick between the
  // row entering its phase and being suspended — suspension does not change the phase, so the
  // marker is not advanced BY the suspension, only incidentally by the clock. At substrate speed
  // the two land in the same millisecond ~70% of the time and `entered <= baselineAt` holds, so
  // the function returned false BEFORE ever reaching the comparator.
  //
  // WHY BYPASSING THE GUARD IS CORRECT HERE: the guard exists to stop `updatedAt`/heartbeat churn
  // on a still-`ready` row reading as progress. A suspension FLIP is the opposite of churn — it is
  // a deliberate management act and the single most decision-relevant thing that can happen to a
  // row a liveness watchdog is watching. It is graph-factual by construction: the field only
  // changes when someone withdrew or restored the row.
  //
  // This is checked BEFORE the dwell return; every other field stays behind it, unchanged.
  if (baselineFingerprint && current.suspended !== baselineFingerprint.suspended) return true;

  if (parseTime(item.enteredCurrentStateAt) <= parseTime(baselineAt)) return false;

  if (!baselineFingerprint) {
    // A state other than ready after the baseline is a graph transition.  A
    // still-ready row may simply be old ready work with an updatedAt churn and
    // must not be progress.
    return item.status !== "ready";
  }

  // Intentionally compare only graph-factual fields.  updatedAt and lease
  // heartbeat are not in the fingerprint, so renew/read/ack churn cannot reset
  // the watchdog baseline.
  return current.status !== baselineFingerprint.status
    || current.leaseHolder !== baselineFingerprint.leaseHolder
    || current.blockedOnKey !== baselineFingerprint.blockedOnKey
    || current.evidenceCount !== baselineFingerprint.evidenceCount;
  // 🔴 bug-423 F9-3 — `suspended` IS DELIBERATELY NOT COMPARED HERE. It is decided ABOVE,
  // before the dwell guard, because the guard would otherwise swallow it (see bug-461).
  // A duplicate `|| current.suspended !== baselineFingerprint.suspended` on this line was
  // written first and then REMOVED: the pre-guard check strictly subsumes it — every case
  // that could reach here with a differing `suspended` has already returned true — so the
  // clause was unkillable by mutation. An assertion no mutation can red is not a guard, and
  // leaving one in a fix for "the field was stored and never read" would have shipped that
  // same defect in a new coat. Measured: reverting the clause reddened nothing.
}

function findGraphAction(input: DriverLivenessWatchdogInput): DriverLivenessActionRef | undefined {
  if (input.driverNextAction.nextAction) {
    return {
      kind: "driver_next_action",
      childId: input.driverNextAction.nextAction.id,
      readyCandidates: input.driverNextAction.readyCandidates,
    };
  }

  for (const lane of input.roleLaneNextActions ?? []) {
    if (!lane.projection.nextAction) continue;
    return {
      kind: "role_lane_ready",
      childId: lane.projection.nextAction.id,
      role: lane.role,
      readyCandidates: lane.projection.readyCandidates,
    };
  }

  return undefined;
}

/**
 * work-593 — 🔴 THIS FUNCTION IS WHY THE ARC WENT QUIET.
 *
 * A `suppressed/caller_gated` verdict means "there is ready work, the seat cannot take it,
 * and that is FINE". That is true for a WIP-capped seat, which is busy by construction. It
 * was catastrophically FALSE for a claim-thrash-quarantined one: the seat could not work at
 * ALL, only an architect could release it, and this branch is what stopped anyone being told.
 * The mechanism that locked a seat out ALSO SILENCED THE ALARM FOR IT — the arc's liveness
 * signal disappeared exactly when it mattered most.
 *
 * ⚠️ THE WIP-CAP TERM STAYS, AND THAT IS LOAD-BEARING. Deleting this function outright would
 * also make `no_progress_with_ready_action` "reachable", and would be WRONG: every WIP-capped
 * driver would start emitting a warning about work it is already busy doing. The removal has
 * to be the quarantine term ONLY, which is why the falsifier below asserts BOTH directions —
 * quarantine no longer suppresses AND wip_capped still does. One assertion alone passes for
 * the wrong implementation.
 */
function hasCallerGate(projection: NextActionProjection): boolean {
  return projection.nextAction === null
    && projection.readyCandidates > 0
    && projection.emptyReason === "wip_capped";
}

function isLiveInFlight(child: WorkItem, now: string): boolean {
  // 🔴 bug-423 F9 face 1: a SUSPENDED child RETAINS its lease, so without this the
  // watchdog read it as live in-flight work and SUPPRESSED the warning — silence caused
  // by the very act of parking. Suspension is withdrawal from execution; a withdrawn row
  // is not in flight however healthy its lease looks.
  if (isParkedFromExecution(child)) return false;
  if (!IN_FLIGHT_CHILD_STATES.has(child.status)) return false;
  if (!child.lease) return false;
  return parseTime(child.lease.expiresAt) > parseTime(now);
}

function hasConcreteBlocker(child: WorkItem): boolean {
  return child.status === "blocked"
    && Boolean(child.blockedOn?.blockerKind?.trim())
    && Boolean(child.blockedOn?.reason?.trim());
}

function blockedOnKey(blockedOn: WorkItemBlockedOn | null): string | null {
  if (!blockedOn) return null;
  return `${blockedOn.blockerKind}|${(blockedOn.blockerIds ?? []).join(",")}|${blockedOn.reason}`;
}

function parseTime(value: string): number {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new Error(`invalid ISO timestamp: ${value}`);
  return ms;
}

export interface DriverLivenessWarningMessagePayload {
  body: string;
  notificationEvent: "driver-liveness-watchdog-warning";
  arcId: string;
  holder: string | null;
  reason: DriverLivenessWatchdogReason;
  action?: DriverLivenessActionRef;
  baselineRecordedAt: string;
  elapsedMs: number;
  childStatuses: DriverLivenessWatchdogVerdict["childStatuses"];
  truncatedCandidateScan?: boolean;
}

export interface DriverLivenessWatchdogSweepResult {
  evaluated: number;
  warnings: number;
  skipped: number;
  truncatedCandidateScan: boolean;
}

export interface DriverLivenessWatchdogSweeperOptions {
  intervalMs?: number;
  thresholdMs?: number;
  logger?: Pick<Console, "warn" | "log">;
}

export interface DriverLivenessWatchdogSweeperDeps {
  workItem: Pick<import("../entities/work-item.js").IWorkItemStore, "listWorkItems" | "getWorkItem" | "getNextAction" | "withTopologyReadPin">;
  message: Pick<import("../entities/message.js").IMessageStore, "createMessage">;
  engineerRegistry: Pick<import("../state.js").IEngineerRegistry, "getAgent">;
  dispatch?: (event: string, data: Record<string, unknown>, selector: Selector) => Promise<void>;
  now?: () => string;
}

const WATCHDOG_ACTIVE_STATUSES: WorkItemPhase[] = ["claimed", "in_progress", "blocked", "review"];
const DEFAULT_WATCHDOG_INTERVAL_MS = 60_000;
const DEFAULT_WATCHDOG_THRESHOLD_MS = 10 * 60_000;

export class DriverLivenessWatchdogSweeper {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly intervalMs: number;
  private readonly thresholdMs: number;
  private readonly logger: Pick<Console, "warn" | "log">;

  constructor(
    private readonly deps: DriverLivenessWatchdogSweeperDeps,
    options: DriverLivenessWatchdogSweeperOptions = {},
  ) {
    this.intervalMs = options.intervalMs ?? DEFAULT_WATCHDOG_INTERVAL_MS;
    this.thresholdMs = options.thresholdMs ?? DEFAULT_WATCHDOG_THRESHOLD_MS;
    this.logger = options.logger ?? console;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.sweepOnce().catch((err) => this.logger.warn(`[DriverLivenessWatchdogSweeper] sweep failed: ${(err as Error)?.message ?? String(err)}`));
    }, this.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  async sweepOnce(): Promise<DriverLivenessWatchdogSweepResult> {
    if (this.running) return { evaluated: 0, warnings: 0, skipped: 0, truncatedCandidateScan: false };
    this.running = true;
    try {
      const runPinned = async (): Promise<DriverLivenessWatchdogSweepResult> => {
        const now = this.deps.now?.() ?? new Date().toISOString();
        const { candidates, truncated } = await this.listCandidateDrivers();
        let evaluated = 0;
        let warnings = 0;
        let skipped = 0;

      for (const driver of candidates) {
        const holder = driver.lease?.holder;
        if (!holder || driver.completionDependsOn.length === 0) {
          skipped += 1;
          continue;
        }

        const holderAgent = await this.deps.engineerRegistry.getAgent(holder);
        const holderRole = holderAgent?.role;
        if (!holderRole) {
          skipped += 1;
          continue;
        }

        const children = (await Promise.all(driver.completionDependsOn.map((id) => this.deps.workItem.getWorkItem(id)))).filter((child): child is WorkItem => Boolean(child));
        const driverNextAction = await this.deps.workItem.getNextAction(driver.id, holderRole, holder);
        if (!driverNextAction) {
          skipped += 1;
          continue;
        }
        const roleLaneNextActions = await this.roleLaneProjections(driver, children, holderRole);
        const baseline = deriveDriverLivenessBaseline(driver, children);
        const verdict = evaluateDriverLivenessWatchdog({
          driver,
          children,
          driverNextAction,
          roleLaneNextActions,
          baseline,
          now,
          thresholdMs: this.thresholdMs,
        });
        evaluated += 1;
        if (verdict.status !== "warning") continue;
        await this.emitWarning(verdict, baseline, truncated);
        warnings += 1;
      }

        if (truncated) this.logger.warn("[DriverLivenessWatchdogSweeper] candidate scan hit a listWorkItems cap; warning coverage may be incomplete");
        return { evaluated, warnings, skipped, truncatedCandidateScan: truncated };
      };
      return this.deps.workItem.withTopologyReadPin
        ? await this.deps.workItem.withTopologyReadPin(runPinned)
        : await runPinned();
    } finally {
      this.running = false;
    }
  }

  private async listCandidateDrivers(): Promise<{ candidates: WorkItem[]; truncated: boolean }> {
    const byId = new Map<string, WorkItem>();
    let truncated = false;
    for (const status of WATCHDOG_ACTIVE_STATUSES) {
      const page = await this.deps.workItem.listWorkItems({ status });
      truncated = truncated || page.truncated;
      for (const item of page.items) {
        if (item.lease && item.completionDependsOn.length > 0) byId.set(item.id, item);
      }
    }
    return { candidates: [...byId.values()], truncated };
  }

  private async roleLaneProjections(driver: WorkItem, children: WorkItem[], holderRole: string): Promise<DriverRoleLaneProjection[]> {
    const roles = new Set<string>();
    for (const child of children) {
      for (const role of child.roleEligibility) {
        if (role !== holderRole) roles.add(role);
      }
    }
    const projections: DriverRoleLaneProjection[] = [];
    for (const role of roles) {
      const projection = await this.deps.workItem.getNextAction(driver.id, role);
      if (projection) projections.push({ role, projection });
    }
    return projections;
  }

  private async emitWarning(verdict: DriverLivenessWatchdogVerdict, baseline: DriverLivenessBaseline, truncatedCandidateScan: boolean): Promise<void> {
    const migrationSourceId = driverLivenessWarningMigrationSourceId(verdict, baseline);
    const payload = warningPayload(verdict, baseline, truncatedCandidateScan);
    const message = await this.deps.message.createMessage({
      kind: "external-injection",
      authorRole: "system",
      authorAgentId: "driver-liveness-watchdog",
      target: { role: "architect" },
      delivery: "push-immediate",
      intent: "driver_liveness_warning",
      migrationSourceId,
      payload,
    });
    await this.deps.dispatch?.("message_arrived", { message, projection: undefined, body: payload.body }, { roles: ["architect"] });
  }
}

export function deriveDriverLivenessBaseline(driver: WorkItem, children: WorkItem[]): DriverLivenessBaseline {
  const all = [driver, ...children];
  const latest = all.reduce((max, item) => Math.max(max, parseTime(item.enteredCurrentStateAt)), 0);
  return {
    recordedAt: new Date(latest).toISOString(),
    driverFingerprint: fingerprintWorkItemForDriverProgress(driver),
    childFingerprints: Object.fromEntries(children.map((child) => [child.id, fingerprintWorkItemForDriverProgress(child)])),
  };
}

export function driverLivenessWarningMigrationSourceId(verdict: DriverLivenessWatchdogVerdict, baseline: DriverLivenessBaseline): string {
  const action = verdict.action ? `${verdict.action.kind}:${verdict.action.childId}:${verdict.action.role ?? "self"}` : "no-action";
  return `driver-liveness-watchdog:${verdict.arcId}:${baseline.recordedAt}:${action}`;
}

export function warningPayload(
  verdict: DriverLivenessWatchdogVerdict,
  baseline: DriverLivenessBaseline,
  truncatedCandidateScan = false,
): DriverLivenessWarningMessagePayload {
  const actionText = verdict.action
    ? `${verdict.action.kind} child=${verdict.action.childId}${verdict.action.role ? ` role=${verdict.action.role}` : ""}`
    : "no concrete action";
  return {
    body: `Driver liveness warning: ${verdict.arcId} holder=${verdict.holder ?? "none"} has ${actionText}; no graph progress since ${baseline.recordedAt}. renew/ack/read/updatedAt do not count as progress.`,
    notificationEvent: "driver-liveness-watchdog-warning",
    arcId: verdict.arcId,
    holder: verdict.holder,
    reason: verdict.reason,
    ...(verdict.action ? { action: verdict.action } : {}),
    baselineRecordedAt: baseline.recordedAt,
    elapsedMs: verdict.elapsedMs,
    childStatuses: verdict.childStatuses,
    ...(truncatedCandidateScan ? { truncatedCandidateScan: true } : {}),
  };
}
