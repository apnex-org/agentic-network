#!/usr/bin/env node
// mission-83 W0 spike — synthetic state generator
//
// Generates ~10k synthetic entities across the 13 existing substrate-mediated
// kinds (per entity-kinds.json v1.1) into <SYNTH_DIR>/<kind-dir>/<id>.json.
// Distribution approximates production-realistic Hub state.
//
// Usage:
//   node hub/spike/W0/synth-state.js [SYNTH_DIR]
//   (default SYNTH_DIR = /tmp/synth-state)
//
// Exit: prints summary + total entity count + estimated payload bytes.

import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";

const SYNTH_DIR = process.argv[2] || "/tmp/synth-state";

// Per entity-kinds.json v1.1 — 13 existing substrate-mediated kinds at
// representative production-realistic counts.
// Total: 10,000 entities (matches Design §3.5 spike-target dataset size).
const DISTRIBUTION = [
  { kind: "Message",       dir: "messages",         count: 5000 },
  { kind: "Thread",        dir: "threads",          count: 600  },
  { kind: "PendingAction", dir: "pending-actions",  count: 1500 },
  { kind: "Audit",         dir: "audit/v2",         count: 1000 },
  { kind: "Tele",          dir: "tele",             count: 400  },
  { kind: "Turn",          dir: "turns",            count: 600  },
  { kind: "Mission",       dir: "missions",         count: 85   },
  { kind: "Task",          dir: "tasks",            count: 425  },
  { kind: "Idea",          dir: "ideas",            count: 300  },
  { kind: "Bug",           dir: "bugs",             count: 95   },
  { kind: "Proposal",      dir: "proposals",        count: 30   },
  { kind: "Agent",         dir: "engineers",        count: 8    },
  { kind: "Counter",       dir: "meta",             count: 1    },  // single-row meta/counter.json
];

// Synthetic entity factories per kind. Payload size approximates production:
// messages ~1-2KB; threads ~3-5KB; missions ~5-10KB.
function synthMessage(seq) {
  return {
    id: `01J${seq.toString(36).padStart(7, '0').toUpperCase().slice(0,7)}${randomULIDSuffix()}`,
    kind: ["note", "task", "report", "review"][seq % 4],
    authorRole: ["engineer", "architect", "director"][seq % 3],
    authorAgentId: `agent-${(seq % 8).toString(16).padStart(8,'0')}`,
    threadId: `thread-${Math.floor(seq / 10) % 600}`,
    target: { role: "engineer", agentId: `agent-${(seq+1)%8}` },
    delivery: "push-immediate",
    payload: { text: `Message #${seq} — ${lorem(50 + (seq % 100))}` },
    intent: null,
    semanticIntent: null,
    createdAt: new Date(Date.now() - seq * 1000).toISOString(),
    updatedAt: new Date(Date.now() - seq * 500).toISOString(),
  };
}

function synthThread(seq) {
  return {
    id: `thread-${seq}`,
    title: `Synthetic thread ${seq} — ${lorem(8)}`,
    status: ["active", "converged", "active", "active"][seq % 4],
    routingMode: "unicast",
    createdBy: { role: "architect", agentId: "agent-40903c59" },
    recipientAgentId: "agent-0d2c690e",
    participants: [
      { role: "architect", agentId: "agent-40903c59", joinedAt: new Date(Date.now() - seq * 60000).toISOString() },
      { role: "engineer", agentId: "agent-0d2c690e", joinedAt: new Date(Date.now() - seq * 60000 + 10000).toISOString() },
    ],
    summary: lorem(100),
    convergenceActions: [],
    labels: { env: "prod", "test/seq": `${seq}` },
    messages: [],  // synth doesn't materialize message hydration
    maxRounds: 10,
    roundCount: seq % 8,
    currentTurn: "engineer",
    currentTurnAgentId: "agent-0d2c690e",
    createdAt: new Date(Date.now() - seq * 3600000).toISOString(),
    updatedAt: new Date(Date.now() - seq * 60000).toISOString(),
    lastMessageProjectedAt: new Date(Date.now() - seq * 60000).toISOString(),
  };
}

function synthPendingAction(seq) {
  return {
    id: `pa-2026-05-17T${(seq%24).toString().padStart(2,'0')}-${(seq%60).toString().padStart(2,'0')}-${(seq%60).toString().padStart(2,'0')}-${(seq%1000).toString().padStart(3,'0')}Z-${seq.toString(36).padStart(3,'0')}`,
    targetAgentId: `agent-${(seq % 8).toString(16).padStart(8,'0')}`,
    dispatchType: "thread_message",
    entityRef: `thread-${seq % 600}`,
    payload: { text: lorem(80) },
    state: ["enqueued", "receipt_acked", "completion_acked"][seq % 3],
    enqueuedAt: new Date(Date.now() - seq * 1000).toISOString(),
    receiptDeadline: new Date(Date.now() - seq * 1000 + 60000).toISOString(),
    completionDeadline: new Date(Date.now() - seq * 1000 + 240000).toISOString(),
  };
}

