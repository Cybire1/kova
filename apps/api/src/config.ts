import { z } from 'zod'

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().default('postgres://localhost:5432/kova_dev'),
  /** Which Monad network this instance serves. One process serves one network. */
  KOVA_NETWORK: z
    .enum(['mainnet', 'testnet'])
    .default(process.env.NODE_ENV === 'production' ? 'mainnet' : 'testnet'),
  /** Overrides the default public RPC (use a provider endpoint in production). */
  MONAD_RPC_URL: z.string().url().optional(),
  /**
   * The relayer key: it submits the payments people sign and pays their MON gas. It never holds
   * anyone's money, but it spends MON on every payment: in production it belongs in a KMS, and
   * this env var is for local development only.
   */
  KOVA_FEE_PAYER_PRIVATE_KEY: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/)
    .optional(),
  /**
   * Hard cap on the gas the relayer will spend on one payment. Monad charges for the gas limit a
   * transaction asks for, not the gas it uses, so the relayer asks for its estimate plus a small
   * margin, and refuses anything that estimates above this.
   */
  KOVA_MAX_RELAY_GAS: z.coerce.bigint().default(200_000n),
  /** KovaRates on Monad: the reference exchange rates a Chainlink CRE workflow publishes. */
  KOVA_RATES_ADDRESS: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/)
    .optional(),
  /**
   * The sites a shop can sign in from with its wallet, comma-separated, as a signed message names
   * them (host, and port if any). Defaults to mykova.app and the Railway web service, plus
   * localhost outside production. A signature made for any other site is refused.
   */
  KOVA_SIGN_IN_DOMAINS: z.string().optional(),
  /**
   * Shared with Kova's website, which calls on its visitors' behalf from one address: with it, the
   * site can say which visitor is asking, so per-address limits count people, not the site.
   */
  KOVA_PROXY_SECRET: z.string().min(32).optional(),
  /** How long a payment intent stays payable. */
  KOVA_INTENT_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  /**
   * Reads menu photos into catalogue items ("Snap your menu"): Claude with an Anthropic key, or
   * DeepSeek with a DeepSeek key. With neither, that feature says so.
   */
  ANTHROPIC_API_KEY: z.string().optional(),
  DEEPSEEK_API_KEY: z.string().optional(),
  /** Which one reads menus when both keys are set. Unset: Anthropic if its key is there, else DeepSeek. */
  KOVA_MENU_PROVIDER: z.enum(['anthropic', 'deepseek']).optional(),
  /** Defaults to claude-sonnet-5 on Anthropic and deepseek-flash (its vision model) on DeepSeek. */
  KOVA_MENU_MODEL: z.string().optional(),
  /**
   * Kova Travel: flights and hotels through Duffel. A duffel_test_ token runs in Duffel's test
   * mode and only works on testnet; mainnet takes only a duffel_live_ token.
   */
  DUFFEL_API_KEY: z.string().optional(),
  /** Kova Travel's margin on each fare and stay, in basis points (300 = 3%). 0: sold at cost. */
  KOVA_TRAVEL_MARKUP_BPS: z.coerce.number().int().min(0).max(2000).default(0),
  /** Stock charts: a CoinGecko demo key lifts the keyless rate limit. Charts work without one. */
  COINGECKO_API_KEY: z.string().optional(),
  /**
   * Where Kova Travel's payments settle. On testnet it defaults to the fee payer's address;
   * on mainnet it must be set, to a wallet Kova's treasury controls.
   */
  KOVA_TRAVEL_SETTLEMENT_ADDRESS: z.string().optional(),
  /** Jev, TypeSafe's decision model: spending categories, order-note flags, duplicate items, offer matching. */
  TYPESAFE_API_KEY: z.string().optional(),
  /** Aurora Intents (NEAR Intents): deposits from other chains, landing on Monad. Key from studio.aurora.dev. */
  AURORA_INTENTS_KEY: z.string().optional(),
  /** What deposits arrive as on Monad: a symbol Aurora resolves, or an asset id when the symbol is ambiguous. */
  AURORA_DESTINATION_ASSET: z.string().default('AUSD'),
  /** Cross-chain and MON deposits into AUSD through Relay. 0 is the operational kill switch. */
  KOVA_CHAIN_DEPOSITS: z.enum(['0', '1']).default('1'),
  KOVA_PHONE_SEND_ENABLED: z.enum(['0', '1']).default('0'),
  /** Public website for phone invitations, including a custom domain running a testnet demo. */
  KOVA_PHONE_WEB_URL: z.string().url().optional(),
  RELAY_API_KEY: z.string().optional(),
  /** Ramp Network: card and bank top-ups (and cash-out), buying AUSD on Monad. Key from partner@ramp.network. */
  RAMP_HOST_API_KEY: z.string().optional(),
  /**
   * MoonPay (dashboard.moonpay.com): card and bank top-ups, through a deposit from Base. The
   * publishable key (pk_…) goes in the widget link; the secret key (sk_…) signs it and never leaves
   * the API. With both set, Card or bank uses MoonPay instead of Ramp (services/moonpay.ts).
   */
  MOONPAY_PUBLISHABLE_KEY: z.string().startsWith('pk_').optional(),
  MOONPAY_SECRET_KEY: z.string().startsWith('sk_').optional(),
  /** Paystack: naira in and out (services/naira.ts). A test key (sk_test_…) moves no real money. */
  PAYSTACK_SECRET_KEY: z.string().optional(),
  /** Kova's spread on naira each way, a fraction of the market rate (0.01 = 1%). */
  KOVA_NAIRA_SPREAD: z.coerce.number().min(0).max(0.1).default(0.01),
  /**
   * PAJ (docs.paj.cash): naira in and out on Monad, a business key from PAJ's dashboard. With
   * KOVA_CASH_OUT also set, naira goes through PAJ instead of Paystack (services/naira.ts).
   */
  PAJ_API_KEY: z.string().optional(),
  PAJ_API_URL: z.string().url().default('https://api.paj.cash'),
  /** PAJ's webhook secret (whsec_…). Without it, a delivery only prompts a fresh read from PAJ. */
  PAJ_WEBHOOK_SECRET: z.string().optional(),
  /** KovaCashOut (apps/card/contracts): a wallet's AUSD swapped to USDC and paid to PAJ, in one signature. */
  KOVA_CASH_OUT: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/)
    .optional(),
  /**
   * Buying and selling xStocks (docs/stocks-trading.md): `1` switches it on, with KovaStocks at
   * KOVA_STOCKS_CONTRACT (Monad mainnet, where the stocks are). Off, its routes answer live: false.
   */
  KOVA_STOCKS_TRADING: z.enum(['0', '1']).default('0'),
  /**
   * New buys, on top of KOVA_STOCKS_TRADING. Paused (`0`) until Kova knows offering stock tokens is
   * allowed where its people are (Nigeria's SEC registers platforms offering foreign shares). Selling
   * what people already hold stays open either way.
   */
  KOVA_STOCKS_BUYING: z.enum(['0', '1']).default('0'),
  KOVA_STOCKS_CONTRACT: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/)
    .optional(),
  /** This API's public address, for partners' webhooks. Railway's own domain when unset. */
  KOVA_API_PUBLIC_URL: z.string().url().optional(),
  /**
   * Bridge (bridge.xyz): a US account number for each wallet (a virtual account, ACH and wire).
   * Bridge sends what arrives as USDC to the wallet's Aurora Intents deposit address, which lands
   * as AUSD on Monad. Sandbox keys come from Bridge after onboarding (support@bridge.xyz).
   */
  BRIDGE_API_KEY: z.string().optional(),
  BRIDGE_API_URL: z.string().url().default('https://api.sandbox.bridge.xyz'),
  /** The chain and coin Bridge delivers to the wallet's deposit address (Aurora then lands it as AUSD). */
  BRIDGE_DESTINATION_RAIL: z.string().default('base'),
  BRIDGE_DESTINATION_CURRENCY: z.string().default('usdc'),
  /**
   * Nuvion: the dollar card. Each holder passes Nuvion's ID check once and gets a virtual USD card
   * with its own account. A top-up is dollars sent to Kova on Monad (KOVA_CARD_TREASURY), then the
   * same amount moved by book transfer from Kova's own USD account at Nuvion (NUVION_POT_ACCOUNT).
   * The card is off until all four are set.
   */
  NUVION_API_KEY: z.string().optional(),
  NUVION_API_URL: z.string().url().default('https://api.nuvion.dev'),
  NUVION_POT_ACCOUNT: z.string().optional(),
  KOVA_CARD_TREASURY: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/)
    .optional(),
  /** The most a wallet can put on its card in a day, in base units: $100. */
  KOVA_CARD_DAILY_TOPUP: z.string().regex(/^\d+$/).default('100000000'),
  /**
   * Kova's owners, who are on Nuvion already as Kova's own business and so can't pass its ID check
   * again as customers: wallet addresses, comma-separated. Their cards are issued under Kova's own
   * approved business, in the name KOVA_CARD_OWNER_NAME.
   */
  KOVA_CARD_OWNER_WALLETS: z.string().optional(),
  KOVA_CARD_OWNER_NAME: z.string().default('Kova Team'),
  /** Kova's fee on a cash-out through Nuvion, in basis points of what the wallet sends (0: none). */
  KOVA_PAYOUT_FEE_BPS: z.coerce.number().int().min(0).max(1000).default(0),
  /**
   * Cash-outs abroad in the person's own name (services/payouts.ts). `1`: a first cash-out needs the
   * ID check (the dollar card's), accounts are saved under the person's own Nuvion entity, and each
   * payout leaves from their own account, which Kova's pot funds for it. `0`: Kova's pot pays, as Kova.
   */
  KOVA_PAYOUTS_OWN_NAME: z.enum(['0', '1']).default('0'),
  /** Kova's fee on each top-up, in basis points: 50 is 0.5%, paid on top of what lands on the card. */
  KOVA_CARD_TOPUP_FEE_BPS: z.coerce.number().int().min(0).max(1000).default(50),
  /** Savings: an ERC-4626 vault for the settlement dollar, and the KovaSaver in front of it. */
  KOVA_SAVINGS_VAULT: z.string().optional(),
  KOVA_SAVER: z.string().optional(),
  /**
   * Programmable payments (apps/card/contracts): KovaSplits makes each shop's splitter, so its
   * sales are shared out as they land; KovaRepeat holds repeat payments. Unset, both are off.
   */
  KOVA_SPLITS: z.string().optional(),
  KOVA_REPEAT: z.string().optional(),
  /**
   * Who can put money into savings: wallet addresses, comma-separated, while a vault is tried out,
   * or `everyone`. Unset, it's everyone on testnet and nobody on mainnet, so pointing mainnet at a
   * vault never opens it to all by itself. Anyone already holding savings can always take them out.
   */
  KOVA_SAVINGS_WALLETS: z
    .string()
    .optional()
    .refine(
      (v) =>
        !v?.trim() ||
        v.trim() === 'everyone' ||
        v.split(',').every((a) => /^0x[0-9a-fA-F]{40}$/.test(a.trim())),
      'KOVA_SAVINGS_WALLETS: `everyone`, or wallet addresses separated by commas',
    ),
  /**
   * The ERC-4626 whose share price is the savings vault's, to read its recent rate from when the
   * vault itself is newer than a week (setsAUSD's shares are setsUSDC's). Defaults to the vault.
   */
  KOVA_SAVINGS_RATE_VAULT: z.string().optional(),
  /** `1` once the savings vault has been audited: until then the app says it's in beta. */
  KOVA_SAVINGS_AUDITED: z.string().optional(),
  /**
   * `1` to remove, once a day, indexed transfers between two strangers (neither side Kova's or a
   * Kova customer's) older than KOVA_TRANSFER_DAYS. See workers/prune.ts.
   */
  KOVA_PRUNE_TRANSFERS: z.string().optional(),
  KOVA_TRANSFER_DAYS: z.coerce.number().int().min(1).default(7),
  JEV_MODEL: z.string().optional(),
  /**
   * USSD pockets: pay from any phone by dialling a code. The master key seals each pocket's own
   * key at rest (32 bytes, hex); in production it belongs in a KMS. Without it, USSD is off.
   */
  KOVA_POCKET_MASTER_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/)
    .optional(),
  /** The secret path segment Africa's Talking calls back on: /v1/ussd/<secret>. */
  KOVA_USSD_CALLBACK_SECRET: z.string().min(16).optional(),
  /** Enables setup and USSD spending only after provider configuration and payment checks. */
  KOVA_USSD_ENABLED: z.enum(['0', '1']).default('0'),
  /** The code people dial, as the app shows it. */
  KOVA_USSD_CODE: z.string().default(''),
  /**
   * "Try Kova on a basic phone" (services/ussd-demo.ts): a demo number with a funded test pocket,
   * driving the real USSD menu from a web page. Testnet only, and only with KOVA_USSD_DEMO=1.
   */
  KOVA_USSD_DEMO: z.enum(['0', '1']).default('0'),
  /** The test shop whose till the demo pays (a stall slug on this server). */
  KOVA_USSD_DEMO_SHOP: z.string().default('adas-bakery-a2cf'),
  /** Africa's Talking: USSD sessions and SMS receipts. Username "sandbox" uses their simulator. */
  AT_USERNAME: z.string().optional(),
  AT_API_KEY: z.string().optional(),
  /** An approved sender name for SMS; unset uses Africa's Talking's default. */
  AT_SENDER_ID: z.string().optional(),
  /**
   * The App Review demo account (testnet only): a username and password that open one shared
   * test wallet whose 32-byte secret stands in for a passkey. Unset, there is no demo account.
   */
  KOVA_DEMO_USERNAME: z.string().min(3).optional(),
  KOVA_DEMO_PASSWORD: z.string().min(8).optional(),
  KOVA_DEMO_SECRET: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/)
    .optional(),
  /**
   * Kova Card: the key that cosigns every tap after Kova's checks (PIN, freeze). It can only
   * refuse payments, never make one: each also needs the card's own signature. Without it, cards
   * are off. Rotate with KovaCard.setCosigner.
   */
  KOVA_CARD_COSIGNER_KEY: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/)
    .optional(),
  /**
   * Spending keys: seals the private keys Kova holds for AI agents (AES-256-GCM). 32 bytes, hex.
   * Without it, allowances and team keys still work (their keys live on people's phones), but
   * agent keys are off.
   */
  KOVA_KEYS_MASTER_KEY: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/)
    .optional(),
  /**
   * Pay-per-use websites (x402): the key of Kova's small float of USDC and AUSD. A site's budget pays
   * Kova in AUSD through its spending key; this key then signs the site's payment from the float, so
   * a site that only takes USDC is still paid (Kova swaps the AUSD back to USDC in batches). Never
   * the relayer's key. Without it, x402 payments are off.
   */
  KOVA_X402_PAYER_KEY: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/)
    .optional(),
  /**
   * Kova's team, for the few routes only it uses (the iPhone beta's list): sent as x-kova-admin.
   * Without it those routes don't exist (404).
   */
  KOVA_ADMIN_SECRET: z.string().min(16).optional(),
})

export type Config = z.infer<typeof schema>

export const config: Config = schema.parse(process.env)

export const isProduction = config.NODE_ENV === 'production'
