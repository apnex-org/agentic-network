#!/usr/bin/env bash
# pi-models-seed.test.sh — bug-271: prove pi per-seat models.json seeding is a
# fail-closed fleet-rendered file, not an implicit ~/.pi/agent or workspace fallback.
#
# Rewritten for the provider catalog: models.json is DERIVED from fleet.json .providers
# (carried onto the cell as .fleetProviders) via the cell's piProvider/piModel selection,
# rather than restated as a harness-level piModels table. The contract under test is now the
# property — "the seat's selected provider/model is declared with a usable window" — not the
# former literal `openai-codex.modelOverrides[gpt-5.5].contextWindow == 400000`.
#
# The test sets HOME to a temp dir BEFORE sourcing ois. It deliberately does NOT create
# ~/.pi/agent/models.json; the durable contract is that pi_seed can render the policy into
# PI_CODING_AGENT_DIR from OIS fleet declaration/code alone.
set -uo pipefail

TDIR="$(mktemp -d)"
export HOME="$TDIR/home"
mkdir -p "$HOME"

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$DIR/../bin/ois"   # loads pi_models_seed; source-guard skips CLI dispatch
set +e

cleanup() { rm -rf "$TDIR"; }
trap cleanup EXIT

fail=0
fail_case() { echo "  FAIL: $*"; fail=1; }
ok_case() { echo "  ok: $*"; }

# A built-in provider (no baseUrl) -> renders as modelOverrides, auth via pi's auth bridge.
CATALOG_NATIVE='{"openai-codex":{"models":{"gpt-5.5":{"contextWindow":400000}}}}'
# A proxied provider (baseUrl) -> renders as a full registration with a ${VAR} apiKey.
CATALOG_PROXY='{"litellm-test":{"baseUrl":"http://proxy.test/v1","api":"anthropic-messages","credential":"litellm-test","models":{"big-model":{"name":"Big","contextWindow":1000000,"maxTokens":128000}}}}'
CREDS='{"litellm-test":{"secretRef":"litellm/test.key","injectAs":"LITELLM_TEST_API_KEY"}}'

CELL='{"cellAgent":"greg","piProvider":"openai-codex","piModel":"gpt-5.5","fleetProviders":'"$CATALOG_NATIVE"',"fleetCredentials":{}}'
PROXY_CELL='{"cellAgent":"greg","piProvider":"litellm-test","piModel":"big-model","fleetProviders":'"$CATALOG_PROXY"',"fleetCredentials":'"$CREDS"'}'
NO_PROVIDER_CELL='{"cellAgent":"greg","fleetProviders":'"$CATALOG_NATIVE"'}'
UNKNOWN_PROVIDER_CELL='{"cellAgent":"greg","piProvider":"nope","piModel":"gpt-5.5","fleetProviders":'"$CATALOG_NATIVE"',"fleetCredentials":{}}'
UNKNOWN_MODEL_CELL='{"cellAgent":"greg","piProvider":"openai-codex","piModel":"gpt-9","fleetProviders":'"$CATALOG_NATIVE"',"fleetCredentials":{}}'
# baseUrl provider whose credential has no injectAs — must not render a broken apiKey.
NOCRED_CELL='{"cellAgent":"greg","piProvider":"litellm-test","piModel":"big-model","fleetProviders":'"$CATALOG_PROXY"',"fleetCredentials":{}}'

SEAT="$TDIR/seat-pi"
mkdir -p "$SEAT"

write_models_native() {
  cat > "$1" <<'JSON'
{
  "providers": {
    "openai-codex": {
      "modelOverrides": {
        "gpt-5.5": {
          "contextWindow": 400000
        }
      }
    }
  }
}
JSON
}

write_models_wrong_model() {   # declares a DIFFERENT model than the cell selects
  cat > "$1" <<'JSON'
{
  "providers": {
    "openai-codex": {
      "modelOverrides": {
        "some-other-model": {
          "contextWindow": 400000
        }
      }
    }
  }
}
JSON
}

write_models_native_extra_provider() {
  cat > "$1" <<'JSON'
{
  "providers": {
    "openai-codex": {
      "modelOverrides": {
        "gpt-5.5": {
          "contextWindow": 400000
        }
      }
    },
    "extra-provider": {
      "models": [
        {
          "id": "x",
          "contextWindow": 999,
          "maxTokens": 1
        }
      ]
    }
  }
}
JSON
}

# --- the anti-duplication invariant, checkable in the repo -------------------------------
# fleet.json (the catalog) is workstation-local, so the repo cannot assert its contents. What
# the repo CAN assert is the invariant that replaced the old check: the harness config must
# not restate provider/model, because a second declaration is what let the rendered seat file
# disagree with the model the seat actually runs.
CONFIG_PI="$DIR/../../config/harnesses/pi.json"
if [[ -f "$CONFIG_PI" ]]; then
  if jq -e '(.piModels == null) and (.piSettings.defaultProvider == null) and (.piSettings.defaultModel == null)' "$CONFIG_PI" >/dev/null 2>&1; then
    ok_case "repo config/harnesses/pi.json restates no provider/model (catalog is sole source)"
  else
    fail_case "repo config/harnesses/pi.json still declares piModels or piSettings.default{Provider,Model}"
  fi
