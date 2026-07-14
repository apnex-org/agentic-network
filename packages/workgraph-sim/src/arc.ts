/**
 * arc.ts — the whole-arc headless simulator (idea-449 Phase B / B1).
 *
 * Phase A proved single-item FSM conformance. This drives a WHOLE ARC — a graph of
 * WorkItems wired by `dependsOn` (readiness) and `completionDependsOn` (completion
 * gates) — to all-done through the REAL engine, in seconds, so a mega-arc can be
 * dress-rehearsed before it seeds (design-of-record §1/§7).
 *
 * A scenario is a logical DAG (`ArcNode[]`, ids are sim-local). The sim:
 *   1. topologically orders the nodes (a dependency cycle is reported as deadlock,
 *      never a hang);
 *   2. creates every WorkItem in dependency order, translating logical ids → the real
 *      ids `create_work` mints;
 *   3. plays the arc: a node is DRIVABLE once its `dependsOn` AND `completionDependsOn`
 *      are all done; each drivable node is driven claim→start→complete to `done` (one
 *      at a time, so the per-agent WIP cap is never a factor — concurrency/poison chaos
 *      is a Phase-B property, not the driver's concern). A pass with no progress and
 *      unfinished nodes is a DEADLOCK finding.
 *
 * SCOPE (B1 first increment): TASK nodes. Verifier-gate nodes (the review→attest
 * cycle, bug-220) are the next B1 increment — NOT silently skipped: a `gate: true`
 * node throws `notImplemented` here so a scenario that needs one fails loudly.
 */
import { SimHarness } from "./harness.js";
import { SimClient } from "./clients.js";
import type { Phase } from "./spec-table.js";

export type ArcRole = "engineer" | "architect" | "verifier";

/** One node in an arc scenario. `id` is sim-local; deps reference other nodes' ids. */
export interface ArcNode {
  readonly id: string;
  /** executor role-eligibility (default "engineer"). */
  readonly role?: ArcRole;
  /** readiness gate — this node cannot be claimed until these are done. */
  readonly dependsOn?: readonly string[];
  /** completion gate — this node cannot complete until these are done. */
  readonly completionDependsOn?: readonly string[];
  /** verifier-gate node (review→attest cycle). NOT yet supported in B1 (throws). */
  readonly gate?: boolean;
}

export interface ArcScenario {
  readonly nodes: readonly ArcNode[];
}

export interface ArcRunResult {
  /** logical ids that reached `done`, in completion order. */
  readonly done: string[];
  /** logical ids that never completed (present ⇒ deadlock). */
  readonly stuck: string[];
  readonly deadlock: boolean;
  /** scheduler passes taken (observability; bounded). */
  readonly steps: number;
}

/** Kahn topological order over `dependsOn` ∪ `completionDependsOn`; null on a cycle. */
export function topoOrder(nodes: readonly ArcNode[]): ArcNode[] | null {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges = (n: ArcNode): string[] => [...(n.dependsOn ?? []), ...(n.completionDependsOn ?? [])];
  const indeg = new Map<string, number>();
  for (const n of nodes) indeg.set(n.id, 0);
  for (const n of nodes) for (const d of edges(n)) if (byId.has(d)) indeg.set(n.id, (indeg.get(n.id) ?? 0) + 1);
  const queue = [...indeg].filter(([, d]) => d === 0).map(([id]) => id);
  const out: ArcNode[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    out.push(byId.get(id)!);
    for (const n of nodes) {
      if (edges(n).includes(id)) {
        const d = (indeg.get(n.id) ?? 0) - 1;
        indeg.set(n.id, d);
        if (d === 0) queue.push(n.id);
      }
    }
  }
  return out.length === nodes.length ? out : null;
}

/**
 * The whole-arc driver. One instance per run (isolated store via its own SimHarness).
 */
export class WholeArcSim {
  constructor(private readonly h: SimHarness) {}

