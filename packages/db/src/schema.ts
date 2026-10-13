import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

/**
 * Money is stored in TIP-20 base units (6 decimals) as bigint. Postgres bigint tops out at
 * ~9.2e18, i.e. ~9.2 trillion dollars, so it cannot overflow in practice. Never use floats.
 */
const amount = (name: string) => bigint(name, { mode: 'bigint' })
const address = (name: string) => text(name)
const id = () => uuid('id').primaryKey()
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' })

export const network = pgEnum('network', ['mainnet', 'testnet'])
/** Tempo's dollars (USDC, pathUSD, USDT0) and, on Monad, AUSD beside Circle's USDC. */
export const currency = pgEnum('currency', ['USDC', 'pathUSD', 'USDT0', 'AUSD'])

// --- Accounts -------------------------------------------------------------

export const users = pgTable(
  'users',
  {
    id: id(),
    /** Tempo account address, derived from the user's passkey public key. */
    tempoAddress: address('tempo_address').notNull(),
    network: network('network').notNull(),
    passkeyCredentialId: text('passkey_credential_id'),
    passkeyPublicKey: text('passkey_public_key'),
    displayName: text('display_name'),
    phone: text('phone'),
    status: text('status').notNull().default('active'), // active | blocked
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('users_address_network_idx').on(t.tempoAddress, t.network)],
)

