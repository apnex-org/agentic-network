#!/usr/bin/env bash
# hubfix0-build-capture.sh (v4) — build the immutable idea-528 Hub image + emit a frozen, complete receipt.
#
# NO prod touch: ONE create-once full-SHA+attempt tag; NEVER :latest, NEVER the VM. NEVER runs the image.
# CREDENTIAL-MODE-AGNOSTIC: a separate GOVERNED credential preflight must first (a) establish an isolated,
# already-authenticated env (HOME w/ no hub.env; CLOUDSDK_CONFIG authed as terraform@ via bridge-key OR WIF;
# docker AR-configured) AND (b) prove a FRESH token exchange, emitting a receipt. This script CONSUMES that
# env, BINDS the preflight receipt, and re-proves principal/project/authorization (liveness, NOT fresh-mint).
# Addresses v1 B1-B8, v2 V2-1..7, v3 V3-1..6. Approval binds this file's sha256 via external APPROVED_SELF_SHA.
set -euo pipefail

# ── FROZEN INPUTS (immutable WorkItem contract) ─────────────────────────────────────────
PINNED_SHA="${PINNED_SHA:?exact 40-lowercase-hex frozen source commit}"
ATTEMPT_ID="${ATTEMPT_ID:?unique attempt id, [A-Za-z0-9._-]{1,64}}"
APPROVED_SELF_SHA="${APPROVED_SELF_SHA:?steve-approved sha256 of THIS file (external bind)}"
CRED_PREFLIGHT_RECEIPT="${CRED_PREFLIGHT_RECEIPT:?path to the governed cred-preflight fresh-exchange receipt}"
CRED_PREFLIGHT_SHA="${CRED_PREFLIGHT_SHA:?expected sha256 of the cred-preflight receipt}"
IDEA528_SHA="${IDEA528_SHA:-db27857f0fa06d498baaef456988b3e8f93adaf4}"
BASE_REPO="${BASE_REPO:-/home/apnex/taceng/agentic-network}"
EXPECT_SA="${EXPECT_SA:-terraform@labops-389703.iam.gserviceaccount.com}"
RECEIPT_OUT="${RECEIPT_OUT:?create-only receipt path (must not exist)}"
EVIDENCE_DIR="${EVIDENCE_DIR:?create-only dir for preserved raw evidence (must not exist)}"

GCP_PROJECT="labops-389703"
GCP_REGION="australia-southeast1"
REGISTRY="${GCP_REGION}-docker.pkg.dev/${GCP_PROJECT}/cloud-run-source-deploy"
IMMUTABLE_TAG="${REGISTRY}/hub:hubfix0-${PINNED_SHA}-${ATTEMPT_ID}"
TAGNAME="hubfix0-${PINNED_SHA}-${ATTEMPT_ID}"

die(){ echo "[build-capture] ABORT: $*" >&2; exit 1; }
h(){ sha256sum "$1" | cut -d' ' -f1; }
HEX40='^[0-9a-f]{40}$'
UTC_RE='^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$'
CANON_DIGEST_RE="^${GCP_REGION}-docker\.pkg\.dev/${GCP_PROJECT}/cloud-run-source-deploy/hub@sha256:[0-9a-f]{64}$"
CANON_TAG_RE="^${GCP_REGION}-docker\.pkg\.dev/${GCP_PROJECT}/cloud-run-source-deploy/hub:hubfix0-[0-9a-f]{40}-[A-Za-z0-9._-]{1,64}$"
SA_RE='^[a-z0-9-]+@[a-z0-9.-]+\.(iam\.)?gserviceaccount\.com$'

# ── V2-2: self-hash enforcement before any GCP call ─────────────────────────────────────
SELF_SHA="$(h "${BASH_SOURCE[0]}")"
[[ "$SELF_SHA" == "$APPROVED_SELF_SHA" ]] || die "self-hash $SELF_SHA != approved (edited/unapproved script)"

