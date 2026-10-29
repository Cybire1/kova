import { serve } from '@hono/node-server'
import { runMigrations } from '@kova/db'
import { Hono } from 'hono'
import { logger } from 'hono/logger'
import { feePayerAddress, network } from './chain.js'
import { config } from './config.js'
import { errorHandler } from './errors.js'
import { accountRoutes } from './routes/account.js'
import { businessRoutes } from './routes/business.js'
import { cardRoutes, cardTapRoutes } from './routes/cards.js'
import { catalogRoutes } from './routes/catalog.js'
import { checkoutRoutes } from './routes/checkout.js'
import { demoRoutes } from './routes/demo.js'
import { healthRoutes } from './routes/health.js'
import { insightRoutes } from './routes/insights.js'
import { intentRoutes } from './routes/intents.js'
import { iosBetaRoutes } from './routes/ios-beta.js'
import { linkRoutes } from './routes/links.js'
import { mcpRoutes } from './routes/mcp.js'
import { moneyRoutes } from './routes/money.js'
import { nairaRoutes } from './routes/naira.js'
import { orderRoutes } from './routes/orders.js'
import { phoneRoutes } from './routes/phone.js'
import { rateRoutes } from './routes/rates.js'
import { reportRoutes } from './routes/reports.js'
import { spendKeyRoutes } from './routes/spend-keys.js'
import { stallRoutes } from './routes/stalls.js'
import { statsRoutes } from './routes/stats.js'
import { stockTradeRoutes } from './routes/stock-trades.js'
import { stockRoutes } from './routes/stocks.js'
import { takingsRoutes } from './routes/takings.js'
import { terminalRoutes } from './routes/terminals.js'
import { travelRoutes } from './routes/travel.js'
import { ussdRoutes } from './routes/ussd.js'
import { walletRoutes } from './routes/wallet.js'
import { webhookRoutes } from './routes/webhooks.js'
import { startDemo } from './services/demo.js'
import { expireStaleIntents } from './services/intents.js'
import { checkPayingCashOuts, retryTopUps } from './services/naira.js'
import { recoverPhonePayments } from './services/phone-payments.js'
import { reconcilePendingPockets } from './services/pockets.js'
import { rateBook } from './services/rates.js'
import { popularStocks } from './services/stocks.js'
import { expireTrips } from './services/travel.js'
import { redactCallbackLog } from './services/ussd-callback.js'
import { startAnnouncer } from './workers/announcer.js'
import { startPruner } from './workers/prune.js'
import { startWatcher } from './workers/watcher.js'
import { startWebhookWorker } from './workers/webhooks.js'

export const app = new Hono()
app.use(logger((...messages) => console.log(...messages.map(redactCallbackLog))))
app.onError(errorHandler)
app.notFound((c) => c.json({ error: { code: 'not_found', message: 'No such endpoint' } }, 404))

app.route('/health', healthRoutes)
// An AI agent pays with its Kova key over MCP (Bearer token).
app.route('/', mcpRoutes)
app.route('/v1/checkout', checkoutRoutes)
app.route('/v1/payment_intents', intentRoutes)
app.route('/v1/terminals', terminalRoutes)
app.route('/v1/card_taps', cardTapRoutes)
app.route('/v1', accountRoutes)
app.route('/v1', catalogRoutes)
app.route('/v1', stallRoutes)
app.route('/v1', orderRoutes)
app.route('/v1', travelRoutes)
app.route('/v1', insightRoutes)
// Public: wallets are addresses and prove themselves by signing. Mounted before any router whose
// middleware covers all of /v1 (reports asks for an API key).
app.route('/v1', walletRoutes)
app.route('/v1', nairaRoutes)
app.route('/v1', moneyRoutes)
app.route('/v1', linkRoutes)
app.route('/v1', takingsRoutes)
app.route('/v1', businessRoutes)
app.route('/v1', statsRoutes)
app.route('/v1', iosBetaRoutes)
app.route('/v1', ussdRoutes)
app.route('/v1', phoneRoutes)
app.route('/v1', cardRoutes)
app.route('/v1', spendKeyRoutes)
app.route('/v1', demoRoutes)
app.route('/v1', rateRoutes)
app.route('/v1', stockTradeRoutes)
app.route('/v1', stockRoutes)
app.route('/v1', webhookRoutes)
app.route('/v1', reportRoutes)

if (process.argv[1]?.endsWith('index.ts') || process.argv[1]?.endsWith('index.js')) {
  await runMigrations(config.DATABASE_URL)

  // The watcher settles charges paid by any route and indexes transfers for wallets.
  void startWatcher().catch((error) => console.error('[watcher] failed to start', error))
  startWebhookWorker()
  // Private payments are announced on Monad itself (ERC-5564), not only in Kova's feed.
  startAnnouncer()
  // Old transfers between strangers leave the index, so it never fills the disk again.
  startPruner()
  const recoverUssd = () =>
    void reconcilePendingPockets().catch(() =>
      console.error('[ussd] Receipt recovery failed; will retry.'),
    )
  recoverUssd()
  setInterval(recoverUssd, 10_000)
  const recoverPhones = () =>
    void recoverPhonePayments().catch(() => console.error('[phone] Recovery will retry.'))
  recoverPhones()
  setInterval(recoverPhones, 10_000)
  // The App Review demo account stays stocked (testnet, and only where it is configured).
  startDemo()
  // Charges nobody paid close when their code expires, so "waiting" means someone could still pay.
  const expire = () => {
    void expireStaleIntents().catch((error) => console.error('[expiry]', error))
    void expireTrips().catch((error) => console.error('[expiry] trips', error))
  }
  expire()
  setInterval(expire, 30_000)
  // Rates change every 15 minutes at most; keep Kova Travel's copy fresh without waiting for a request.
  void rateBook()
  setInterval(() => void rateBook(), 5 * 60_000)
  // xStocks lists 1,300+ stocks over 14 pages: read them, and price the popular ones, before
  // anyone opens Stocks, and keep both fresh.
  const warmStocks = () =>
    void popularStocks().catch((error) =>
      console.warn('[stocks] xStocks unreachable:', String(error)),
    )
  warmStocks()
  setInterval(warmStocks, 5 * 60_000)
  // Naira: follow bank transfers Paystack hasn't confirmed yet, and send dollars a top-up still owes.
  // The first run also warms PAJ's rate, its banks and the swap price, so nobody waits on them.
  void checkPayingCashOuts().catch((error) => console.error('[naira] cash-outs', error))
  setInterval(() => {
    void checkPayingCashOuts().catch((error) => console.error('[naira] cash-outs', error))
    void retryTopUps().catch((error) => console.error('[naira] top-ups', error))
  }, 60_000)

  serve({ fetch: app.fetch, port: config.PORT }, (info) => {
    console.log(
      `kova api on :${info.port} (${network.name}, chain ${network.chainId})` +
        (feePayerAddress ? ` relaying from ${feePayerAddress}` : ' WITHOUT a relayer'),
    )
  })
}
