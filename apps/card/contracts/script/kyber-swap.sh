#!/usr/bin/env bash
# A live KyberSwap route on Monad mainnet, AUSD -> USDC unless TOKEN_IN / TOKEN_OUT say otherwise,
# built for <sender> as the router's caller and recipient. Prints abi.encode(uint256 amountOut,
# bytes data) for the fork test.
#
#   bash script/kyber-swap.sh <amountIn> <sender>
set -euo pipefail
amount=$1
sender=$2
api=https://aggregator-api.kyberswap.com/monad/api/v1
token_in=${TOKEN_IN:-0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a}
token_out=${TOKEN_OUT:-0x754704Bc059F8C67012fEd69BC8A327a5aafb603}

route=$(curl -fsS --max-time 20 -H 'x-client-id: kova' \
  "$api/routes?tokenIn=$token_in&tokenOut=$token_out&amountIn=$amount")
body=$(python3 -c '
import json, sys
summary = json.loads(sys.argv[1])["data"]["routeSummary"]
print(json.dumps({"routeSummary": summary, "sender": sys.argv[2], "recipient": sys.argv[2],
                  "slippageTolerance": 50, "source": "kova"}))' "$route" "$sender")
built=$(curl -fsS --max-time 20 -X POST -H 'content-type: application/json' -H 'x-client-id: kova' \
  --data "$body" "$api/route/build")
read -r out data < <(python3 -c '
import json, sys
d = json.loads(sys.argv[1])["data"]
print(d["amountOut"], d["data"])' "$built")
cast abi-encode 'f(uint256,bytes)' "$out" "$data"
