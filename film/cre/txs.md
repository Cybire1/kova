# Kova rates on Chainlink CRE: the runs behind film/out/kova-cre.mp4 (14 Oct 2026, Monad testnet)

| Run | Command | Result |
|---|---|---|
| In the film | `cre workflow simulate kova-rates --target staging-settings --broadcast --non-interactive --trigger-index 0 -g 2>&1 \| jq --unbuffered -Rr -f ../../film/scripts/cre-steps.jq` | tx `0xb5f7efae050b65bb84c8a54d67b430cfb44ca3247bf66ae0ef6e830bb9004130`, block 70,829,073, success; KovaRates event as-of 1791939356; forwarder `ReportProcessed(receiver = KovaRates, result = true)` |
| First take (not in the film) | the same, without `-g` and the filter | tx `0xf9b75203b6666030e4f472ef90c79b2b5673fb52795e92a914734b0c2fe9666e`, block 70,828,602, success |
| Dry runs | `--target local-simulation` | no transaction ("local-simulation: 5 rates agreed") |

KovaRates: `0xb5322DC6d6AA938C50859f0f0e2DF7b6Da4C9e8e`. Chainlink forwarder (tx `to`): `0xB9F79d863261869B234c481d1F9A7Af84AeAd192`.
After the run, `GET https://api-monad.up.railway.app/v1/rates` served the same rates with `as_of` 2026-10-14T00:55:56Z.
Terminal recordings: public/cre/*.cast (asciicast v2, real timing; scripts/record-cast.py), rendered with agg.