else
  fail_case "repo config/harnesses/pi.json missing"
fi

DEPLOY_SH="$DIR/../deploy.sh"
out=$(HOME="$TDIR/deploy-home" "$DEPLOY_SH" --diff 2>&1); rc=$?
if [[ $rc -eq 0 && "$out" == *"config/harnesses/pi.json diff"* ]]; then
  ok_case "deploy --diff resolves repo-root config/harnesses/pi.json for co-ship guard"
else
  fail_case "deploy --diff did not resolve repo pi harness config correctly rc=$rc: $out"
fi

# --- fail-closed on unresolvable selections ----------------------------------------------
out=$(pi_models_seed greg "$SEAT" "$NO_PROVIDER_CELL" 2>&1); rc=$?
[[ $rc -ne 0 ]] && ok_case "cell with no piProvider rejected fail-closed" || fail_case "cell with no piProvider was accepted"

out=$(pi_models_seed greg "$SEAT" "$UNKNOWN_PROVIDER_CELL" 2>&1); rc=$?
[[ $rc -ne 0 ]] && ok_case "provider absent from the catalog rejected fail-closed" || fail_case "unknown provider was accepted"
[[ "$out" == *"nope"* ]] && ok_case "unknown-provider error names the offending provider" || fail_case "unknown-provider error did not name it: $out"

out=$(pi_models_seed greg "$SEAT" "$UNKNOWN_MODEL_CELL" 2>&1); rc=$?
[[ $rc -ne 0 ]] && ok_case "model absent from the provider's catalog entry rejected fail-closed" || fail_case "unknown model was accepted"

out=$(pi_models_seed greg "$SEAT" "$NOCRED_CELL" 2>&1); rc=$?
[[ $rc -ne 0 ]] && ok_case "baseUrl provider with no credential injectAs rejected fail-closed" || fail_case "baseUrl provider rendered without a resolvable apiKey"

# --- native provider render ---------------------------------------------------------------
out=$(pi_models_seed greg "$SEAT" "$CELL" 2>&1); rc=$?
[[ $rc -eq 0 ]] || fail_case "missing target seed returned rc=$rc: $out"
[[ -f "$SEAT/models.json" && ! -L "$SEAT/models.json" ]] || fail_case "per-seat models.json is not an explicit rendered file"
[[ ! -e "$HOME/.pi/agent/models.json" ]] || fail_case "test unexpectedly created/relied on global ~/.pi/agent/models.json"
pi_models_valid "$SEAT/models.json" openai-codex gpt-5.5 && ok_case "native provider rendered as modelOverrides without global fallback" || fail_case "rendered native models policy is not valid"
jq -e '.providers["openai-codex"].modelOverrides["gpt-5.5"].contextWindow == 400000' "$SEAT/models.json" >/dev/null \
  && ok_case "native render preserves the pre-catalog shape exactly (no seat churn on migration)" \
  || fail_case "native render changed shape"

out=$(pi_models_seed greg "$SEAT" "$CELL" 2>&1); rc=$?
[[ $rc -eq 0 ]] && ok_case "existing matching rendered models file is idempotent" || fail_case "idempotent models seed failed rc=$rc: $out"
[[ -f "$SEAT/models.json" && ! -L "$SEAT/models.json" ]] || fail_case "idempotent seed left models.json as symlink"

# --- proxied provider render --------------------------------------------------------------
PROXY_SEAT="$TDIR/seat-proxy"; mkdir -p "$PROXY_SEAT"
out=$(pi_models_seed greg "$PROXY_SEAT" "$PROXY_CELL" 2>&1); rc=$?
[[ $rc -eq 0 ]] || fail_case "proxied provider seed returned rc=$rc: $out"
pi_models_valid "$PROXY_SEAT/models.json" litellm-test big-model && ok_case "proxied provider rendered as a full registration" || fail_case "proxied render is not valid"
jq -e '.providers["litellm-test"].apiKey == "${LITELLM_TEST_API_KEY}"' "$PROXY_SEAT/models.json" >/dev/null \
  && ok_case "apiKey rendered as an env REFERENCE, never the secret value" \
  || fail_case "apiKey was not rendered as a \${VAR} reference"
grep -q 'litellm/test.key' "$PROXY_SEAT/models.json" && fail_case "secret ref leaked into the rendered file" || ok_case "no secret path leaked into the rendered file"
jq -e '.providers | keys == ["litellm-test"]' "$PROXY_SEAT/models.json" >/dev/null \
  && ok_case "only the cell's own provider is emitted (one endpoint's key never reaches another's seat)" \
  || fail_case "render emitted providers the cell did not select"

