#!/usr/bin/env node
/**
 * bug-371 (work-508 / work-512) — migrate-sealed-rows-to-failed-phase
 *
 * State-migration: gives every seal-failed WorkItem the real terminal phase
 * `failed_sealed`, so the STORED phase and the row's actual terminality agree.
 *
 * WHY A MIGRATION IS REQUIRED AND A CODE CHANGE ALONE IS NOT: list filters are
 * pushed DOWN to `substrate.list` and evaluated against the STORED phase BEFORE
 * decode runs. `effectiveDisposition` is derived at decode and is not in storage
 * at all, so a derived field can fix a DISPLAY and never a FILTER. Un-migrated
 * rows keep answering `status="ready"` filters however correct the new code is.
 *
 * DEPLOY-TIME STEP: run this AT the deploy that ships 6c97a024. Until it runs,
 * bug-371 is FIXED IN SOURCE AND NOT FIXED IN PRODUCTION — the sealed rows are
 * still stored `ready` and still appear on a `ready` filter. Between the new code
 * serving and this completing, un-migrated rows DISPLAY `ready` (the pre-work-505
 * state); that window is acceptable only because this runs in the same operation.
 *
 * AN EXPLICIT COMMAND, DELIBERATELY NOT A STARTUP HOOK (architect-ruled):
 *  (a) a true `truncated` is a DEFECT, NOT A WARNING, and needs a human to SEE it —
 *      a hook's output lands in logs nobody reads on a process that started fine;
 *  (b) a hook fires on every restart forever, turning a one-time correction into a
 *      standing write path long after the rows it was written for are gone;
 *  (c) the run-guarantee belongs to whoever owns the deploy, not to a lifecycle
 *      hook that cannot know whether the deploy succeeded.
 *
 * WHAT IT TOUCHES: `status` ALONE. The retained-FAIL constraint protects the
 * VERDICT — attestations, attestationHistory, failedGateSeal, evidence — and the
 * verifier's baseline hashes exactly those four; `status` is not in that object,
 * so this leaves the baseline byte-identical. Writes go through the repository's
 * existing per-row CAS, not raw SQL, so encoding and fencing are production's.
 *
 * IDEMPOTENT: rows already at the terminal phase are skipped, so a retried rollout
 * is a no-op rather than a second rewrite. `matched` and `migrated` are reported
 * SEPARATELY — a run reporting only "done" cannot distinguish a retry from a first
 * run. REFUSES LOUDLY (non-zero exit, nothing written after the refusal) on a row
 * that reads as sealed but carries neither a `failedGateSeal` nor an active
 * verifier FAIL: an unrecognised shape means something else changed, and that is
 * the case most worth seeing.
 *
 * EXIT CODES: 0 success · 1 truncated scan (INCOMPLETE — see below) or refusal
 * · 2 bad usage.
 *
 * 🔴 TRUNCATION IS NOT A WARNING. The scan inherits the repository's LIST_CAP and
 * does NOT page. If `truncated` is true the run covered only what it saw and the
 * migration is INCOMPLETE — exit is non-zero for exactly that reason. At the
 * twelve rows this was written for it is inert; on a larger corpus it needs paging,
 * which is not built.
 *
 * WHERE IT RUNS: production is a Docker container on the `hub-vm` GCE VM, NOT
 * Cloud Run, so this lives under `src/scripts/` (compiled into `dist/`) rather than
 * the tsx-only `hub/scripts/` directory, and is invoked as a throwaway container
 * against the prod DB — the `run-envelope-migration.js` precedent:
 *
 *   sudo docker run --rm --network hub-net \
 *     -e POSTGRES_CONNECTION_STRING="$WRITE_CONN" \
 *     $HUB_IMAGE node dist/scripts/migrate-sealed-rows-to-failed-phase.js --dry-run
 *
 * It therefore reads the connection string FROM THE ENVIRONMENT and needs nothing
 * else: no config file, no gcloud, no interactive prompt. `--target=` exists for
 * local throwaway-postgres testing only.
 *
 * Usage:
 *   node dist/scripts/migrate-sealed-rows-to-failed-phase.js [--dry-run] [--target=<conn>]
 *   npm run migrate-sealed-rows-to-failed-phase -- [--dry-run]
 *   (target defaults to $POSTGRES_CONNECTION_STRING)
 *
 * RUN IT WITH --dry-run FIRST. Collect-mode walks the SAME scan, the SAME match
 * predicate and the SAME shape-refusal as a real run and differs at exactly one
 * point — the CAS write — so its `{scanned, matched, migrated}` are what the real
 * run will do, not an estimate of it. A dry run that reported anything else would
 * be worse than not having one.
 *
 * 🔴 ROLLBACK DOES NOT COVER THIS. The deploy's rollback is re-tagging the prior
 * image digest, which reverses CODE and NOT these writes. There is a full pg_dump
 * before any mutation, but restoring one is a catastrophe-grade action, not a
 * rollback. So this must be correct on the first run: hence the idempotent skip and
 * the loud shape-refusal, which are load-bearing rather than conveniences.
 */

