# Kova demo video: every transaction on screen

Recorded 14 Oct 2026 (WAT) against Kova's live testnet API (api-monad.up.railway.app) on Monad testnet
(chain 10143), with the iOS app (Kova iPhone 16 simulator, monad branch 8ac8667) and the testnet web
(web-monad.up.railway.app). Wallets: Sam 0x29cFE607BbC434fc51AEf6eC20E143fE75Bb1b22, Ada
0x7FFaDcA4e2eE6f1D064569fbA4449E48767C31fD, Lucía (made on camera) 0xF961Ce0E69bB0c09C87B10Bb1b25A1DFa9126d61.

| Scene | What | Tx |
|---|---|---|
| Café | Sam pays Ada's Bakery $3.25 from table 3 | 0x1d7346188f9af2e2df66983f19bf504280368e093986cf09fb3e8d7c3cd1e05f |
| Link | Sam funds a $0.50 link ("Coffee on me") | 0xff61177bd343b8562aaf7691652b541b95b01b131301b4e741259d6c89cf0de3 |
| Claim | Lucía claims it with a new passkey wallet (0.7 s) | 0x647c5359d954aa172e5a80a9e5a99d03b5e7f5f3a6787f08d23ddd9d46e1ff86 |
| No signal | Sam's $0.25 to Lucía, signed offline, settled when back online | 0x2df5dfdb7e68b57d864403cde2ee935e905760bd51da5bb001c5f0ed27fdbbe1 |
| Private | Ada pays Sam $0.15 at one-time address 0xc8B1510458A8D3C7DE7C6a218264A06C43CbFA5c (1.10 s) | 0xf7df5a1547d42be9410001cbf77095d9b66e551f37c87a9484faf5240e9b54c7 |
| Private | Its ERC-5564 Announcement on Monad | 0xc460c5b5d3b539850e6b109873d8ae873964c8b7fa1525a1e3b7e2bcb80bad0f |
| Mainnet | KovaCard contract page | 0x9bee9F2D59d9675F2723B274e1276F5931Ef325E (address) |

Not in the film: an earlier take's plain (not private) send, Ada to Sam $0.25,
0x555cd89a99864c1155290f731b922fc148247cf9586ab93371519598b8529eb3 (Sam's private-receiving key
wasn't on the live API yet; it was published before the private take).