# CROSS-FAMILY CHECK: every assertion above reads the rendered JSON with jq — the same family
# of instrument that produced it. This one hands the file to pi's OWN loader and asks what pi
# sees, which is the only check that can catch a file that is structurally plausible but not
# actually consumable (wrong api name, unresolvable ${VAR}, a field pi ignores).
#
# It replaces a codex-provider smoke that asserted gpt-5.5/400K through a hand-written
# api_key auth.json. That assertion has been RED on main independently of this change — pi
# 0.82 rejects the fixture because openai-codex authenticates by OAuth, so it contributed no
# coverage. The proxied provider authenticates by env-var api key, which pi resolves natively,
# so the same intent is now testable AND exercises the new registration path end to end.
echo '{}' > "$PROXY_SEAT/auth.json"
if command -v pi >/dev/null 2>&1; then
  list_out=$(LITELLM_TEST_API_KEY=fake-test-key PI_CODING_AGENT_DIR="$PROXY_SEAT" pi --offline --list-models big-model 2>&1); list_rc=$?
  [[ $list_rc -eq 0 && "$list_out" == *"litellm-test"* && "$list_out" == *"big-model"* && "$list_out" == *"1M"* ]] \
    && ok_case "pi's own loader reads the rendered registration: litellm-test/big-model at 1M" \
    || fail_case "pi --list-models did not report the rendered provider: rc=$list_rc output=$list_out"
  # The ${VAR} reference must be load-bearing: with the env var absent pi must find no model,
  # proving the key is resolved from the launch env and not baked into the file.
  noenv_out=$(env -u LITELLM_TEST_API_KEY PI_CODING_AGENT_DIR="$PROXY_SEAT" pi --offline --list-models big-model 2>&1)
  [[ "$noenv_out" != *"big-model"* ]] \
    && ok_case "without the injected env var pi resolves no model (apiKey is a reference, not a value)" \
    || fail_case "model resolved without the credential env var: $noenv_out"
else
  ok_case "pi CLI not on PATH; skipped optional --list-models smoke"
fi

# --- fail-closed on unsafe pre-existing targets -------------------------------------------
VALID_LINK_TARGET="$TDIR/valid-linked-models.json"
write_models_native "$VALID_LINK_TARGET"
rm -f "$SEAT/models.json" && ln -s "$VALID_LINK_TARGET" "$SEAT/models.json"
out=$(pi_models_seed greg "$SEAT" "$CELL" 2>&1); rc=$?
[[ $rc -eq 0 ]] || fail_case "valid mitigation symlink should be replaceable rc=$rc: $out"
[[ -f "$SEAT/models.json" && ! -L "$SEAT/models.json" ]] && ok_case "valid mitigation symlink replaced by explicit rendered file" || fail_case "valid symlink was not replaced by rendered file"

BAD_LINK_TARGET="$TDIR/bad-linked-models.json"
write_models_wrong_model "$BAD_LINK_TARGET"
rm -f "$SEAT/models.json" && ln -s "$BAD_LINK_TARGET" "$SEAT/models.json"
out=$(pi_models_seed greg "$SEAT" "$CELL" 2>&1); rc=$?
[[ $rc -ne 0 ]] && ok_case "symlink to a policy lacking the cell's model rejected fail-closed" || fail_case "wrong models symlink was accepted"
[[ -L "$SEAT/models.json" ]] || fail_case "wrong symlink was modified"

rm -f "$SEAT/models.json"
write_models_native_extra_provider "$SEAT/models.json"
out=$(pi_models_seed greg "$SEAT" "$CELL" 2>&1); rc=$?
[[ $rc -ne 0 ]] && ok_case "valid-but-non-equivalent per-seat models rejected fail-closed" || fail_case "non-equivalent target was overwritten"
grep -q 'extra-provider' "$SEAT/models.json" && ok_case "non-equivalent per-seat models was preserved" || fail_case "extra provider policy was removed"

rm -f "$SEAT/models.json"
write_models_wrong_model "$SEAT/models.json"
out=$(pi_models_seed greg "$SEAT" "$CELL" 2>&1); rc=$?
[[ $rc -ne 0 ]] && ok_case "per-seat models lacking the cell's model rejected fail-closed" || fail_case "wrong-model target was overwritten"
jq -e '.providers["openai-codex"].modelOverrides["some-other-model"]' "$SEAT/models.json" >/dev/null \
  && ok_case "wrong-model per-seat file was preserved untouched" || fail_case "wrong-model per-seat file was modified"

# A catalog entry declaring a non-positive window must not render a "valid" policy.
BAD_CATALOG_CELL='{"cellAgent":"greg","piProvider":"openai-codex","piModel":"gpt-5.5","fleetProviders":{"openai-codex":{"models":{"gpt-5.5":{"contextWindow":0}}}},"fleetCredentials":{}}'
rm -f "$SEAT/models.json"
out=$(pi_models_seed greg "$SEAT" "$BAD_CATALOG_CELL" 2>&1); rc=$?
[[ $rc -ne 0 ]] && ok_case "catalog entry with a non-positive contextWindow rejected fail-closed" || fail_case "non-positive contextWindow was accepted"

echo
if [[ $fail -eq 0 ]]; then
  echo "PASS: pi models seed derives from the provider catalog and fails closed on unsafe states"
  exit 0
else
  echo "FAIL: pi models seed contract violated"
  exit 1
fi
