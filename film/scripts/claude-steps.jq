# Claude Code's stream-json, as a terminal reads it: Claude's words, each Kova tool call, and the
# first line of what Kova answered. Tool lookups (ToolSearch) are left out.
if .type == "assistant" then
  (.message.content[]? |
    if .type == "text" then "\u001b[1m⏺\u001b[0m " + .text
    elif .type == "tool_use" and (.name | startswith("mcp__kova__")) then
      "\u001b[1;36m⏺ " + (.name | sub("mcp__kova__"; "kova · ")) + "\u001b[0m " + (.input | tojson)
    else empty end)
elif .type == "user" then
  (.message.content[]? | select(.type == "tool_result") | .content
    | if type == "array" then (map(select(.type == "text") | .text) | join(" ")) else tostring end
    | select(length > 0) | "  \u001b[2m⎿\u001b[0m  " + (split("\n")[0]))
else empty end
