# hubfix0 — BUILD-capture runbook (frozen artifact, v5)

**Node:** `hubfix0 BUILD` (engineer / greg). **Executable:** `docs/runbooks/hubfix0-build-capture.sh`
— approval binds its exact sha256 **`527a59ad7503cacb1dffaebc6d22f1448e568af72fb3b29c6384d835d01dd346`**,
published durably on branch `greg/hubfix0-build-capture` (committed raw bytes; this Markdown is explanation).
**Addresses** v1 B1–B8, v2 V2-1…7, v3 V3-1…6, v4 V4-1…4.

Builds the immutable idea-528 Hub image and emits an **immutable, complete receipt** — the frozen input to
ROLL (ruby binds it) and LIVE-VERIFY (steve's strong contract).

## Pinned (V4-1 — changing any requires re-review)

`IDEA528_SHA=db27857f0fa06d498baaef456988b3e8f93adaf4`, `EXPECT_SA=terraform@labops-389703.iam.gserviceaccount.com`,
`GCP_PROJECT=labops-389703`, `GCP_REGION=australia-southeast1` (AR), `CB_LOCATION=global` (Cloud Build —
build-hub submits global; `builds describe` is pinned to it, never silently inherited). These are `readonly`
constants, not env-overridable.

## Credential model + required preflight-receipt schema

Credential-mode-agnostic; **consumes** a governed preflight env, does not establish creds. The governed
preflight (Director/architect) must establish an isolated authed env **and prove a FRESH token exchange**
(a clean-config mint — a cached/AR read is not acceptance), emitting a receipt this script **validates by
schema** (not just hash) and carries:

```json
{ "status": "PASS", "credential_mode": "wif|bridge-key",
  "principal": "terraform@labops-389703.iam.gserviceaccount.com", "project": "labops-389703",
  "isolated_config": "<config identity>",
  "fresh_exchange": { "at": "YYYY-MM-DDTHH:MM:SSZ", "method": "<clean-config jwt mint>" },
  "no_secret_material": true, "durable_ref": "<Hub/entity ref>" }
```

BUILD binds `CRED_PREFLIGHT_RECEIPT` + `CRED_PREFLIGHT_SHA`, asserts the schema above, carries
`{sha256, durable_ref}` in the BUILD receipt, and re-proves principal/project/AR-authorization as
**liveness only**. A cached-only cred (no valid fresh-exchange receipt) makes BUILD **refuse** to proceed.

## v4 residuals addressed

| # | v4 residual | v5 fix |
|---|---|---|
| V4-1 | identities/location overridable | `IDEA528_SHA`, `EXPECT_SA`, project/region, `CB_LOCATION=global` pinned `readonly` |
| V4-2 | cred receipt hash-only | full schema asserted (PASS/principal/project/fresh_exchange/no_secret/durable_ref) + carried |
| V4-3 | weak failure manifest | create-only failure manifest binds frozen inputs, tag, self-hash, cred sha+ref, interval, available evidence hashes; emits its **own** `.sha256`; companion no longer claims a success "receipt sha256" on failure |
| V4-4 | default-SA lookup not hashed | `default-cb-sa.json` sha256 computed when used (null when unused), in the evidence map |

## V4-5 — WorkItem durable execution binding (for the node contract)

The BUILD WorkItem must bind and run **`8b664c5…`→ v5 commit** : `docs/runbooks/hubfix0-build-capture.sh`
: `sha256=527a59ad…`. **Materialize** those bytes from the commit into a clean temp path, **verify sha256**,
then execute with `bash <path>` (blob mode `100644`, not executable). Never run a mutable branch-worktree copy.
`APPROVED_SELF_SHA` = that sha; the script self-refuses on mismatch.

## Receipt → consumer map

| field | consumed by |
|---|---|
| `pinned_source_sha` / `build_info.gitSha` | LIVE-VERIFY SHA domain |
| `build_info.builtAt` / `build_interval` | ROLL `EXPECTED_BUILT_AT` + provenance |
| `build_info.sha256` / `build_info.base64` | ROLL `EXPECTED_BUILD_INFO_SHA256` (recomputable) |
| `canonical_pushed_digest` / `cloud_build_result_digest` / `repo_digests[]` | ROLL retag; LIVE-VERIFY RepoDigests **membership** |
| `cred_preflight` / `cloud_build_id` / `cloud_build_location` / SA fields / `executable_hashes` / `evidence` | provenance / tamper-evidence |

## Completion requirement

Before the BUILD WorkItem completes (and before ROLL is authored): publish the receipt, `build.log`, and
`builds-describe.json` as **Hub evidence** and record their refs. On a submitted-but-failed attempt the
failure manifest + its `.sha256` are likewise preserved and published, and a **distinct successor tag** is used.