# ── input validation ────────────────────────────────────────────────────────────────────
[[ "$PINNED_SHA"  =~ $HEX40 ]]              || die "PINNED_SHA 40-hex"
[[ "$IDEA528_SHA" =~ $HEX40 ]]              || die "IDEA528_SHA 40-hex"
[[ "$ATTEMPT_ID"  =~ ^[A-Za-z0-9._-]{1,64}$ ]] || die "ATTEMPT_ID shape"
[[ "$IMMUTABLE_TAG" =~ $CANON_TAG_RE ]]     || die "tag canonical shape"
[[ "$IMMUTABLE_TAG" != *:latest ]]          || die "tag must not be :latest"
[[ ! -e "$RECEIPT_OUT" ]]                   || die "RECEIPT_OUT exists (create-only)"
[[ ! -e "$EVIDENCE_DIR" ]]                  || die "EVIDENCE_DIR exists (create-only)"
[[ -f "$CRED_PREFLIGHT_RECEIPT" ]]          || die "cred-preflight receipt not found"
[[ "$(h "$CRED_PREFLIGHT_RECEIPT")" == "$CRED_PREFLIGHT_SHA" ]] || die "cred-preflight receipt hash mismatch"
for c in jq docker gcloud git sha256sum base64 tar date; do command -v "$c" >/dev/null || die "missing: $c"; done

# ── V2-6: consume the governed pre-authed isolated env; re-prove (liveness, not fresh-mint) ─
[[ -n "${HOME:-}" && -n "${CLOUDSDK_CONFIG:-}" ]] || die "HOME + CLOUDSDK_CONFIG must be the governed preflight env"
[[ ! -e "$HOME/.config/apnex-agents/hub.env" ]] || die "ambient hub.env present — not isolated (B1)"
unset GITHUB_SHA HUB_IMAGE_TAG PROJECT_ID REGION
ACT="$(gcloud config get-value account 2>/dev/null || true)"
[[ "$ACT" == "$EXPECT_SA" ]] || die "principal '$ACT' != '$EXPECT_SA'"
[[ "$(gcloud config get-value project 2>/dev/null)" == "$GCP_PROJECT" ]] || die "project != $GCP_PROJECT"