export const merchants = pgTable(
  'merchants',
  {
    id: id(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    /** Where payments settle. Kova never custodies: funds land here directly. */
    settlementAddress: address('settlement_address').notNull(),
    /**
     * Private takings: an ERC-5564 stealth meta-address (`st:eth:0x…`). When set, every new charge
     * is paid to a fresh one-time address derived from it, so nobody on Monad can add up the shop's
     * sales. Null: charges pay the settlement address.
     */
    stealthMetaAddress: text('stealth_meta_address'),
    network: network('network').notNull(),
    /** Registered virtual-address master id, when the merchant supports per-intent addresses. */
    virtualMasterId: integer('virtual_master_id'),
    ownerUserId: uuid('owner_user_id').references(() => users.id),
    /**
     * The wallet the shop's owner signs in with (lowercase), proven by a signature when the shop
     * was opened. It may differ from where money lands: that can change, and whoever receives the
     * money doesn't get to run the shop because of it.
     */
    ownerAddress: address('owner_address'),
    country: text('country').notNull().default('NG'),
    category: text('category'),
    status: text('status').notNull().default('active'), // active | suspended
    /** Marks demo/test merchants so public metrics can separate real activity. */
    isTest: boolean('is_test').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('merchants_slug_idx').on(t.slug),
    index('merchants_owner_idx').on(t.ownerAddress),
  ],
)

export const terminals = pgTable(
  'terminals',
  {
    id: id(),
    merchantId: uuid('merchant_id')
      .notNull()
      .references(() => merchants.id),
    name: text('name').notNull(),
    /** Free-form device identity (model, serial) for support and fraud review. */
    device: jsonb('device').$type<Record<string, unknown>>(),
    status: text('status').notNull().default('active'), // active | disabled
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('terminals_merchant_idx').on(t.merchantId)],
)

/**
 * A short-lived code that pairs a phone as a merchant's terminal. The merchant creates it in
 * the dashboard; the phone redeems it once for its own device key. Only the code's hash is
 * stored.
 */
export const terminalPairings = pgTable(
  'terminal_pairings',
  {
    id: id(),
    merchantId: uuid('merchant_id')
      .notNull()
      .references(() => merchants.id),
    codeHash: text('code_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    terminalId: uuid('terminal_id').references(() => terminals.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('terminal_pairings_code_idx').on(t.codeHash)],
)

// --- Payment credentials --------------------------------------------------

export const credentialType = pgEnum('credential_type', ['card', 'phone', 'agent'])

/**
 * A payment credential: a physical card, a phone's secure-element key, or an agent key.
 * All three are the same thing on Tempo — a P-256 access key on the user's account.
 */
export const credentials = pgTable(
  'credentials',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    type: credentialType('type').notNull(),
    label: text('label'),
    /** Tempo access key id: last20(keccak256(X || Y)). */
    keyId: address('key_id').notNull(),
    /** Uncompressed P-256 public key (0x04 || X || Y). The private key never leaves the chip. */
    publicKey: text('public_key').notNull(),
    network: network('network').notNull(),
    /** On-chain expiry of the access key. */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    /** active | frozen (limit set to 0) | revoked (permanent; key id can never be reused) */
    status: text('status').notNull().default('active'),
    /** Transaction that authorized the key on-chain. */
    authorizedTxHash: text('authorized_tx_hash'),
    /** Last four of the printed card number, for support. Never a key. */
    lastFour: text('last_four'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('credentials_key_network_idx').on(t.keyId, t.network),
    index('credentials_user_idx').on(t.userId),
  ],
)

/** Spending rules Kova enforces off-chain, on top of the access key's on-chain limits. */
export const policies = pgTable(
  'policies',
  {
    id: id(),
    credentialId: uuid('credential_id').references(() => credentials.id),
    userId: uuid('user_id').references(() => users.id),
    /** { perTransaction, perDay, perMonth, approvalThreshold, merchants, categories, hours } */
    rules: jsonb('rules').$type<Record<string, unknown>>().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('policies_credential_idx').on(t.credentialId)],
)

// --- Payments -------------------------------------------------------------

export const intentStatus = pgEnum('intent_status', [
  'requires_payment',
  'processing',
  'paid',
  'held',
  'failed',
  'canceled',
  'expired',
])

export const paymentIntents = pgTable(
  'payment_intents',
  {
    id: id(),
    merchantId: uuid('merchant_id')
      .notNull()
      .references(() => merchants.id),
    terminalId: uuid('terminal_id').references(() => terminals.id),
    amount: amount('amount').notNull(),
    currency: currency('currency').notNull(),
    tokenAddress: address('token_address').notNull(),
    network: network('network').notNull(),
    /** Where the payer sends: the merchant address, or a per-intent virtual address. */
    payTo: address('pay_to').notNull(),
    /** The 32-byte Kova memo carried by the settling transfer. */
    memo: text('memo').notNull(),
    status: intentStatus('status').notNull().default('requires_payment'),
    /** Merchant's own order reference. */
    reference: text('reference'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    isTest: boolean('is_test').notNull().default(false),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('intents_merchant_created_idx').on(t.merchantId, t.createdAt),
    index('intents_status_idx').on(t.status),
    uniqueIndex('intents_memo_idx').on(t.memo),
    index('intents_pay_to_idx').on(t.payTo),
  ],
)

export const payments = pgTable(
  'payments',
  {
    id: id(),
    intentId: uuid('intent_id')
      .notNull()
      .references(() => paymentIntents.id),
    txHash: text('tx_hash').notNull(),
    blockNumber: bigint('block_number', { mode: 'bigint' }),
    payerAddress: address('payer_address').notNull(),
    /** Which credential signed, when Kova submitted it. Null for outside wallets. */
    credentialId: uuid('credential_id').references(() => credentials.id),
    amount: amount('amount').notNull(),
    tokenAddress: address('token_address').notNull(),
    /** paid | held | failed */
    status: text('status').notNull(),
    gasUsed: bigint('gas_used', { mode: 'bigint' }),
    /** What Kova paid in fees for sponsoring, in base units. */
    feePaid: amount('fee_paid'),
    feePayerAddress: address('fee_payer_address'),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('payments_tx_idx').on(t.txHash), index('payments_intent_idx').on(t.intentId)],
)

export const refunds = pgTable(
  'refunds',
  {
    id: id(),
    paymentId: uuid('payment_id')
      .notNull()
      .references(() => payments.id),
    amount: amount('amount').notNull(),
    memo: text('memo').notNull(),
    reason: text('reason'),
    txHash: text('tx_hash'),
    /** pending | sent | confirmed | failed */
    status: text('status').notNull().default('pending'),
    createdAt: createdAt(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  },
  (t) => [index('refunds_payment_idx').on(t.paymentId)],
)

/**
 * Double-entry ledger. Every confirmed movement writes balanced rows, so merchant balances
 * and Kova's fee spend are derived, never edited in place.
 */
export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: id(),
    /** e.g. "merchant:<uuid>", "user:<uuid>", "kova:fees", "external". */
    account: text('account').notNull(),
    direction: text('direction').notNull(), // debit | credit
    amount: amount('amount').notNull(),
    currency: currency('currency').notNull(),
    refType: text('ref_type').notNull(), // payment | refund | fee | payout
    refId: uuid('ref_id').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('ledger_account_idx').on(t.account, t.createdAt),
    uniqueIndex('ledger_ref_account_dir_idx').on(t.refType, t.refId, t.account, t.direction),
  ],
)

// --- Developer surface ----------------------------------------------------

export const apiKeys = pgTable(
  'api_keys',
  {
    id: id(),
    merchantId: uuid('merchant_id')
      .notNull()
      .references(() => merchants.id),
    name: text('name').notNull(),
    /** Visible prefix, e.g. "kova_test_a1b2". The secret itself is only stored hashed. */
    prefix: text('prefix').notNull(),
    secretHash: text('secret_hash').notNull(),
    scopes: jsonb('scopes').$type<string[]>().notNull(),
    /** Set on a paired phone's device key: it can take payments, never manage the shop. */
    terminalId: uuid('terminal_id').references(() => terminals.id),
    isTest: boolean('is_test').notNull().default(true),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    /**
     * Set on a signed-in browser's key: it lapses with the session and is revoked on sign-out.
     * The shop's secret keys never expire, and only they are listed as the shop's keys.
     */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('api_keys_prefix_idx').on(t.prefix)],
)

/** Idempotency records, so a retried POST can never create a second payment. */
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    id: id(),
    apiKeyId: uuid('api_key_id')
      .notNull()
      .references(() => apiKeys.id),
    key: text('key').notNull(),
    /** Hash of the request body: the same key with a different body is an error. */
    requestHash: text('request_hash').notNull(),
    statusCode: integer('status_code'),
    response: jsonb('response').$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('idempotency_key_idx').on(t.apiKeyId, t.key)],
)

export const webhookEndpoints = pgTable(
  'webhook_endpoints',
  {
    id: id(),
    merchantId: uuid('merchant_id')
      .notNull()
      .references(() => merchants.id),
    url: text('url').notNull(),
    /** Signing secret (whsec_...). Deliveries are HMAC-SHA256 signed over "timestamp.body". */
    secret: text('secret').notNull(),
    events: jsonb('events').$type<string[]>().notNull(),
    status: text('status').notNull().default('active'), // active | disabled
    createdAt: createdAt(),
  },
  (t) => [index('webhook_endpoints_merchant_idx').on(t.merchantId)],
)

/** Append-only event log. Webhook deliveries are generated from it (outbox pattern). */
export const events = pgTable(
  'events',
  {
    id: id(),
    merchantId: uuid('merchant_id').references(() => merchants.id),
    type: text('type').notNull(), // payment_intent.paid, refund.confirmed, ...
    data: jsonb('data').$type<Record<string, unknown>>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('events_merchant_created_idx').on(t.merchantId, t.createdAt)],
)

export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: id(),
    endpointId: uuid('endpoint_id')
      .notNull()
      .references(() => webhookEndpoints.id),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id),
    status: text('status').notNull().default('pending'), // pending | delivered | failed
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    responseStatus: integer('response_status'),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index('deliveries_due_idx').on(t.status, t.nextAttemptAt),
    uniqueIndex('deliveries_endpoint_event_idx').on(t.endpointId, t.eventId),
  ],
)

