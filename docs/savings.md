# Savings with a partner's vault

Savings moves a wallet's dollars into an ERC-4626 vault for AUSD and back, one signature each way.
`KovaSaver` (`apps/card/contracts/src/KovaSaver.sol`) carries each signature out and Kova's relayer
pays the gas: in, an EIP-3009 `receiveWithAuthorization` that only KovaSaver can use, deposited in
the wallet's own name; out, an EIP-2612 permit on the vault's shares, redeemed straight back to
the wallet. KovaSaver holds nothing between calls and has no owner.

- API: `apps/api/src/services/money.ts` (`savingsFor`, `saveIn`, `saveOut`), served at
  `GET /v1/wallets/:address/savings` and `POST …/savings/in` and `…/savings/out`.
- Screens: Savings on the web (`apps/web/src/components/wallet/money.tsx`) and the iPhone
  (`apps/mobile/src/app/savings.tsx`). Without a vault they say "Request access".

## setsAUSD (Setsuna), the first partner vault

[setsAUSD](https://monadscan.com/address/0x551903E3687820A733FBe406DD33Fee8D12bd2F3) on Monad
mainnet: AUSD in and out, held in setsUSDC (USDC lent across Aave, Morpho, Euler, Neverland and
Curvance), with AUSD↔USDC swapped on Curve's stable pool. Checked on 28 Oct 2026:

- On Monad: `asset()` is AUSD; shares are "Setsuna AUSD Savings" (setsAUSD), 12 decimals, EIP-712
  domain version "1"; no `owner()`; not a proxy; source an exact match on Sourcify. Capped at
  2,000 USDC across all its savers.
- Against an unchanged KovaSaver on a copy of mainnet
  (`apps/card/contracts/test/KovaSaverSetsunaFork.t.sol`): $10 in was worth $9.9989 in savings,
  and $9.9990 came back, with two signatures and no MON.
- Gas on Monad, as Setsuna measured it: about 1.24M in and 1.79M out. Kova caps savings at 3M.
- Unaudited, so the screens say plainly that it's new and can pause withdrawals.

### Trying it with Kova's own wallets first

`KOVA_SAVINGS_WALLETS` decides who can put money in. Unset on mainnet, nobody can, so pointing
mainnet at a vault never opens it to everyone by itself; `everyone` opens it to all. A wallet
already holding savings can always take them out, listed or not.

1. Deploy a KovaSaver in front of setsAUSD (a deployer key with a little MON):

   ```sh
   cd apps/card/contracts
   SAVINGS_VAULT=0x551903E3687820A733FBe406DD33Fee8D12bd2F3 forge script script/DeploySavings.s.sol \
     --rpc-url https://rpc.monad.xyz --private-key $KEY --broadcast
   ```

2. In Railway, on **monad-mainnet → api**:

   ```
   KOVA_SAVINGS_VAULT=0x551903E3687820A733FBe406DD33Fee8D12bd2F3
   KOVA_SAVER=<the KovaSaver from step 1>
   KOVA_SAVINGS_WALLETS=<your wallets, comma-separated>
   KOVA_SAVINGS_RATE_VAULT=0x0a531817EEFB7b1FFD7c511c0817F58ac343CC67
   ```

   setsAUSD is newer than a week, and its shares are setsUSDC's, so the recent rate is read from
   setsUSDC's share price.

3. Deploy the API. Savings opens for those wallets: save a few dollars, take them out, check both
   on Monadscan.

Before `everyone`: an audit (then `KOVA_SAVINGS_AUDITED=1`), and the yield product named wherever
partners ask what Kova offers (MoonPay's review asked).