# EVIDENCE_DIR + phase tracking (V3-3): preserve after the first cloud action; manifest on exit.
mkdir -m 0700 "$EVIDENCE_DIR" || die "could not create EVIDENCE_DIR"
BUILD_LOG="$EVIDENCE_DIR/build.log"; DESC_JSON="$EVIDENCE_DIR/builds-describe.json"
BI_RAW="$EVIDENCE_DIR/build-info.json"; DEFSA_JSON="$EVIDENCE_DIR/default-cb-sa.json"
STATUS_JSON="$EVIDENCE_DIR/terminal-status.json"
PHASE="preflight"; WT=""; CID=""; OK=0
cleanup(){
  local rc=$?
  [[ -n "${CID:-}" ]] && docker rm -f "$CID" >/dev/null 2>&1 || true
  [[ -n "${WT:-}"  ]] && git -C "$BASE_REPO" worktree remove --force "$WT" >/dev/null 2>&1 || true
  if [[ "$PHASE" == "preflight" && "$OK" -ne 1 ]]; then
    rm -rf "$EVIDENCE_DIR" 2>/dev/null || true          # no cloud action taken -> discard empty dir
  else
    # V3-3/V3-6: submitted build or success -> PRESERVE + create-only terminal manifest
    [[ -e "$STATUS_JSON" ]] || printf '{"phase":"%s","ok":%s,"exit":%s}\n' "$PHASE" "$OK" "$rc" > "$STATUS_JSON" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# ── liveness / authorization probe (NOT a fresh-mint proof — that is the preflight receipt) ─
gcloud artifacts repositories describe cloud-run-source-deploy --location="$GCP_REGION" \
  --project="$GCP_PROJECT" >/dev/null 2>&1 || die "AR authorization/liveness probe failed"

# ── 1. clean detached worktree at the frozen commit — checkout proof FIRST ───────────────
WT="$(mktemp -d)/hubfix0-build"
git -C "$BASE_REPO" worktree add --detach "$WT" "$PINNED_SHA" >/dev/null
[[ "$(git -C "$WT" rev-parse HEAD)" == "$PINNED_SHA" ]]  || die "checkout HEAD != pinned"
[[ -z "$(git -C "$WT" status --porcelain)" ]]            || die "worktree not clean"
[[ "$(git -C "$WT" cat-file -t "$IDEA528_SHA" 2>/dev/null)" == commit ]] || die "IDEA528_SHA not a commit"
git -C "$WT" merge-base --is-ancestor "$IDEA528_SHA" "$PINNED_SHA" || die "idea-528 not ancestor of pinned"
BUILD_HUB_SHA="$(h "$WT/scripts/local/build-hub.sh")"; DOCKERFILE_SHA="$(h "$WT/hub/Dockerfile")"; LOCKFILE_SHA="$(h "$WT/package-lock.json")"

# ── V3-1: create-once via a SUCCESSFUL tags-list zero-match (never human stderr) ──────────
set +e
TAGS_JSON="$(gcloud artifacts docker tags list "${REGISTRY}/hub" --format=json 2>/dev/null)"; RC=$?
set -e
[[ $RC -eq 0 ]] || die "create-once inconclusive: tags list query failed"
jq -e --arg full "$IMMUTABLE_TAG" --arg t "$TAGNAME" \
   'any(.[]; (.tag==$full) or (.tag==$t) or ((.tag|tostring)|endswith(":"+$t)))' <<<"$TAGS_JSON" >/dev/null \
   && die "tag already exists (create-once): $IMMUTABLE_TAG"

# ── 2. immutable build+push — worktree build-hub.sh; interval bind ───────────────────────
PHASE="submitted"                                          # first cloud WRITE begins -> evidence now preserved
BUILD_START="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
env -u GITHUB_SHA HOME="$HOME" CLOUDSDK_CONFIG="$CLOUDSDK_CONFIG" \
    GCP_PROJECT="$GCP_PROJECT" GCP_REGION="$GCP_REGION" \
    HUB_IMAGE_TAG="$IMMUTABLE_TAG" OIS_ENV=prod CI=1 \
    "$WT/scripts/local/build-hub.sh" 2>&1 | tee "$BUILD_LOG"
grep -qF "Image pushed to $IMMUTABLE_TAG" "$BUILD_LOG" || die "push confirmation not found"
BUILD_END="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# ── 3. bind the build-SPECIFIC result ────────────────────────────────────────────────────
CB_ID="$(grep -oiE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' "$BUILD_LOG" | head -1 || true)"
[[ -n "$CB_ID" ]] || die "no Cloud Build ID captured"
gcloud builds describe "$CB_ID" --format=json > "$DESC_JSON" 2>/dev/null \
  || gcloud builds describe "$CB_ID" --region="$GCP_REGION" --format=json > "$DESC_JSON" 2>/dev/null \
  || die "builds describe $CB_ID failed"
[[ "$(jq -r '.status' "$DESC_JSON")" == SUCCESS ]] || die "Cloud Build != SUCCESS"
[[ "$(jq -r '.results.images | length' "$DESC_JSON")" == 1 ]] || die "expected exactly one result image"
[[ "$(jq -r '.results.images[0].name' "$DESC_JSON")" == "$IMMUTABLE_TAG" ]] || die "result name != frozen tag"
RESULT_DIGEST="$(jq -r '.results.images[0].digest' "$DESC_JSON")"
[[ "$RESULT_DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]] || die "result digest not canonical"
# V3-2: builder SA — from the build object, else the AUTHORITATIVE default (retain raw receipt)
BUILDER_SA="$(jq -r '.serviceAccount // empty' "$DESC_JSON")"; BUILDER_SA="${BUILDER_SA##*/}"
if [[ -z "$BUILDER_SA" ]]; then
  gcloud builds get-default-service-account --project="$GCP_PROJECT" --format=json > "$DEFSA_JSON" 2>/dev/null \
    || die "get-default-service-account failed"
  BUILDER_SA="$(jq -r '.serviceAccountEmail // .name // empty' "$DEFSA_JSON")"; BUILDER_SA="${BUILDER_SA##*/}"
fi
[[ "$BUILDER_SA" =~ $SA_RE ]] || die "builder SA not a valid principal: $BUILDER_SA"

# ── 3b. AR cross-check ────────────────────────────────────────────────────────────────────
PUSHED_REF="$(gcloud artifacts docker images describe "$IMMUTABLE_TAG" \
  --format='value(image_summary.fully_qualified_digest)' 2>/dev/null || true)"
[[ "$PUSHED_REF" =~ $CANON_DIGEST_RE ]] || die "AR digest not canonical: $PUSHED_REF"
[[ "${PUSHED_REF##*@}" == "$RESULT_DIGEST" ]] || die "AR digest != build-result digest (tag moved)"

# ── 4. NO-EXEC extraction + RepoDigests membership ───────────────────────────────────────
docker pull "$PUSHED_REF" >/dev/null || die "docker pull of canonical digest failed"
mapfile -t RDS < <(docker inspect "$PUSHED_REF" --format '{{range .RepoDigests}}{{println .}}{{end}}')
printf '%s\n' "${RDS[@]}" | grep -qxF "$PUSHED_REF" || die "pushed ref not a MEMBER of .RepoDigests[]"
CID="$(docker create "$PUSHED_REF")"; docker cp "$CID:/repo/hub/build-info.json" - | tar -xO > "$BI_RAW"; docker rm -f "$CID" >/dev/null; CID=""
jq -e 'type=="object" and has("gitSha") and has("builtAt")' "$BI_RAW" >/dev/null || die "build-info schema invalid"
BI_GITSHA="$(jq -r '.gitSha' "$BI_RAW")"; BI_BUILTAT="$(jq -r '.builtAt' "$BI_RAW")"
[[ "$BI_GITSHA" =~ $HEX40 && "$BI_GITSHA" == "$PINNED_SHA" ]] || die "build-info.gitSha != pinned"
[[ "$BI_BUILTAT" =~ $UTC_RE ]] || die "builtAt not canonical UTC shape"
[[ "$(date -u -d "$BI_BUILTAT" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null)" == "$BI_BUILTAT" ]] || die "builtAt not a round-trip-valid instant"   # V3-6
{ [[ "$BI_BUILTAT" > "$BUILD_START" || "$BI_BUILTAT" == "$BUILD_START" ]] && [[ "$BI_BUILTAT" < "$BUILD_END" || "$BI_BUILTAT" == "$BUILD_END" ]]; } || die "builtAt outside build interval"
BI_SHA256="$(h "$BI_RAW")"; BI_B64="$(base64 -w0 "$BI_RAW")"; BUILD_LOG_SHA="$(h "$BUILD_LOG")"; DESC_SHA="$(h "$DESC_JSON")"

# ── 5. emit the immutable, complete receipt — create-only ────────────────────────────────
RDS_JSON="$(printf '%s\n' "${RDS[@]}" | jq -R . | jq -s .)"
umask 077
( set -C
  jq -n \
    --arg pinned "$PINNED_SHA" --arg idea528 "$IDEA528_SHA" --arg tag "$IMMUTABLE_TAG" \
    --arg digest "$PUSHED_REF" --arg rdigest "$RESULT_DIGEST" --arg cbid "$CB_ID" \
    --arg sub "$ACT" --arg bld "$BUILDER_SA" --arg credsha "$CRED_PREFLIGHT_SHA" \
    --arg gsha "$BI_GITSHA" --arg bat "$BI_BUILTAT" --arg bsha "$BI_SHA256" --arg bb64 "$BI_B64" \
    --arg bstart "$BUILD_START" --arg bend "$BUILD_END" \
    --arg bh "$BUILD_HUB_SHA" --arg dh "$DOCKERFILE_SHA" --arg lh "$LOCKFILE_SHA" --arg sh "$SELF_SHA" \
    --arg blog "$BUILD_LOG_SHA" --arg dj "$DESC_SHA" --arg blogp "$BUILD_LOG" --arg djp "$DESC_JSON" --arg birp "$BI_RAW" \
    --argjson rds "$RDS_JSON" \
    '{ node:"hubfix0-BUILD", pinned_source_sha:$pinned, idea528_ancestor_sha:$idea528,
       immutable_tag:$tag, canonical_pushed_digest:$digest, cloud_build_result_digest:$rdigest, repo_digests:$rds,
       cloud_build_id:$cbid, submitted_by_sa:$sub, cloud_build_service_account:$bld,
       cred_preflight_receipt_sha256:$credsha, build_interval:{start:$bstart,end:$bend},
       build_info:{gitSha:$gsha,builtAt:$bat,sha256:$bsha,base64:$bb64},
       executable_hashes:{build_hub_sh:$bh,dockerfile:$dh,lockfile:$lh,capture_script:$sh},
       evidence:{build_log:{path:$blogp,sha256:$blog},builds_describe:{path:$djp,sha256:$dj},build_info_raw:$birp,default_cb_sa_lookup:"(if used) default-cb-sa.json"},
       github_sha:"unset", no_latest:true, no_prod_touch:true }' > "$RECEIPT_OUT"
) || die "receipt create-only write failed"
OK=1
RECEIPT_SHA="$(h "$RECEIPT_OUT")"
printf '{"phase":"complete","ok":1,"receipt_sha256":"%s"}\n' "$RECEIPT_SHA" > "$STATUS_JSON"
echo "[build-capture] OK — receipt $RECEIPT_OUT (sha256 $RECEIPT_SHA); digest $PUSHED_REF"
echo "[build-capture] evidence in $EVIDENCE_DIR ; COMPLETION REQUIRES publishing receipt + build.log + builds-describe.json as Hub evidence and recording their refs before ROLL."
