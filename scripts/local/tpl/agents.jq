# tpl/agents.jq — verbose Agent projection template for get-agents.sh
#
# Mission-66 W1+W2 commit 7a (architect-portion) + post-M66 fix-forwards
# (HUB_API_TOKEN rename / 2-step session handshake / SNAKE_CASE headings /
# version-column refactor / name field).
#
# Input: post-unwrap array of Agent records from .result.content[0].text.
# Pipeline:
#   1. Engineer commit 7b unwraps result.content[0].text (JSON-stringified);
#      this template projects the resulting array to column-friendly fields
#   2. Field names use camelCase; buildTable() in get-agents.sh transforms
#      camelCase → SNAKE_CASE for headings (e.g. activityState → ACTIVITY_STATE)
#
# Version columns rationale (Director ratified post-#138 live-test):
#   - shimPlugin = clientMetadata.proxyVersion (claude-plugin shim version)
#   - adapter    = clientMetadata.sdkVersion stripped of @apnex/network-adapter@
#                  prefix (network-adapter SDK version)
#   - Useful for determining if 2 different clients have the same underlying
#     adapter code
#
# Reference: /home/apnex/taceng/table/tpl/*.jq pattern (memory:
# reference_prism_table_pattern.md).

if type == "array" then
    [
        .[] | {
            id: (.id // .agentId // "?"),
            name: (.name // "?"),
            role: (.role // "?"),
            livenessState: (.livenessState // .status // "?"),
            activityState: (.activityState // "?"),
            shimPlugin: (
                ((.clientMetadata.proxyName // "?") | split("/") | last | sub("-plugin$"; ""))
                + "-"
                + (.clientMetadata.proxyVersion // "?")
            ),
            adapter: ((.clientMetadata.sdkVersion // "?") | split("@") | last),
            llmModel: (.advisoryTags.llmModel // "?"),
            pid: (.clientMetadata.pid // "?"),
            labels: (.labels // {} | to_entries | map("\(.key)=\(.value)") | join(",") | if . == "" then "-" else . end)
        }
    ]
else
    .
end
