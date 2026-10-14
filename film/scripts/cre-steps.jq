# The CRE engine's own log lines for the steps that matter (the two HTTP fetches and consensus),
# condensed to one line each; every other line the CLI prints passes through untouched.
#   cre workflow simulate … -g 2>&1 | jq --unbuffered -Rr -f film/scripts/cre-steps.jq
. as $line
| (try fromjson catch null) as $j
| if ($j | type) != "object" then $line
  elif ($j.msg // "" | test("HTTP Action SendRequest Started")) then
    "  [engine] HTTP GET " + ($j.input | capture("url:\"(?<u>[^\"]+)\"").u)
  elif ($j.msg // "" | test("HTTP Action Finished")) then
    "  [engine] HTTP " + ($j.Status | tostring) + " from " + $j.URL
  elif ($j.msg // "" | test("Consensus")) then
    "  [engine] " + $j.msg + " · "
    + ([$j.input | scan("key:\"([A-Z]{3})\"\\s+value:\\{aggregation:AGGREGATION_TYPE_([A-Z]+)")]
       | map(.[0] + " " + (.[1] | ascii_downcase)) | join(", "))
  elif ($j.msg // "" | test("(?i)evm|writereport|write report|transmit|forwarder")) and ($j.msg | test("(?i)meter") | not) then
    "  [engine] " + $j.msg
  else empty end
