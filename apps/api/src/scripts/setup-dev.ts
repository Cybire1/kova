/**
 * Prepares a local development environment for the Monad build:
 *   1. generates a relayer key if there is none (into apps/api/.env.monad), checks it has MON
 *      for gas, and gives it test AUSD, which Kova Travel's treasury refunds from on testnet
 *   2. creates a demo merchant and prints an API key
 *
 * Testnet only. On mainnet the relayer is a funded KMS key, not a generated one.
 */
import { appendFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { schema, uuidv7 } from '@kova/db'
import { AUSD_TESTNET_FAUCET, eip3009Abi, faucetAbi, formatAmount, getToken } from '@kova/monad'
import { eq } from 'drizzle-orm'
import { formatEther } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { generateApiKey } from '../auth.js'
import { network, publicClient, walletClient } from '../chain.js'
import { config } from '../config.js'
import { db } from '../db.js'

const envPath = join(process.cwd(), '.env.monad')

async function main() {
  if (config.KOVA_NETWORK !== 'testnet')
    throw new Error('setup-dev is testnet only: never generate a mainnet relayer key')

  // 1. Relayer
  const key = config.KOVA_FEE_PAYER_PRIVATE_KEY
  if (!key) {
    const fresh = generatePrivateKey()
    appendFileSync(envPath, `KOVA_FEE_PAYER_PRIVATE_KEY=${fresh}\n`, { mode: 0o600 })
    console.log(
      `generated a relayer key for ${privateKeyToAccount(fresh).address} in apps/api/.env.monad`,
    )
    console.log('fund it with testnet MON at https://faucet.monad.xyz, then run setup:dev again')
    process.exit(0)
  }
  const relayer = privateKeyToAccount(key as `0x${string}`)
  const mon = await publicClient.getBalance({ address: relayer.address })
  console.log(`relayer ${relayer.address}: ${formatEther(mon)} MON on ${network.name}`)
  if (mon === 0n) console.log('  it needs testnet MON for gas: https://faucet.monad.xyz')

  const ausd = getToken('testnet', 'AUSD')
  const dollars = await publicClient.readContract({
    address: ausd.address,
    abi: eip3009Abi,
    functionName: 'balanceOf',
    args: [relayer.address],
  })
  if (dollars === 0n && mon > 0n && walletClient) {
    try {
      await walletClient.writeContractSync({
        address: AUSD_TESTNET_FAUCET,
        abi: faucetAbi,
        functionName: 'requestFunds',
        args: [relayer.address],
      })
      console.log("  asked Agora's faucet for test AUSD")
    } catch {
      // Agora's faucet runs dry (it reverts with InsufficientFunds). Everything else still works;
      // test dollars and refunds need AUSD sent to the relayer by hand.
      console.log(
        `  Agora's faucet gave nothing (it may be empty): send test AUSD to ${relayer.address} for test dollars`,
      )
    }
  }
  const funded = await publicClient.readContract({
    address: ausd.address,
    abi: eip3009Abi,
    functionName: 'balanceOf',
    args: [relayer.address],
  })
  console.log(`  ${formatAmount(funded)} AUSD for refunds`)

  // 2. Demo merchant with its own settlement wallet
  const slug = 'demo-merchant'
  let merchant = await db.query.merchants.findFirst({ where: eq(schema.merchants.slug, slug) })
  if (!merchant) {
    const wallet = privateKeyToAccount(generatePrivateKey())
    const [created] = await db
      .insert(schema.merchants)
      .values({
        id: uuidv7(),
        name: 'Demo Merchant',
        slug,
        settlementAddress: wallet.address,
        network: 'testnet',
        country: 'NG',
        isTest: true,
      })
      .returning()
    merchant = created
    console.log(`created merchant ${slug} settling to ${wallet.address}`)
  }
  if (!merchant) throw new Error('failed to create merchant')

  const generated = generateApiKey(true)
  await db.insert(schema.apiKeys).values({
    id: uuidv7(),
    merchantId: merchant.id,
    name: 'dev',
    prefix: generated.prefix,
    secretHash: generated.secretHash,
    scopes: ['payments:read', 'payments:write'],
    isTest: true,
  })

  // The key goes where the tools that use it read it, never to the terminal.
  const keyFile = join(process.cwd(), '..', 'mobile', '.env.monad')
  writeFileSync(
    keyFile,
    `KOVA_API_KEY=${generated.secret}\nEXPO_PUBLIC_KOVA_API_URL=http://localhost:${config.PORT}\n`,
    { mode: 0o600 },
  )
  console.log(`\nAPI key ${generated.prefix}… saved to apps/mobile/.env.monad (KOVA_API_KEY)`)
  process.exit(0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
