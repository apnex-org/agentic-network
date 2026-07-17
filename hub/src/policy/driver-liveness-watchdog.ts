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

export interface DriverChildProgressFingerprint {
  status: WorkItemPhase | "missing";
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
  | "no_progress_with_ready_action";

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

  if (!ACTIVE_DRIVER_STATES.has(input.driver.status) || !input.driver.lease) {
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
      return event.driverProgressKind === "role_lane_dispatch"
        && event.sourceDriverId === input.driver.id
        && Boolean(event.childId)
        && Boolean(event.targetRole)
        && Boolean(event.reason?.trim());
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

export function fingerprintWorkItemForDriverProgress(item: WorkItem): DriverChildProgressFingerprint {
  return {
    status: item.status,
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
  if (parseTime(item.enteredCurrentStateAt) <= parseTime(baselineAt)) return false;

  const current = fingerprintWorkItemForDriverProgress(item);
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

function hasCallerGate(projection: NextActionProjection): boolean {
  return projection.nextAction === null
    && projection.readyCandidates > 0
    && (projection.emptyReason === "wip_capped" || projection.emptyReason === "quarantined");
}

function isLiveInFlight(child: WorkItem, now: string): boolean {
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
