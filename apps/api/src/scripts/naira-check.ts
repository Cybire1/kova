/**
 * Naira in and out, end to end, through a Kova API on Monad testnet with a Paystack test key:
 * the rates (Chainlink on Monad); banks and an account's name; adding money in naira (Paystack's
 * published test card charged against the top-up's own reference, as its checkout page would,
 * then the dollars sent to the wallet on Monad); and cashing $1 out to a test bank account (the
 * wallet signs the quote's exact transfer to Kova's treasury, Kova relays it, Paystack pays the
 * account, or the dollars come back). Paystack's test mode moves no real naira.
 *
 * Usage: PAYSTACK_SECRET_KEY=sk_test_… FUNDER_KEY=0x… tsx src/scripts/naira-check.ts [api]
 * (FUNDER_KEY holds a dollar or two of testnet AUSD, for the cash-out; without it, that part is skipped)
 */
import { toSignedAuthorization, tokenByAddress, transferAuthorizationTypedData, networkByChainId } from '@kova/monad'
import { type Address, getAddress, type Hex } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'

const api = process.argv[2] ?? 'http://localhost:4413'
const paystack = process.env.PAYSTACK_SECRET_KEY
if (!paystack?.startsWith('sk_test_')) throw new Error('naira-check needs a Paystack TEST secret key')

let failures = 0
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`)
  if (!ok) failures += 1
}
const call = async <T>(path: string, init: RequestInit = {}): Promise<{ status: number; body: T }> => {
  const response = await fetch(`${api}${path}`, { ...init, headers: { 'content-type': 'application/json', ...init.headers } })
  return { status: response.status, body: (await response.json().catch(() => ({}))) as T }
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

const health = (await call<{ chain_id: number; network: string; settlement_token: { address: Address } }>('/health')).body
if (health.network !== 'testnet') throw new Error('naira-check is testnet only')
const net = networkByChainId(health.chain_id)
const token = tokenByAddress(net.id, health.settlement_token.address)
if (!token) throw new Error('unknown settlement token')

// 1. Rates and banks.
const info = (await call<{ enabled: boolean; test_mode: boolean; rate_source: string; market_rate: string; cash_out_rate: string; top_up_rate: string }>('/v1/naira')).body
check(info.enabled && info.test_mode, `naira on in Paystack test mode: market ₦${info.market_rate}/$ (${info.rate_source}), out ₦${info.cash_out_rate}, in ₦${info.top_up_rate}`)
const banks = (await call<{ data: { name: string; code: string }[] }>('/v1/naira/banks')).body.data
check(banks.length > 50 && banks.some((b) => b.code === '001'), `${banks.length} Nigerian banks, Paystack's test bank among them`)
const named = (await call<{ account_name?: string }>('/v1/naira/account', { method: 'POST', body: JSON.stringify({ account_number: '0000000000', bank_code: '001' }) })).body
check(Boolean(named.account_name), `the bank names the account: ${named.account_name}`)

// 2. Adding money in naira, to a brand-new wallet.
const newcomer = privateKeyToAccount(generatePrivateKey()).address
const started = await call<{ url: string; reference: string; naira: string; naira_kobo: string; status: string; error?: unknown }>(
  `/v1/wallets/${newcomer}/naira-top-ups`,
  { method: 'POST', body: JSON.stringify({ amount: '1.00', email: 'ada@example.com', return_url: 'http://localhost:3013/wallet/add/naira' }) },
)
check(started.status === 201 && started.body.url.startsWith('https://checkout.paystack.com/'), `$1.00 top-up costs ${started.body.naira}; Paystack checkout ${started.body.url}`)
// Paystack's checkout page is where the payer pays (behind Cloudflare's bot check, so a person does
// it: test card 4084 0840 8408 4081, CVV 408, any future date). NAIRA_WAIT=1 waits three minutes.
if (process.env.NAIRA_WAIT === '1') console.log(`     pay it now with Paystack's test card: ${started.body.url}`)
let topUp = (await call<{ status: string; tx_hash: Hex | null; tx_url: string | null; failure: string | null }>(`/v1/naira-top-ups/${started.body.reference}/verify`, { method: 'POST' })).body
for (let i = 0; i < (process.env.NAIRA_WAIT === '1' ? 60 : 1) && topUp.status !== 'settled' && topUp.status !== 'failed'; i++) {
  await wait(3000)
  topUp = (await call<typeof topUp>(`/v1/naira-top-ups/${started.body.reference}/verify`, { method: 'POST' })).body
}
if (topUp.status === 'initialized' && process.env.NAIRA_WAIT !== '1')
  console.log(`skip the top-up's payment: it needs a person on Paystack's page (NAIRA_WAIT=1); status ${topUp.status}`)
