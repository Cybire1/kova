/**
 * Kova's reference exchange rates, as a Chainlink CRE workflow.
 *
 * Kova settles every payment in dollars (AUSD on Monad) and shows prices in the currency people
 * think in: naira, shillings, euros, pounds, pesos. The rate it shows them at should not come from
 * a table in an app, or from one server anyone could tamper with. So every 15 minutes, each node
 * of a Chainlink DON:
 *
 *   1. fetches two independent rate sources,
 *   2. cross-checks them, and drops any currency where they disagree by more than 2%,
 *   3. and the DON agrees on the median of what its nodes saw, field by field.
 *
 * The agreed rates are signed into a report and written to KovaRates on Monad, where Kova's app
 * and API read them.
 */
import {
  ConsensusAggregationByFields,
  type CronPayload,
  cre,
  getNetwork,
  type HTTPSendRequester,
  json,
  median,
  ok,
  prepareReportRequest,
  Runner,
  type Runtime,
  TxStatus,
} from '@chainlink/cre-sdk'
import { encodeAbiParameters, parseAbiParameters, toHex } from 'viem'

type Shared = {
  /** Six-field cron, seconds first. */
  schedule: string
  chainSelectorName: string
  gasLimit: string
  /** Largest disagreement between the two sources that still counts, as a fraction. */
  maxSpread: number
}

/**
 * Two closed shapes. `production` writes to KovaRates through the forwarder; `local-simulation`
 * runs the same fetches and consensus, then stops before any report or write (no receiver at all).
 */
type Config =
  | (Shared & { mode: 'production'; receiver: `0x${string}` })
  | (Shared & { mode: 'local-simulation'; receiver?: never })

/** The currencies Kova shows, besides dollars. */
const CODES = ['NGN', 'KES', 'EUR', 'GBP', 'MXN'] as const
type Code = (typeof CODES)[number]

/** Units of each currency one US dollar buys, scaled by 1e8. Zero: the sources disagreed. */
type Rates = Record<Code, bigint>

const SCALE = 100_000_000

const SOURCE_A = 'https://open.er-api.com/v6/latest/USD'
const SOURCE_B =
  'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json'

function fetchJson(sendRequester: HTTPSendRequester, url: string): unknown {
  const response = sendRequester.sendRequest({ url, method: 'GET' }).result()
  if (!ok(response)) throw new Error(`${url} answered ${response.statusCode}`)
  return json(response)
}

/** Runs on every node: both sources, cross-checked. */
function readRates(sendRequester: HTTPSendRequester, config: Config): Rates {
  const a = (fetchJson(sendRequester, SOURCE_A) as { rates?: Record<string, number> }).rates ?? {}
  const b = (fetchJson(sendRequester, SOURCE_B) as { usd?: Record<string, number> }).usd ?? {}
  const rates = {} as Rates
  for (const code of CODES) {
    const x = a[code]
    const y = b[code.toLowerCase()]
    const good = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0
    let value = 0
    if (good(x) && good(y))
      value = Math.abs(x - y) / Math.min(x, y) <= config.maxSpread ? (x + y) / 2 : 0
    rates[code] = BigInt(Math.round(value * SCALE))
  }
  return rates
}

function publish(runtime: Runtime<Config>, _payload: CronPayload): string {
  const config = runtime.config
  const rates = new cre.capabilities.HTTPClient()
    .sendRequest(
      runtime,
      readRates,
      ConsensusAggregationByFields<Rates>({
        NGN: median,
        KES: median,
        EUR: median,
        GBP: median,
        MXN: median,
      }),
    )(config)
    .result()

  const asOf = BigInt(Math.floor(runtime.now().getTime() / 1000))
  const codes = CODES.map((code) => toHex(code, { size: 3 }))
  const values = CODES.map((code) => rates[code])
  runtime.log(
    `rates at ${asOf}: ${CODES.map((code, i) => `${code} ${Number(values[i]) / SCALE}`).join(', ')}`,
  )

  // Local simulation ends here: no report, no client, nothing that could write.
  if (config.mode === 'local-simulation')
    return `local-simulation: ${values.filter((v) => v > 0n).length} rates agreed`
  if (config.mode !== 'production')
    throw new Error(`unknown mode ${(config as { mode: unknown }).mode}`)
  if (!/^0x[0-9a-fA-F]{40}$/.test(config.receiver) || /^0x0{40}$/.test(config.receiver))
    throw new Error('receiver must be KovaRates’ address')

  const payload = encodeAbiParameters(
    parseAbiParameters('uint64 asOf, bytes3[] codes, uint256[] perUsdE8'),
    [asOf, codes, values],
  )
  const report = runtime.report(prepareReportRequest(payload)).result()

  const network = getNetwork({
    chainFamily: 'evm',
    chainSelectorName: config.chainSelectorName,
    isTestnet: true,
  })
  if (!network) throw new Error(`unknown chain ${config.chainSelectorName}`)
  const written = new cre.capabilities.EVMClient(network.chainSelector.selector)
    .writeReport(runtime, {
      receiver: config.receiver,
      report,
      gasConfig: { gasLimit: config.gasLimit },
    })
    .result()
  if (written.txStatus !== TxStatus.SUCCESS)
    throw new Error(`writing the rates failed: ${written.errorMessage ?? written.txStatus}`)
  // A success with no transaction is not a success.
  if (!written.txHash || written.txHash.length === 0)
    throw new Error('the write reported success without a transaction')
  const hash = toHex(written.txHash)
  runtime.log(`published to ${config.receiver} in ${hash}`)
  return hash
}

const initWorkflow = (config: Config) => [
  cre.handler(
    new cre.capabilities.CronCapability().trigger({ schedule: config.schedule }),
    publish,
  ),
]

export async function main() {
  const runner = await Runner.newRunner<Config>()
  await runner.run(initWorkflow)
}

await main()