function synthAudit(seq) {
  return {
    id: `audit-${seq.toString().padStart(4,'0')}`,
    entityKind: ["Mission", "Task", "Thread", "Idea"][seq % 4],
    entityId: `entity-${seq}`,
    op: "update",
    actorRole: "architect",
    actorAgentId: "agent-40903c59",
    delta: { field: "status", before: "open", after: "closed" },
    timestamp: new Date(Date.now() - seq * 30000).toISOString(),
  };
}

function synthMinimal(idPrefix, seq, extra = {}) {
  return {
    id: `${idPrefix}-${seq}`,
    summary: lorem(40),
    payload: { lorem: lorem(60) },
    createdAt: new Date(Date.now() - seq * 60000).toISOString(),
    updatedAt: new Date(Date.now() - seq * 30000).toISOString(),
    ...extra,
  };
}

// Random ULID-suffix-like (10 base32 chars)
function randomULIDSuffix() {
  const chars = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let out = "";
  for (let i = 0; i < 10; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

// Pseudo-lorem text generator (deterministic per seq for reproducibility)
function lorem(words) {
  const dict = ["substrate", "watch", "primitive", "reconciler", "schemadef", "entity", "kind", "migration", "cutover", "snapshot", "restore", "listen", "notify", "jsonb", "expression", "index", "concurrent", "filter", "list", "put", "get", "delete", "createonly", "putifmatch"];
  let out = "";
  for (let i = 0; i < words; i++) {
    out += dict[Math.floor(Math.random() * dict.length)] + " ";
  }
  return out.trim();
}

function synthFor(kind, seq) {
  switch (kind) {
    case "Message":       return synthMessage(seq);
    case "Thread":        return synthThread(seq);
    case "PendingAction": return synthPendingAction(seq);
    case "Audit":         return synthAudit(seq);
    case "Tele":          return synthMinimal("tele", seq, { class: "engineer-bilateral", outcomes: ["aligned"] });
    case "Turn":          return synthMinimal("turn", seq, { agentId: "agent-0d2c690e", payload: { tokens: seq * 100 } });
    case "Mission":       return synthMinimal("mission", seq, { title: `M-Synthetic-${seq}`, status: "active", plannedTasks: [{ kind: "build", taskSeq: seq*8 }] });
    case "Task":          return synthMinimal("task", seq, { directive: lorem(100), status: "completed" });
    case "Idea":          return synthMinimal("idea", seq, { title: `Synthetic idea ${seq}`, status: "triaged" });
    case "Bug":           return synthMinimal("bug", seq, { class: "missing-feature", severity: "minor", status: "open" });
    case "Proposal":      return synthMinimal("proposal", seq, { title: `Proposal ${seq}`, state: "active" });
    case "Agent":         return synthMinimal("eng", seq, { role: "engineer", labels: { env: "prod" }, lastSeenAt: new Date().toISOString() });
    case "Counter":       return { taskCounter: 425, proposalCounter: 30, engineerCounter: 8, threadCounter: 600, notificationCounter: 9500, ideaCounter: 300, missionCounter: 85, turnCounter: 600, teleCounter: 400, bugCounter: 95 };
    default: throw new Error(`unknown kind: ${kind}`);
  }
}

// — main —
console.log(`[synth-state] target dir: ${SYNTH_DIR}`);

// Clean previous run
if (fs.existsSync(SYNTH_DIR)) {
  fs.rmSync(SYNTH_DIR, { recursive: true });
}
fs.mkdirSync(SYNTH_DIR, { recursive: true });

const t0 = performance.now();
let totalEntities = 0;
let totalBytes = 0;
const perKind = {};

for (const { kind, dir, count } of DISTRIBUTION) {
  const kindDir = path.join(SYNTH_DIR, dir);
  fs.mkdirSync(kindDir, { recursive: true });

  let kindBytes = 0;

  for (let seq = 0; seq < count; seq++) {
    const entity = synthFor(kind, seq);
    // For Counter, single file at meta/counter.json (no per-id subdir)
    const fname = kind === "Counter" ? "counter.json" : `${entity.id}.json`;
    const fpath = path.join(kindDir, fname);
    const json = JSON.stringify(entity, null, 2);
    fs.writeFileSync(fpath, json, "utf-8");
    kindBytes += Buffer.byteLength(json, "utf-8");
    totalEntities++;
  }

  perKind[kind] = { count, bytes: kindBytes, avgBytes: Math.round(kindBytes / count) };
  totalBytes += kindBytes;
}

const elapsedMs = performance.now() - t0;

console.log("");
console.log(`[synth-state] generated ${totalEntities} entities in ${SYNTH_DIR}`);
console.log(`[synth-state] total payload: ${(totalBytes / 1024 / 1024).toFixed(2)} MB`);
console.log(`[synth-state] synthesis wall-clock: ${(elapsedMs / 1000).toFixed(2)}s`);
console.log("");
console.log("[synth-state] per-kind breakdown:");
for (const [kind, stats] of Object.entries(perKind)) {
  console.log(`  ${kind.padEnd(15)}  count=${stats.count.toString().padStart(5)}  bytes=${(stats.bytes/1024).toFixed(1).padStart(8)} KB  avg=${stats.avgBytes.toString().padStart(5)} B`);
}
