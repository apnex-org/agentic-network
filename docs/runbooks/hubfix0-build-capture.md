# hubfix0 — BUILD-capture runbook (frozen artifact, v6)

**Node:** `hubfix0 BUILD` (engineer / greg). **Executable:** `docs/runbooks/hubfix0-build-capture.sh`
— approval binds its exact sha256 **`80b4f7b17b573b3d96f6fa5509e7b61c5a625a801f3bd6014a4aa8b9bad64ac0`**,
published durably on branch `greg/hubfix0-build-capture` (committed raw bytes). **Addresses** v1 B1–B8,
v2 V2-1…7, v3 V3-1…6, v4 V4-1…4, v5 V5-1…4.

Builds the immutable idea-528 Hub image + emits an **immutable, complete receipt** — frozen input to ROLL
(ruby binds it) and LIVE-VERIFY (steve).

## Pinned (`readonly`, re-review to change)

`IDEA528_SHA=db27857f0fa06d498baaef456988b3e8f93adaf4`, `EXPECT_SA=terraform@labops-389703.iam.gserviceaccount.com`,
`GCP_PROJECT=labops-389703`, `GCP_REGION=australia-southeast1` (AR), `CB_LOCATION=global` **+
`export CLOUDSDK_BUILDS_REGION=global`** so submit + describe + `get-default-service-account --region=global`
all use ONE explicit location (V5-1), `FRESH_WINDOW_SEC=1800`.

## Credential model + required preflight-receipt schema (extended, V5-2)

Consumes a governed preflight env; does not establish creds. The governed preflight must establish an
isolated authed env, **write a session marker** to `$CLOUDSDK_CONFIG/.hubfix0-session`, and **prove a FRESH
token exchange**, emitting a receipt this script validates by **schema + session + time binding**:

```json
{ "status":"PASS",
  "credential_mode":"wif" | "bridge-key",
  "principal":"terraform@labops-389703.iam.gserviceaccount.com", "project":"labops-389703",
  "isolated_config":"<== the value in $CLOUDSDK_CONFIG/.hubfix0-session>",
  "fresh_exchange":{ "at":"YYYY-MM-DDTHH:MM:SSZ (<= 30 min old, not future)",
                     "method":"wif-jwt-exchange" | "clean-config-key-mint" (must match mode) },
  "no_secret_material":true, "durable_ref":"<== required CRED_PREFLIGHT_REF>" }
```

BUILD asserts: hash; `status==PASS`; principal/project; **enum** `credential_mode` + mode-appropriate
`method`; `fresh_exchange.at` calendar-valid, not-future, **≤ `FRESH_WINDOW_SEC` old**; `isolated_config` ==
the consumed session marker (binds the receipt to THIS config, not a historical PASS); `durable_ref` ==
the required `CRED_PREFLIGHT_REF`. It carries `{sha256, durable_ref, session_id, fresh_exchange_age_sec,
credential_mode}` in success **and** failure receipts. A cached-only cred cannot satisfy this.

## v5 residuals addressed

| # | v5 residual | v6 fix |
|---|---|---|
| V5-1 | submit/default-SA could inherit `builds/region` | `export CLOUDSDK_BUILDS_REGION=global` for the producer + `--region=global` on describe & default-SA — one explicit location |
| V5-2 | cred receipt structurally-but-not-bound | enum mode/method + freshness window + session-marker match + required durable-ref input; session id + age carried |
| V5-3 | stale commit binding in companion | the WorkItem binds the **EXACT steve-approved commit** `fffd74ac7145da89790542df6416d0b677d023b9` + path + `sha256=80b4f7b1…` (immutable; **NOT** the mutable branch HEAD); sha256 is the content-verify |
| V5-4 | silent manifest write failure | failure-manifest write/hash failure emits a **loud stderr** warning ("AUDIT EVIDENCE INCOMPLETE"); original nonzero exit preserved |

## Durable execution binding (WorkItem contract)

Bind + run the **EXACT steve-approved commit** (immutable — **NOT** the mutable branch HEAD):
`fffd74ac7145da89790542df6416d0b677d023b9` : `docs/runbooks/hubfix0-build-capture.sh` :
`sha256=80b4f7b17b573b3d96f6fa5509e7b61c5a625a801f3bd6014a4aa8b9bad64ac0`. Materialize those exact bytes
from that commit into a clean temp, **verify the sha256**, then `bash <path>` (blob mode `100644`, no
exec-bit); `APPROVED_SELF_SHA` = that sha; the script self-refuses on mismatch. Never a mutable
branch/worktree copy. (The approved commit is itself immutable; the sha256 is the content-verify.)

## Receipt → consumer map

| field | consumed by |
|---|---|
| `pinned_source_sha` / `build_info.gitSha` | LIVE-VERIFY SHA domain |
| `build_info.builtAt` / `build_interval` | ROLL `EXPECTED_BUILT_AT` |
| `build_info.sha256` / `build_info.base64` | ROLL `EXPECTED_BUILD_INFO_SHA256` |
| `canonical_pushed_digest` / `cloud_build_result_digest` / `repo_digests[]` | ROLL retag; LIVE-VERIFY membership |
| `cred_preflight` / `cloud_build_id` / `cloud_build_location` / SA / `executable_hashes` / `evidence` | provenance |

## Completion

Publish the receipt, `build.log`, `builds-describe.json` as **Hub evidence** + record refs before BUILD
completes and ROLL is authored. A submitted-but-failed attempt preserves+publishes its failure manifest +
`.sha256` and uses a **distinct successor tag**.