// --- Operations -----------------------------------------------------------

/** Cursor for the chain watcher, so restarts never miss or double-count logs. */
export const watcherState = pgTable('watcher_state', {
  network: network('network').primaryKey(),
  lastBlock: bigint('last_block', { mode: 'bigint' }).notNull(),
  updatedAt: updatedAt(),
})

/**
 * Every transfer of a token Kova settles in, as the watcher reads it off the chain. Monad's RPCs
 * answer log queries 100 blocks (about 30 seconds) at a time, so a phone that was closed for a
 * day cannot catch up on its own: it asks Kova what arrived, and reads its balance on-chain.
 */
export const transfers = pgTable(
  'transfers',
  {
    id: id(),
    network: network('network').notNull(),
    tokenAddress: address('token_address').notNull(),
    /** Lowercase, so lookups by address need no case folding. */
    fromAddress: address('from_address').notNull(),
    toAddress: address('to_address').notNull(),
    amount: amount('amount').notNull(),
    txHash: text('tx_hash').notNull(),
    logIndex: integer('log_index').notNull(),
    blockNumber: bigint('block_number', { mode: 'bigint' }).notNull(),
    /** The EIP-3009 nonce when the transfer was authorized by signature: a Kova memo for charges and refunds. */
    nonce: text('nonce'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('transfers_tx_log_idx').on(t.txHash, t.logIndex),
    index('transfers_to_block_idx').on(t.toAddress, t.blockNumber),
    index('transfers_from_block_idx').on(t.fromAddress, t.blockNumber),
  ],
)

/**
 * Encrypted backups of what a Kova Pay wallet knows about its owner: their name, their currency,
 * the names they gave people. Sealed on the phone with a key derived from the wallet's passkey
 * (its own PRF salt, separate from the wallet key), so Kova stores ciphertext it cannot read,
 * and the same passkey brings it back on a new phone. The id is the address of a signing key
 * from the same passkey; only that key can replace the vault.
 */
export const walletVaults = pgTable('wallet_vaults', {
  /** Lowercase address of the vault's signing key. */
  id: text('id').primaryKey(),
  ciphertext: text('ciphertext').notNull(),
  nonce: text('nonce').notNull(),
  /** When the phone signed this version (unix seconds). An older signature never replaces a newer one. */
  signedAt: bigint('signed_at', { mode: 'bigint' }).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

/**
 * A message Kova asked a wallet to sign, to sign in to a shop or open one (EIP-4361). Each is
 * good once, for one wallet and one purpose, for ten minutes.
 */
export const signInChallenges = pgTable('sign_in_challenges', {
  nonce: text('nonce').primaryKey(),
  /** Lowercase. */
  address: address('address').notNull(),
  purpose: text('purpose').notNull(), // sign_in | open_shop | own_shop
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  usedAt: timestamp('used_at', { withTimezone: true }),
  createdAt: createdAt(),
})

/**
 * Testnet only: when each wallet last had Kova's test dollars, which come once a day. One row per
 * wallet, so claiming is a single conditional upsert and two taps at once can't both be paid.
 */
export const testDollarClaims = pgTable('test_dollar_claims', {
  /** Lowercase. */
  address: address('address').primaryKey(),
  claimedAt: timestamp('claimed_at', { withTimezone: true }).notNull(),
  txHash: text('tx_hash'),
})

/**
 * Each wallet's note key: the public half of an X25519 key its passkey derives, signed by the
 * wallet so a sender can check it came from the wallet and not from Kova.
 */
export const noteKeys = pgTable('note_keys', {
  /** Lowercase. */
  address: address('address').primaryKey(),
  /** base64url, 32 bytes. */
  publicKey: text('public_key').notNull(),
  signature: text('signature').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

/**
 * Private notes on sends ("for dinner"), sealed on the sender's device for the receiver and the
 * sender. Kova stores ciphertext only, keyed by the transaction that carried the money.
 */
export const paymentNotes = pgTable('payment_notes', {
  txHash: text('tx_hash').primaryKey(),
  /** Lowercase. */
  fromAddress: address('from_address').notNull(),
  toAddress: address('to_address').notNull(),
  /** The EIP-3009 nonce of the transfer, part of what the note is bound to. */
  authNonce: text('auth_nonce').notNull(),
  sealed: jsonb('sealed')
    .$type<{ v: 1; e: string; n: string; to: string; from: string }>()
    .notNull(),
  createdAt: createdAt(),
})

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: id(),
    actorType: text('actor_type').notNull(), // user | merchant | api_key | system
    actorId: text('actor_id'),
    action: text('action').notNull(), // credential.frozen, refund.created, ...
    targetType: text('target_type'),
    targetId: text('target_id'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    ip: text('ip'),
    createdAt: createdAt(),
  },
  (t) => [index('audit_target_idx').on(t.targetType, t.targetId, t.createdAt)],
)

// --- Catalogue, stalls and orders -------------------------------------------

/**
 * Photos a shop uploads, for items and stall covers. They are resized on the phone before
 * upload (a few hundred KB at most), so Postgres holds them comfortably for now; move them to
 * object storage when that stops being true.
 */
export const images = pgTable(
  'images',
  {
    id: id(),
    merchantId: uuid('merchant_id')
      .notNull()
      .references(() => merchants.id),
    contentType: text('content_type').notNull(),
    bytes: bytea('bytes').notNull(),
    size: integer('size').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('images_merchant_idx').on(t.merchantId)],
)

/** One list of what a shop sells, shared by its stalls, its till and barcode scanning. */
export const catalogItems = pgTable(
  'catalog_items',
  {
    id: id(),
    merchantId: uuid('merchant_id')
      .notNull()
      .references(() => merchants.id),
    name: text('name').notNull(),
    description: text('description'),
    /** In dollars, base units. What a customer pays is always priced from here, server side. */
    price: amount('price').notNull(),
    imageId: uuid('image_id').references(() => images.id),
    /** EAN or UPC, digits only, as printed under the bars. */
    barcode: text('barcode'),
    soldOut: boolean('sold_out').notNull().default(false),
    /** How many are left, counted down by every paid sale, online or at the till. Null: not counted. */
    stock: integer('stock'),
    /** A shelf to group it under on the till and the stall: "Breads", "Drinks". */
    category: text('category'),
    position: integer('position').notNull().default(0),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('catalog_items_merchant_idx').on(t.merchantId),
    uniqueIndex('catalog_items_barcode_idx')
      .on(t.merchantId, t.barcode)
      .where(sql`${t.barcode} is not null and ${t.archivedAt} is null`),
  ],
)

/** A shop's pocket storefront, public at /s/<slug>. */
export const stalls = pgTable(
  'stalls',
  {
    id: id(),
    merchantId: uuid('merchant_id')
      .notNull()
      .references(() => merchants.id),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    tagline: text('tagline'),
    coverImageId: uuid('cover_image_id').references(() => images.id),
    open: boolean('open').notNull().default(true),
    /** Tables with their own QR code: an order from one says which table to bring it to. Null: counter only. */
    tableCount: integer('table_count'),
    /** The stamp card: after this many paid orders, the next order's cheapest item is free. Null: off. */
    loyaltyEvery: integer('loyalty_every'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('stalls_slug_idx').on(t.slug), index('stalls_merchant_idx').on(t.merchantId)],
)

/** Which catalogue items a stall shows, in its order. */
export const stallItems = pgTable(
  'stall_items',
  {
    stallId: uuid('stall_id')
      .notNull()
      .references(() => stalls.id),
    itemId: uuid('item_id')
      .notNull()
      .references(() => catalogItems.id),
    position: integer('position').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.stallId, t.itemId] })],
)

export const orderSource = pgEnum('order_source', ['stall', 'till'])

/** A full stamp card spent on an order: one of its items, free. */
export interface OrderReward {
  item_id: string
  name: string
  /** Dollars taken off, as a decimal string. */
  amount: string
  /** Stamps the card took. */
  stamps: number
}

export interface OrderLine {
  item_id: string
  name: string
  /** Dollars, as a decimal string, at the moment of checkout. */
  unit_price: string
  quantity: number
}

/**
 * What was bought: a stall order or a till sale. Its payment intent stays the source of truth
 * for the money; the order keeps the items, the buyer's name and note, and whether it has been
 * handed over.
 */
export const orders = pgTable(
  'orders',
  {
    id: id(),
    merchantId: uuid('merchant_id')
      .notNull()
      .references(() => merchants.id),
    intentId: uuid('intent_id')
      .notNull()
      .references(() => paymentIntents.id),
    stallId: uuid('stall_id').references(() => stalls.id),
    source: orderSource('source').notNull(),
    /** A snapshot at checkout, so later price changes never rewrite an order. */
    lines: jsonb('lines').$type<OrderLine[]>().notNull(),
    customerName: text('customer_name'),
    note: text('note'),
    /** The buyer sent the link to someone else to pay. */
    payForMe: boolean('pay_for_me').notNull().default(false),
    /** The table it was ordered from, from the table's QR code: "3". Null: the counter. */
    table: text('table'),
    /** The wallet that said it would pay: the stamp card it earns on, and the only one that may pay a reward. */
    payerAddress: text('payer_address'),
    /** A stamp card spent on this order. */
    reward: jsonb('reward').$type<OrderReward>(),
    /** What the note needs the counter to notice, like "allergy". Set by Jev after checkout. */
    flags: jsonb('flags').$type<string[]>(),
    collectedAt: timestamp('collected_at', { withTimezone: true }),
    /** Where the order is at the counter: new, preparing, ready, collected or cancelled. */
    status: text('status').notNull().default('new'),
    /** The stock this order took, once it was paid: so a payment seen twice counts down once. */
    stockTakenAt: timestamp('stock_taken_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('orders_intent_idx').on(t.intentId),
    index('orders_merchant_created_idx').on(t.merchantId, t.createdAt),
    index('orders_stall_idx').on(t.stallId),
  ],
)

// --- Private takings: one-time addresses for a shop's sales -------------------------------------

/**
 * The announcement for a sale paid to a stealth address: the one-time address and the ephemeral key
 * its shop needs to find and open it (ERC-5564 scheme 1). Published without the shop: anyone can
 * read them, only the shop's viewing key recognises its own. `sweptTx` is set once the shop has
 * moved the dollars to its wallet.
 */
export const stealthPayments = pgTable(
  'stealth_payments',
  {
    id: id(),
    network: network('network').notNull(),
    merchantId: uuid('merchant_id')
      .notNull()
      .references(() => merchants.id),
    intentId: uuid('intent_id')
      .notNull()
      .references(() => paymentIntents.id),
    stealthAddress: address('stealth_address').notNull(),
    ephemeralPublicKey: text('ephemeral_public_key').notNull(),
    viewTag: text('view_tag').notNull(),
    sweptTx: text('swept_tx'),
    sweptAt: timestamp('swept_at', { withTimezone: true }),
    /** The ERC-5564 Announcement Kova posted on Monad for this sale, once it's paid. */
    announceTx: text('announce_tx'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('stealth_payments_intent_idx').on(t.intentId),
    uniqueIndex('stealth_payments_address_idx').on(t.stealthAddress),
    index('stealth_payments_merchant_idx').on(t.merchantId),
  ],
)

// --- Private sends between people -------------------------------------------------------------

/**
 * A wallet's private-receiving meta-address (ERC-5564 scheme 1), signed by the wallet, so a sender
 * can check it before sending privately. Public: it only lets people make addresses for it.
 */
export const walletStealthKeys = pgTable('wallet_stealth_keys', {
  address: address('address').primaryKey(),
  metaAddress: text('meta_address').notNull(),
  signature: text('signature').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

/**
 * The announcement of a private send: the one-time address it went to and the ephemeral key its
 * recipient needs to find and open it. Published with no recipient; only their viewing key knows.
 */
export const stealthAnnouncements = pgTable(
  'stealth_announcements',
  {
    id: id(),
    network: network('network').notNull(),
    stealthAddress: address('stealth_address').notNull(),
    ephemeralPublicKey: text('ephemeral_public_key').notNull(),
    viewTag: text('view_tag').notNull(),
    fromAddress: address('from_address').notNull(),
    amount: amount('amount').notNull(),
    tokenAddress: address('token_address').notNull(),
    txHash: text('tx_hash').notNull(),
    /** The sender's memo (who, their name, a note), sealed so only the recipient's viewing key opens it. */
    sealed: text('sealed'),
    /** The ERC-5564 Announcement Kova posted on Monad for it. */
    announceTx: text('announce_tx'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('stealth_announcements_address_idx').on(t.stealthAddress)],
)

// --- Where new people come from ------------------------------------------------------------------

/**
 * Visits and new wallets per source (the `ref` of a link like /try?ref=x), per day. Counts only:
 * nothing about a person is kept.
 */
export const referralCounts = pgTable(
  'referral_counts',
  {
    ref: text('ref').notNull(),
    /** YYYY-MM-DD, UTC. */
    day: text('day').notNull(),
    visits: integer('visits').notNull().default(0),
    wallets: integer('wallets').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.ref, t.day] })],
)

// --- Links: dollars sent to anyone, by a link -------------------------------------------------

/**
 * A payment link: dollars parked at a one-time address whose key lives only in the link (after the
 * #, so it never reaches Kova). Whoever opens the link claims them to their own wallet, gaslessly; an
 * unclaimed link can be taken back by its sender, who kept the key. Kova records the link so the
 * page can show who sent what, and whether it has been claimed.
 */
export const paymentLinks = pgTable(
  'payment_links',
  {
    id: id(),
    network: network('network').notNull(),
    /** The one-time address holding the dollars. */
    linkAddress: address('link_address').notNull(),
    senderAddress: address('sender_address').notNull(),
    senderName: text('sender_name'),
    note: text('note'),
    /** Base units of the settlement dollar, as funded. */
    amount: amount('amount').notNull(),
    /** The currency the sender thinks in, so the page can greet the recipient in theirs too. */
    displayCurrency: text('display_currency'),
    /** open, claimed (by someone else) or returned (to the sender). */
    status: text('status').notNull().default('open'),
    claimedBy: address('claimed_by'),
    claimTx: text('claim_tx'),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('payment_links_address_idx').on(t.linkAddress), index('payment_links_sender_idx').on(t.senderAddress)],
)

// --- Kova Travel ---------------------------------------------------------------------------

export const tripKind = pgEnum('trip_kind', ['flight', 'stay'])
export const tripStatus = pgEnum('trip_status', [
  'awaiting_payment',
  'booking',
  'booked',
  'failed',
  'expired',
  'canceled',
])

/** What the traveller and anyone paying for the trip see: never the supplier's raw payload. */
export interface TripSummary {
  /** "Lagos to London" or the hotel's name. */
  title: string
  /** "Fri 3 Oct, back Sun 5 Oct · 2 adults" style detail line, preformatted by the API. */
  subtitle: string
  /** Airline or hotel chain, and its logo or photo. */
  provider: { name: string; image: string | null }
  /** Flights: one entry per slice. Stays: check-in and check-out. */
  legs: {
    from: string
    to: string
    departs: string
    arrives: string
    carrier: string | null
    flight: string | null
    stops: number
    duration: string | null
  }[]
  /** Stays: room and board, and the cancellation terms in words. */
  room?: { name: string; board: string; cancellation: string }
  /** Extras added to a flight, in words ("1 checked bag", "Seat 14A"). */
  extras: string[]
  /** The name the traveller gave, shown to people they ask to pay. */
  bookedBy: string
}

export interface TripTraveller {
  given_name: string
  family_name: string
  /** Flights only, and only until the trip is booked. */
  born_on?: string
  gender?: 'm' | 'f'
  title?: 'mr' | 'ms' | 'mrs' | 'miss' | 'dr'
  email?: string
  phone_number?: string
  /** The supplier's passenger id from the offer (flights). */
  supplier_id?: string
}

/**
 * A flight or a hotel booked through Kova Travel. Its money is one or more payments to Kova
 * Travel's settlement address (see trip_shares); once every share is paid, Kova books it with
 * the supplier from its own balance. Whoever holds the trip's token can see and manage it.
 */
export const trips = pgTable(
  'trips',
  {
    id: id(),
    /** SHA-256 of the traveller's token. The token itself only lives on their phone. */
    tokenHash: text('token_hash').notNull(),
    kind: tripKind('kind').notNull(),
    status: tripStatus('status').notNull().default('awaiting_payment'),
    /** Kova Travel, the shop every share pays. */
    merchantId: uuid('merchant_id')
      .notNull()
      .references(() => merchants.id),
    summary: jsonb('summary').$type<TripSummary>().notNull(),
    /** The fare as the supplier priced it. */
    fareAmount: text('fare_amount').notNull(),
    fareCurrency: text('fare_currency').notNull(),
    /** What Kova Travel charges in total, in USDC base units. */
    amount: amount('amount').notNull(),
    /** Duffel's offer (flights) or rate (stays), and quote (stays). */
    offerId: text('offer_id').notNull(),
    quoteId: text('quote_id'),
    /** Duffel's order (flights, including a hold) or booking (stays). */
    supplierOrderId: text('supplier_order_id'),
    bookingReference: text('booking_reference'),
    travellers: jsonb('travellers').$type<TripTraveller[]>().notNull(),
    /** Seats and bags: Duffel service ids and quantities. */
    services: jsonb('services').$type<{ id: string; quantity: number }[]>(),
    /** Stays: who the hotel contacts. Cleared once booked. */
    contact: jsonb('contact').$type<{ email: string; phone_number: string }>(),
    /** When the held price, the offer or the quote runs out. */
    payBy: timestamp('pay_by', { withTimezone: true }).notNull(),
    failure: text('failure'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('trips_status_idx').on(t.status), index('trips_pay_by_idx').on(t.payBy)],
)

/** One payment towards a trip: the traveller's own, a pay-for-me link, or a friend's share. */
export const tripShares = pgTable(
  'trip_shares',
  {
    id: id(),
    tripId: uuid('trip_id')
      .notNull()
      .references(() => trips.id),
    intentId: uuid('intent_id')
      .notNull()
      .references(() => paymentIntents.id),
    /** Who this share is for: "You", "Tunde". */
    label: text('label').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('trip_shares_intent_idx').on(t.intentId),
    index('trip_shares_trip_idx').on(t.tripId),
  ],
)

/**
 * A USSD pocket: a small dollar balance a wallet sets aside to pay from any phone, even one with
 * no data, by dialling Kova's USSD code. USSD can't carry a passkey, so the pocket has its own key,
 * which Kova holds encrypted and signs with when the owner enters their PIN. The owner's main
 * wallet stays theirs alone: they choose what goes in (up to a cap) and can take it back any time.
 */
export const ussdPockets = pgTable(
  'ussd_pockets',
  {
    id: id(),
    /** The Kova wallet that owns and funds the pocket. Lowercase. */
    ownerAddress: address('owner_address').notNull(),
    /** E.164, verified by a code sent to it. */
    phone: text('phone').notNull(),
    /** The pocket's own address on Monad. Lowercase. */
    pocketAddress: address('pocket_address').notNull(),
    /** The pocket's private key, AES-256-GCM under KOVA_POCKET_MASTER_KEY: iv.tag.ciphertext, base64url. */
    sealedKey: text('sealed_key').notNull(),
    /** scrypt: salt.hash, base64url. */
    pinHash: text('pin_hash').notNull(),
    /** The most the pocket may hold, and the most it may spend in a day, in base units. */
    cap: amount('cap').notNull(),
    failedPins: integer('failed_pins').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    /** The newest owner signature accepted, in unix seconds: an older one can't be replayed. */
    lastSignedAt: bigint('last_signed_at', { mode: 'number' }).notNull().default(0),
    /** pending until the phone's code is entered; closed when the owner turns it off. */
    status: text('status').notNull().default('pending'),
    /** The code sent to the phone, scrypt-hashed, and when it stops working. */
    codeHash: text('code_hash'),
    codeExpiresAt: timestamp('code_expires_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('ussd_pockets_owner_idx').on(t.ownerAddress),
    index('ussd_pockets_phone_idx').on(t.phone),
    uniqueIndex('ussd_pockets_address_idx').on(t.pocketAddress),
  ],
)

/** Each payment out of a pocket, one per USSD session, so a resent final step never pays twice. */
export const ussdSpends = pgTable(
  'ussd_spends',
  {
    id: id(),
    pocketId: uuid('pocket_id')
      .notNull()
      .references(() => ussdPockets.id),
    /** The USSD session that made it, or "app:<id>" when the owner takes money back. */
    sessionId: text('session_id').notNull(),
    /** till, phone, or withdraw. */
    kind: text('kind').notNull(),
    /** Lowercase. */
    toAddress: address('to_address').notNull(),
    /** Who it went to, for the receipt: a shop's name or a phone number. */
    toLabel: text('to_label').notNull(),
    amount: amount('amount').notNull(),
    intentId: uuid('intent_id').references(() => paymentIntents.id),
    /** pending, paid or failed. */
    status: text('status').notNull().default('pending'),
    txHash: text('tx_hash'),
    reference: text('reference').notNull(),
    failure: text('failure'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('ussd_spends_session_idx').on(t.sessionId),
    index('ussd_spends_pocket_idx').on(t.pocketId, t.createdAt),
  ],
)

/** Short codes a till shows beside its QR, so a phone with no camera or data can pay that charge. */
export const ussdTillCodes = pgTable(
  'ussd_till_codes',
  {
    code: text('code').primaryKey(),
    intentId: uuid('intent_id')
      .notNull()
      .references(() => paymentIntents.id),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('ussd_till_codes_intent_idx').on(t.intentId)],
)

/**
 * Kova Cards: NFC chips whose own key spends from a wallet through the KovaCard contract on
 * Monad. The chain holds who owns a card, its daily limit and whether it is frozen; this holds
 * what Kova checks before it cosigns a tap: the PIN, and a freeze that takes effect before the
 * chain has heard of it.
 */
export const kovaCards = pgTable(
  'kova_cards',
  {
    /** The card's own address (its key never leaves the chip). Lowercase. */
    address: address('address').primaryKey(),
    network: network('network').notNull(),
    /** The wallet it spends from. Lowercase. */
    holderAddress: address('holder_address').notNull(),
    label: text('label').notNull().default('Kova Card'),
    lastFour: text('last_four').notNull(),
    /** scrypt: salt.hash, base64url. Checked by Kova at the till, never stored on the phone. */
    pinHash: text('pin_hash').notNull(),
    failedPins: integer('failed_pins').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    /** Taps at or under this many base units need no PIN, like contactless cards. */
    noPinLimit: amount('no_pin_limit').notNull(),
    frozen: boolean('frozen').notNull().default(false),
    /** active, or unlinked for good. */
    status: text('status').notNull().default('active'),
    linkTxHash: text('link_tx_hash'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('kova_cards_holder_idx').on(t.holderAddress)],
)

/**
 * One tap at a till: the payment Kova prepared for the card to sign, and what came of it. A tap
 * pays its charge at most once, whatever the till retries.
 */
export const cardTaps = pgTable(
  'card_taps',
  {
    id: id(),
    cardAddress: address('card_address')
      .notNull()
      .references(() => kovaCards.address),
    intentId: uuid('intent_id')
      .notNull()
      .references(() => paymentIntents.id),
    terminalId: uuid('terminal_id').references(() => terminals.id),
    amount: amount('amount').notNull(),
    payTo: address('pay_to').notNull(),
    memo: text('memo').notNull(),
    /** Unix seconds after which neither signature is any use. */
    deadline: bigint('deadline', { mode: 'number' }).notNull(),
    pinRequired: boolean('pin_required').notNull(),
    /** prepared, paid or failed. */
    status: text('status').notNull().default('prepared'),
    txHash: text('tx_hash'),
    failure: text('failure'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('card_taps_card_idx').on(t.cardAddress, t.createdAt), index('card_taps_intent_idx').on(t.intentId)],
)
