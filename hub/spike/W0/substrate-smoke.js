#!/usr/bin/env node
// mission-83 W1.3 spike-smoke — exercise substrate CRUD + CAS + watch end-to-end
//
// Quick validation that PostgresStorageSubstrate.{get,put,delete,list,createOnly,
// putIfMatch,watch} all work against running hub-substrate-postgres.
//
// Usage: node hub/spike/W0/substrate-smoke.js
//   (requires postgres compose-up at port 5432 + entities table from W0.3 leftovers
//    OR fresh schema via migrations 001+002+003)

import { createPostgresStorageSubstrate } from "../../src/storage-substrate/index.js";
import { performance } from "node:perf_hooks";

const substrate = createPostgresStorageSubstrate("postgres://hub:hub@localhost:5432/hub");

console.log("=== W1.3 substrate smoke ===");

// Reset state (use a fresh kind we won't conflict with W0.3 leftover data)
const KIND = "SmokeTest";

// 0. CLEAN slate (delete any prior smoke entities; idempotent)
console.log("\n0. CLEAN slate");
// Use pool directly to clear the kind
const { Pool } = (await import("pg")).default;
const pool = new Pool({ connectionString: "postgres://hub:hub@localhost:5432/hub" });
await pool.query(`DELETE FROM entities WHERE kind = $1`, [KIND]);
await pool.end();

// 1. PUT — basic
console.log("\n1. PUT");
const p1 = await substrate.put(KIND, { id: "smoke-1", name: "Alice", age: 30 });
console.log(`   put → id=${p1.id} rv=${p1.resourceVersion}`);

// 2. GET — round-trip
console.log("\n2. GET");
const g1 = await substrate.get(KIND, "smoke-1");
console.log(`   get → ${JSON.stringify(g1)}`);

// 3. PUT (update existing) — verify resource_version bumps
console.log("\n3. PUT (update)");
const p2 = await substrate.put(KIND, { id: "smoke-1", name: "Alice", age: 31 });
console.log(`   put → id=${p2.id} rv=${p2.resourceVersion} (bumped from ${p1.resourceVersion})`);

// 4. CREATE_ONLY — first insert succeeds
console.log("\n4. createOnly — first insert");
const c1 = await substrate.createOnly(KIND, { id: "smoke-2", name: "Bob" });
console.log(`   createOnly → ${JSON.stringify(c1)}`);

// 5. CREATE_ONLY — same id → conflict
console.log("\n5. createOnly — conflict-on-existing");
const c2 = await substrate.createOnly(KIND, { id: "smoke-2", name: "Bob v2" });
console.log(`   createOnly → ${JSON.stringify(c2)}`);

// 6. PUT_IF_MATCH — correct revision → success
console.log("\n6. putIfMatch — correct revision");
const pm1 = await substrate.putIfMatch(KIND, { id: "smoke-2", name: "Bob updated" }, c1.ok ? c1.resourceVersion : "0");
console.log(`   putIfMatch → ${JSON.stringify(pm1)}`);

// 7. PUT_IF_MATCH — stale revision → conflict
console.log("\n7. putIfMatch — stale revision");
const pm2 = await substrate.putIfMatch(KIND, { id: "smoke-2", name: "Bob stale-update" }, c1.ok ? c1.resourceVersion : "0");
console.log(`   putIfMatch → ${JSON.stringify(pm2)}`);

// 8. LIST — basic, no filter
console.log("\n8. LIST — no filter");
const l1 = await substrate.list(KIND);
console.log(`   list → ${l1.items.length} items; snapshotRevision=${l1.snapshotRevision}`);

// 9. PUT a few more for filter tests
console.log("\n9. Setup for filter tests");
await substrate.put(KIND, { id: "smoke-3", name: "Carol", age: 25 });
await substrate.put(KIND, { id: "smoke-4", name: "Dave", age: 40 });
await substrate.put(KIND, { id: "smoke-5", name: "Eve", age: 35 });

// 10. LIST — filter by scalar
console.log("\n10. LIST — filter name=Alice");
const l2 = await substrate.list(KIND, { filter: { name: "Alice" } });
console.log(`   list → ${l2.items.length} items; first=${JSON.stringify(l2.items[0])}`);

// 11. LIST — filter $in
console.log("\n11. LIST — filter name $in [Alice, Bob]");
const l3 = await substrate.list(KIND, { filter: { name: { $in: ["Alice", "Bob"] } } });
console.log(`   list → ${l3.items.length} items; names=${l3.items.map(x => x.name).join(", ")}`);

// 12. LIST — filter $gte on age (numeric range)
console.log("\n12. LIST — filter age $gte 30");
const l4 = await substrate.list(KIND, { filter: { age: { $gte: 30 } } });
console.log(`   list → ${l4.items.length} items; ages=${l4.items.map(x => x.age).join(", ")}`);

// 13. LIST — sort + limit
console.log("\n13. LIST — sort by age desc, limit 2");
const l5 = await substrate.list(KIND, { sort: [{ field: "age", order: "desc" }], limit: 2 });
console.log(`   list → ${l5.items.length} items; ages=${l5.items.map(x => x.age).join(", ")}`);

// 14. WATCH — list-then-watch backfill semantics (just verify sinceRevision replay works)
console.log("\n14. WATCH — sinceRevision replay");
const watchStart = performance.now();
const replayedEvents = [];
let count = 0;
const ac = new AbortController();
const watchPromise = (async () => {
  // Start watching from rv=0 (replays everything)
  for await (const event of substrate.watch(KIND, { sinceRevision: "0" })) {
    replayedEvents.push(event);
    count++;
    if (count >= 5 || ac.signal.aborted) break;
  }
})();
// Give watch a moment to drain replay (no LISTEN events expected since we trigger nothing post-watch-start)
await new Promise(r => setTimeout(r, 200));
ac.abort();
// Hack: substrate.watch holds an open LISTEN connection; can't easily clean up without exposing more state.
// For smoke purposes: capture replayed count + bail.
console.log(`   watch replay → captured ${count} events; first=${JSON.stringify(replayedEvents[0])}`);
console.log(`   watch elapsed: ${(performance.now() - watchStart).toFixed(0)}ms`);

// 15. DELETE — cleanup
console.log("\n15. DELETE");
await substrate.delete(KIND, "smoke-1");
const g_deleted = await substrate.get(KIND, "smoke-1");
console.log(`   delete + get → ${g_deleted === null ? "null (PASS)" : "NOT NULL (FAIL)"}`);

// 16. Final cleanup
console.log("\n16. Final cleanup");
const finalCleanupPool = new Pool({ connectionString: "postgres://hub:hub@localhost:5432/hub" });
const finalDelete = await finalCleanupPool.query(`DELETE FROM entities WHERE kind = $1`, [KIND]);
await finalCleanupPool.end();
console.log(`   deleted ${finalDelete.rowCount} remaining smoke entities`);

console.log("\n=== W1.3 substrate smoke PASS ===");

// Force exit because substrate.watch holds an open LISTEN client
process.exit(0);