  /** Fresh commit evidence stamped at the harness clock (freshness: producedAt ≥ claimedAt). */
  private evidence(): unknown[] {
    return [{ requirementId: "commit", kind: "commit", ref: "deadbeef", producedAt: this.h.clock.now().toISOString() }];
  }

  private async phaseOf(reader: SimClient, workId: string): Promise<Phase | undefined> {
    const d = (await reader.call("get_work", { workId })).data as Record<string, unknown>;
    const w = (d?.workItem as Record<string, unknown>) ?? d;
    return w?.status as Phase | undefined;
  }

  async run(scenario: ArcScenario): Promise<ArcRunResult> {
    for (const n of scenario.nodes) {
      if (n.gate) throw new Error(`WholeArcSim B1: verifier-gate node "${n.id}" not yet supported (next B1 increment)`);
    }

    // A cyclic dependency graph cannot be built (create_work needs deps to exist) —
    // report it as deadlock, deterministically, rather than looping forever.
    const order = topoOrder(scenario.nodes);
    if (!order) {
      return { done: [], stuck: scenario.nodes.map((n) => n.id), deadlock: true, steps: 0 };
    }

    const arch = await SimClient.create(this.h, "arc-arch", "architect", "arc-arch");
    const clients: Record<ArcRole, SimClient> = {
      architect: arch,
      engineer: await SimClient.create(this.h, "arc-eng", "engineer", "arc-eng"),
      verifier: await SimClient.create(this.h, "arc-ver", "verifier", "arc-ver"),
    };

    // Create every WorkItem in dependency order, mapping logical id → real id.
    const realId = new Map<string, string>();
    for (const node of order) {
      const c = await arch.createWork({
        type: "task",
        roleEligibility: [node.role ?? "engineer"],
        evidenceRequirements: [{ id: "commit", kind: "commit", description: node.id }],
        dependsOn: (node.dependsOn ?? []).map((l) => realId.get(l)).filter((x): x is string => !!x),
        completionDependsOn: (node.completionDependsOn ?? []).map((l) => realId.get(l)).filter((x): x is string => !!x),
      });
      if (!c.ok) throw new Error(`create_work "${node.id}" failed: ${JSON.stringify(c.data)}`);
      const d = c.data as Record<string, unknown>;
      realId.set(node.id, (((d.workItem as Record<string, unknown>) ?? d).id as string));
    }

    // Play the arc: drive each drivable node fully to done, until all done or stuck.
    const doneSet = new Set<string>();
    const maxSteps = scenario.nodes.length * 4 + 8; // bound: a DAG needs ≤ N passes
    let steps = 0;
    while (doneSet.size < scenario.nodes.length && steps < maxSteps) {
      steps++;
      let progress = false;
      for (const node of scenario.nodes) {
        if (doneSet.has(node.id)) continue;
        const wid = realId.get(node.id)!;
        if ((await this.phaseOf(arch, wid)) === "done") {
          doneSet.add(node.id);
          progress = true;
          continue;
        }
        const depsDone = (node.dependsOn ?? []).every((l) => doneSet.has(l));
        const compDone = (node.completionDependsOn ?? []).every((l) => doneSet.has(l));
        if (!depsDone || !compDone) continue; // not drivable yet
        const exec = clients[node.role ?? "engineer"];
        const claimed = await exec.claim(wid);
        if (!claimed.ok) continue;
        await exec.start(wid);
        const completed = await exec.complete(wid, this.evidence());
        if (completed.ok && (await this.phaseOf(arch, wid)) === "done") {
          doneSet.add(node.id);
          progress = true;
        }
      }
      if (!progress) break; // no node advanced this pass ⇒ deadlock
    }

    const done = [...doneSet];
    const stuck = scenario.nodes.filter((n) => !doneSet.has(n.id)).map((n) => n.id);
    return { done, stuck, deadlock: stuck.length > 0, steps };
  }
}
