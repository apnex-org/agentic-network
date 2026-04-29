# tpl/agents-lean.jq — lean Agent projection template for get-agents.sh
#
# Mission-66 W1+W2 commit 7a (architect-portion).
#
# Lean projection: just id + role + status + activity. For terse view
# (operator quick-glance; CI parse-friendly).
#
# Use case: `get-agents.sh --lean` for compact output; `get-agents.sh` (no
# flag) defaults to verbose tpl/agents.jq.

if type == "array" then
    [
        .[] | {
            id: (.id // .agentId // "?"),
            role: (.role // "?"),
            status: (.status // .livenessState // "?"),
            activity: (.activityState // "?")
        }
    ]
else
    .
end
