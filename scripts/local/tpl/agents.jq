# tpl/agents.jq — verbose Agent projection template for get-agents.sh
#
# Mission-66 W1+W2 commit 7a (architect-portion).
#
# Input: raw JSON-RPC response from /mcp tools/call get_agents
# Pipeline:
#   1. Engineer commit 7b unwraps result.content[0].text (JSON-stringified
#      Agent projection); this template projects the resulting array
#   2. Returns array-of-objects with column-friendly fields
#
# Verbose projection per Director's 2026-04-29 ask: clientMetadata +
# advisoryTags + labels + lastSeenAt + status. Ergonomic frontend that ALSO
# surfaces #40 projection gaps to operator visibility immediately.
#
# Reference: /home/apnex/taceng/table/tpl/*.jq pattern (memory:
# reference_prism_table_pattern.md).

# Engineer commit 7b unwraps .result.content[0].text first; this template
# expects the post-unwrap array of Agent records as input.

if type == "array" then
    [
        .[] | {
            id: (.id // .agentId // "?"),
            role: (.role // "?"),
            status: (.status // .livenessState // "?"),
            activity: (.activityState // "?"),
            adapterVersion: (.advisoryTags.adapterVersion // "?"),
            llmModel: (.advisoryTags.llmModel // "?"),
            proxyVersion: (.clientMetadata.proxyVersion // "?"),
            sdkVersion: (.clientMetadata.sdkVersion // "?"),
            pid: (.clientMetadata.pid // "?"),
            labels: (.labels // {} | to_entries | map("\(.key)=\(.value)") | join(",") | if . == "" then "-" else . end),
            lastSeenAt: (.lastSeenAt // "?")
        }
    ]
else
    .
end
