import { eip3009Abi, formatAmount } from '@kova/monad'
import { sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { formatEther } from 'viem'
import { feePayerAddress, network, publicClient, settlementToken } from '../chain.js'
import { db } from '../db.js'
import { indexedThrough } from '../workers/watcher.js'

/** Liveness plus what a payment needs: the database, the chain, and a relayer with MON for gas. */
export const healthRoutes = new Hono().get('/', async (c) => {
  const checks: Record<string, unknown> = {
    chain: network.name,
    network: network.id,
    chain_id: network.chainId,
    settlement_token: { symbol: settlementToken.symbol, address: settlementToken.address },
    relayer: feePayerAddress ?? null,
  }

  const [database, head, indexed] = await Promise.allSettled([
    db.execute(sql`select 1`),
    publicClient.getBlockNumber(),
    indexedThrough(),
  ])
  checks.database = database.status === 'fulfilled' ? 'ok' : 'error'
  checks.block = head.status === 'fulfilled' ? Number(head.value) : null
  // How far the transfer index trails the chain, in blocks (~0.31s each).
  checks.index_lag =
    head.status === 'fulfilled' && indexed.status === 'fulfilled' && indexed.value !== null
      ? Number(head.value - indexed.value)
      : null

  if (feePayerAddress && head.status === 'fulfilled') {
    const [mon, dollars] = await Promise.all([
      publicClient.getBalance({ address: feePayerAddress }).catch(() => undefined),
      publicClient
        .readContract({
          address: settlementToken.address,
          abi: eip3009Abi,
          functionName: 'balanceOf',
          args: [feePayerAddress],
        })
        .catch(() => undefined),
    ])
    checks.relayer_gas = mon === undefined ? null : `${formatEther(mon)} MON`
    checks.relayer_balance =
      dollars === undefined ? null : `${formatAmount(dollars)} ${settlementToken.symbol}`
  }

  const healthy = checks.database === 'ok' && head.status === 'fulfilled'
  return c.json({ status: healthy ? 'ok' : 'degraded', ...checks }, healthy ? 200 : 503)
})