import { SubstrateCounter } from "../entities/substrate-counter.js";
import { WorkItemRepositorySubstrate } from "../entities/work-item-repository-substrate.js";
import {
  buildEnvelopeWriteEncoder,
  createPostgresStorageSubstrate,
} from "../storage-substrate/index.js";

interface CliArgs {
  target: string;
  dryRun: boolean;
}

function parseCli(): CliArgs {
  const args: Partial<CliArgs> = { dryRun: false };
  for (const arg of process.argv.slice(2)) {
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg.startsWith("--target=")) args.target = arg.slice("--target=".length);
    else {
      console.error(`[migrate-sealed-phase] unknown arg: ${arg}`);
      process.exit(2);
    }
  }
  args.target ??= process.env.POSTGRES_CONNECTION_STRING;
  if (!args.target) {
    console.error("[migrate-sealed-phase] no target: pass --target=<conn> or set POSTGRES_CONNECTION_STRING");
    process.exit(2);
  }
  return args as CliArgs;
}

async function main(): Promise<void> {
  const { target, dryRun } = parseCli();
  const redacted = target.replace(/:[^:@]+@/, ":***@");
  console.log(`[migrate-sealed-phase] target=${redacted} dryRun=${dryRun}`);

  const substrate = createPostgresStorageSubstrate(target);
  // The write encoder is NOT optional: without it a CAS write lands bare-shape
  // instead of envelope-shape, which is a silent corruption of every row touched.
  // Same wiring order the Hub uses at boot, before any writer exists.
  substrate.setWriteEncoder(buildEnvelopeWriteEncoder());
  const repo = new WorkItemRepositorySubstrate(substrate, new SubstrateCounter(substrate));

  let result;
  try {
    result = await repo.migrateSealedRowsToFailedPhase({ dryRun });
  } catch (error) {
    // The shape-refusal path, and anything else that throws. Report and fail —
    // never swallow, because a migration that reports success after refusing a row
    // is worse than one that never ran.
    console.error(`[migrate-sealed-phase] REFUSED: ${(error as Error)?.message ?? error}`);
    process.exitCode = 1;
    return;
  }

  // FULL result object, not a summary line — the operator has to be able to see
  // which rows moved and from what, at the moment they can still act on it.
  console.log(JSON.stringify(result, null, 2));
  console.log(
    `[migrate-sealed-phase] scanned=${result.scanned} matched=${result.matched} ` +
    `${dryRun ? "wouldWrite" : "written"}=${result.migrated.length} skipped=${result.skipped.length} ` +
    `truncated=${result.truncated}`,
  );

  if (result.truncated) {
    console.error(
      "[migrate-sealed-phase] 🔴 TRUNCATED: the scan hit the row cap, so rows beyond it were NEVER EXAMINED. " +
      "This run is INCOMPLETE — it is a DEFECT, not a warning. The scan does not page; do not treat a " +
      "subsequent clean re-run as proof of coverage without establishing the corpus size.",
    );
    process.exitCode = 1;
    return;
  }

  if (dryRun) {
    console.log("[migrate-sealed-phase] DRY RUN — nothing was written. Re-run without --dry-run to apply.");
  }
}

main().catch((error) => {
  console.error(`[migrate-sealed-phase] FAILED: ${(error as Error)?.stack ?? error}`);
  process.exit(1);
});