else {
  check(topUp.status === 'paid' || topUp.status === 'settled', `Paystack confirmed the naira: top-up ${topUp.status}${topUp.failure ? ` (${topUp.failure})` : ''}`)
  check(topUp.status === 'settled' && Boolean(topUp.tx_hash), `the dollars landed on Monad: ${topUp.tx_url ?? 'not yet'}`)
}
const again = (await call<{ status: string; tx_hash: Hex | null }>(`/v1/naira-top-ups/${started.body.reference}/verify`, { method: 'POST' })).body
check(again.tx_hash === topUp.tx_hash, 'verifying again sends nothing twice')

// 3. Cashing $1 out to Paystack's test bank.
const funderKey = process.env.FUNDER_KEY as Hex | undefined
if (!funderKey) {
  console.log('skip cash-out: no FUNDER_KEY')
} else {
  const ada = privateKeyToAccount(funderKey)
  const quote = await call<{
    id: string
    naira: string
    account_name: string
    pay: { to: Address; value: string; nonce: Hex; valid_before: number }
    error?: { message: string }
  }>(`/v1/wallets/${ada.address}/cash-outs`, { method: 'POST', body: JSON.stringify({ amount: '1.00', bank_code: '001', account_number: '0000000000' }) })
  check(quote.status === 201, `quoted ${quote.body.naira} to ${quote.body.account_name}${quote.body.error ? ` (${quote.body.error.message})` : ''}`)
  if (quote.status === 201) {
    const authorization = {
      from: ada.address,
      to: getAddress(quote.body.pay.to),
      value: BigInt(quote.body.pay.value),
      validAfter: 0n,
      validBefore: BigInt(quote.body.pay.valid_before),
      nonce: quote.body.pay.nonce,
    }
    // A wrong nonce is refused before anything moves.
    const wrong = await call<{ error?: { message: string } }>(`/v1/cash-outs/${quote.body.id}/pay`, {
      method: 'POST',
      body: JSON.stringify(toSignedAuthorization(token.address, { ...authorization, nonce: `0x${'11'.repeat(32)}` }, await ada.signTypedData(transferAuthorizationTypedData(token, net.chainId, { ...authorization, nonce: `0x${'11'.repeat(32)}` })))),
    })
    check(wrong.status === 400, `a transfer that isn't this cash-out's is refused: ${wrong.body.error?.message}`)
    const signature = await ada.signTypedData(transferAuthorizationTypedData(token, net.chainId, authorization))
    const t0 = performance.now()
    const paid = await call<{ status: string; tx_url: string | null; refund_tx_url: string | null; failure: string | null; error?: { message: string } }>(
      `/v1/cash-outs/${quote.body.id}/pay`,
      { method: 'POST', body: JSON.stringify(toSignedAuthorization(token.address, authorization, signature)) },
    )
    check(paid.status === 200 && Boolean(paid.body.tx_url), `the dollars reached Kova's treasury on Monad in ${Math.round(performance.now() - t0)} ms: ${paid.body.tx_url ?? paid.body.error?.message}`)
    let state = paid.body
    for (let i = 0; i < 10 && (state.status === 'paying' || state.status === 'received'); i++) {
      await wait(3000)
      state = (await call<typeof state>(`/v1/cash-outs/${quote.body.id}`)).body
    }
    check(
      state.status === 'paid' || (state.status === 'failed' && Boolean(state.refund_tx_url)),
      state.status === 'paid' ? 'Paystack paid the account' : `the bank didn't take it and the dollars came back: ${state.failure} ${state.refund_tx_url}`,
    )
    const twice = await call<{ status: string }>(`/v1/cash-outs/${quote.body.id}/pay`, {
      method: 'POST',
      body: JSON.stringify(toSignedAuthorization(token.address, authorization, signature)),
    })
    check(twice.body.status === state.status, 'handing the same transfer in again changes nothing')
  }
}

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
