# hubfix0 — BUILD-capture runbook (frozen artifact, v4)

**Node:** `hubfix0 BUILD` (engineer / greg). **Executable:** `docs/runbooks/hubfix0-build-capture.sh`
— approval binds its exact sha256 **`3ce006b6b6cfca7c0bcb930ff612bd1d844bf6dcfb6446c6f8727e5eb70f92ff`**,
published durably at branch `greg/hubfix0-build-capture` (committed raw bytes; this Markdown is explanation
only). **Addresses** v1 B1–B8, v2 V2-1…7, v3 V3-1…6.

Builds the immutable idea-528 Hub image and emits an **immutable, complete receipt** — frozen input to
ROLL (ruby binds it) and LIVE-VERIFY (steve's strong contract).

## Credential model: consume + bind a governed fresh-exchange preflight

This script is **credential-mode-agnostic** and does **not** establish credentials. A separate **governed
credential preflight** (Director/architect-run) must:

1. establish an **isolated, already-authenticated** env — throwaway `HOME` (no `hub.env`), `CLOUDSDK_CONFIG`
   authed as terraform@ (bridge-key **or** WIF), docker AR-configured; and
2. **prove a FRESH token exchange** (a clean-config mint — an AR read alone can pass on a cached token and
   is NOT a fresh-mint proof), emitting a receipt.

This script **binds** that preflight receipt (`CRED_PREFLIGHT_RECEIPT` + expected `CRED_PREFLIGHT_SHA`,
carried in the BUILD receipt) and **re-proves** principal/project/AR-authorization as **liveness**, not
fresh-mint. Consequences: no secret material enters this script/log/receipt; the artifact is approvable
independent of the bridge-vs-WIF ruling — only the preflight differs by mode.

## Invariants

- **NO prod touch.** ONE **create-once, one-shot, non-idempotent** tag `…/hub:hubfix0-<40hex>-<attempt>`;
  never `:latest`, never the VM. A failed/partial attempt *consumes* its tag → a **distinct successor** tag.
- **NEVER executes the image** — `docker create` + `docker cp` only.
- **Self-verifying** — refuses unless own sha256 == external `APPROVED_SELF_SHA`, before any GCP call.
- **Fail-closed** — create-once uses a *successful* `tags list` zero-match (never human stderr).

## v3 residuals addressed

| # | v3 residual | v4 fix |
|---|---|---|
| V3-1 | create-once inferred from human stderr | `gcloud artifacts docker tags list --format=json` must **succeed**; assert zero exact matches; any query failure aborts |
| V3-2 | projectNumber SA inference | authoritative `gcloud builds get-default-service-account` (raw lookup retained); strict principal regex |
| V3-3 | evidence deleted on failure | phase-tracked: once a build is **submitted**, `EVIDENCE_DIR` is preserved regardless of outcome + a create-only `terminal-status.json` manifest; only an untouched preflight dir is discarded |
| V3-4 | "AR read defeats stale-cache" false | corrected: AR probe is **liveness/authorization only**; the **fresh-mint proof is the governed preflight's receipt**, bound + carried |
| V3-5 | executable not durable | committed raw bytes at `greg/hubfix0-build-capture`; approval binds path/rev + decoded sha256 (not a `get_document` read — bug-302) |
| V3-6 | timestamp / receipt semantics | `builtAt` round-tripped through GNU `date` (rejects calendar-invalid); receipt sha256 + terminal status on **both** success and post-submit failure; **Hub evidence refs required before BUILD completion + before ROLL** |

## Receipt → consumer map

| field | consumed by |
|---|---|
| `pinned_source_sha` / `build_info.gitSha` | LIVE-VERIFY SHA domain |
| `build_info.builtAt` / `build_interval` | ROLL `EXPECTED_BUILT_AT` + provenance |
| `build_info.sha256` / `build_info.base64` | ROLL `EXPECTED_BUILD_INFO_SHA256` (recomputable) |
| `canonical_pushed_digest` / `cloud_build_result_digest` / `repo_digests[]` | ROLL retag; LIVE-VERIFY RepoDigests **membership** |
| `cred_preflight_receipt_sha256` / `cloud_build_id` / `submitted_by_sa` / `cloud_build_service_account` / `executable_hashes` / `evidence` | provenance / tamper-evidence |

## Completion requirement

Before the BUILD WorkItem completes (and before ROLL is authored): publish the receipt, `build.log`, and
`builds-describe.json` as **Hub evidence** and record their refs. The script produces these under
`EVIDENCE_DIR`; the completion step publishes + binds the Hub refs.
