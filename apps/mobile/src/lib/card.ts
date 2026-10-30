import {
  cardPinMessage,
  claimTypedData,
  HaloError,
  linkTypedData,
  parseAmount,
  permitTypedData,
  readCard,
  signWithCard,
  softCard,
  type Transceive,
  unlinkTypedData,
  updateTypedData,
} from '@kova/monad'
import * as Haptics from 'expo-haptics'
import * as SecureStore from 'expo-secure-store'
import { AppState, Platform } from 'react-native'
import NfcManager, { NfcTech } from 'react-native-nfc-manager'
import {
  type Address,
  getAddress,
  type Hex,
  hashTypedData,
  maxUint256,
  type TypedDataDefinition,
} from 'viem'
import { generatePrivateKey } from 'viem/accounts'
import { currentDeviceKey } from './api'
import { apiUrl, settlementToken } from './config'

/**
 * The Kova Card from the phone's side.
 *
 * A card is an Arx HaLo chip: it makes its own key and never gives it up. Linked to a wallet, it
 * pays at a Kova till by tapping, from the wallet's own dollars, within a daily limit the holder
 * sets on Monad. Kova checks the PIN and cosigns each tap; it can't move money without the card.
 *
 * The phone talks to the chip over NFC (react-native-nfc-manager, ISO-DEP). A simulator has no
 * NFC, so in development it taps a software HaLo that answers the chip's commands exactly.
 */

// ── API ─────────────────────────────────────────────────────────────────────────────────────

export class CardError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message)
    this.name = 'CardError'
  }
}

async function call<T>(path: string, init: RequestInit & { device?: boolean } = {}): Promise<T> {
  const { device, ...rest } = init
  const deviceKey = device ? currentDeviceKey() : null
  const response = await fetch(`${apiUrl}${path}`, {
    ...rest,
    headers: {
      'content-type': 'application/json',
      ...(deviceKey ? { authorization: `Bearer ${deviceKey}` } : {}),
      ...rest.headers,
    },
  })
  const body = (await response.json().catch(() => ({}))) as {
    error?: { message?: string; details?: Record<string, unknown> }
  }
  if (!response.ok)
    throw new CardError(
      body.error?.message ?? `Kova is unreachable (${response.status})`,
      response.status,
      body.error?.details,
    )
  return body as T
}

const post = <T>(path: string, body: unknown, device = false) =>
  call<T>(path, { method: 'POST', body: JSON.stringify(body), device })

export interface CardConfig {
  ready: boolean
  contract: Address | null
  chain_id: number
  max_daily_limit: string
  no_pin_limit: string
}

export interface KovaCard {
  address: Address
  label: string
  last_four: string
  holder: Address
  frozen: boolean
  daily_limit: string | null
  spent_today: string | null
  left_today: string | null
  no_pin_limit: string
  pin_locked_until: string | null
  linked_at: string
  recent: { amount: string; shop: string; tx_hash: string | null; at: string }[]
}

export interface CardList {
  nonce: string
  permit_nonce: string
  allowance: string
  data: KovaCard[]
}

export const getCardConfig = () => call<CardConfig>('/v1/cards/config')
export const listCards = (holder: Address) => call<CardList>(`/v1/wallets/${holder}/cards`)
export const cardStatus = (card: Address) =>
  call<{ linked: boolean; holder?: Address; last_four?: string }>(`/v1/cards/${card}`)

// ── NFC ─────────────────────────────────────────────────────────────────────────────────────

const DEV_CARD = 'kova.dev.card.v1'

/** The software card a simulator taps in development: one per install, so it can be linked once and used. */
async function devCard(): Promise<Transceive> {
  let key = (await SecureStore.getItemAsync(DEV_CARD)) as Hex | null
  if (!key) {
    key = generatePrivateKey()
    await SecureStore.setItemAsync(DEV_CARD, key)
  }
  return softCard(key)
}

/** Development: forget this install's software card, so the next link makes a fresh one. */
export async function forgetDevCard(): Promise<void> {
  await SecureStore.deleteItemAsync(DEV_CARD)
}

let started = false

/** Whether this phone can read a Kova Card. */
export async function canReadCards(): Promise<boolean> {
  if (__DEV__ && !(await NfcManager.isSupported().catch(() => false))) return true
  return NfcManager.isSupported().catch(() => false)
}

/**
 * Where a card goes on this phone. An iPhone reads at the top edge; an Android phone's antenna is
 * on its back, usually around the middle (it moves from model to model).
 */
export const holdCard = (what: string) =>
  Platform.OS === 'ios'
    ? `Hold ${what} to the top of your iPhone`
    : `Hold ${what} flat against the back of your phone`

/**
 * A tap as it happens, for the sheet Android has no system version of (ui/CardTapSheet). iPhone
 * shows Apple's own NFC sheet instead, so there this stays empty.
 *   off       NFC is switched off in the phone's settings
 *   waiting   ready: hold the card to the phone
 *   reading   the card is there: keep holding while it reads and signs
 *   done      read; the sheet closes itself
 *   failed    what went wrong, for a moment; then it closes
 */
export type TapStage = 'off' | 'waiting' | 'reading' | 'done' | 'failed'
export interface TapSession {
  prompt: string
  stage: TapStage
  message?: string
}

let session: TapSession | null = null
const watchers = new Set<(s: TapSession | null) => void>()
function show(next: TapSession | null) {
  session = next
  for (const w of watchers) w(next)
}

/** The tap now, and every change to it. Returns the unsubscribe. */
export function watchTap(watch: (s: TapSession | null) => void): () => void {
  watchers.add(watch)
  watch(session)
  return () => {
    watchers.delete(watch)
  }
}

let stopWaitingForNfc: (() => void) | null = null

/** The person closed the tap sheet: stop listening for the card. */
export function cancelTap() {
  stopWaitingForNfc?.()
  void NfcManager.cancelTechnologyRequest().catch(() => {})
}

/** Opens Android's NFC settings; the tap goes on by itself when they come back with NFC on. */
export async function openNfcSettings() {
  await NfcManager.goToNfcSetting().catch(() => {})
}

/** On Android, NFC can be off. Ask for it, and wait until it's on (or the person gives up). */
async function nfcOn(prompt: string) {
  if (Platform.OS !== 'android') return
  if (await NfcManager.isEnabled().catch(() => true)) return
  show({ prompt, stage: 'off' })
  await new Promise<void>((resolve, reject) => {
    const sub = AppState.addEventListener('change', async (state) => {
      if (state !== 'active' || !(await NfcManager.isEnabled().catch(() => false))) return
      done()
      resolve()
    })
    const done = () => {
      sub.remove()
      stopWaitingForNfc = null
    }
    stopWaitingForNfc = () => {
      done()
      reject(new CardError('Cancelled.', 0, { cancelled: true }))
    }
  })
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Opens an NFC session, runs `work` against the card held to the phone, and closes it. On iPhone
 * the system sheet shows `prompt`, then `done` when the work succeeds; on Android, Kova's own
 * sheet does (ui/CardTapSheet), with NFC switched on first if it's off.
 */
export async function withCard<T>(
  prompt: string,
  work: (transceive: Transceive) => Promise<T>,
  done = 'Done',
): Promise<T> {
  const supported = await NfcManager.isSupported().catch(() => false)
  if (!supported) {
    if (__DEV__) return work(await devCard())
    throw new CardError('This phone can’t read cards.', 0)
  }
  if (!started) {
    await NfcManager.start()
    started = true
  }
  const android = Platform.OS === 'android'
  try {
    await nfcOn(prompt)
    if (android) show({ prompt, stage: 'waiting' })
    await NfcManager.requestTechnology(NfcTech.IsoDep, { alertMessage: prompt })
    if (android) {
      show({ prompt, stage: 'reading' })
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    }
    const transceive: Transceive = async (apdu) => NfcManager.isoDepHandler.transceive(apdu)
    const result = await work(transceive)
    if (Platform.OS === 'ios') await NfcManager.setAlertMessageIOS(done).catch(() => {})
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    if (android) {
      show({ prompt, stage: 'done', message: done })
      await pause(900)
      show(null)
    }
    return result
  } catch (error) {
    const message =
      error instanceof HaloError || error instanceof CardError
        ? error.message
        : 'That didn’t work. Try again.'
    if (Platform.OS === 'ios')
      await NfcManager.invalidateSessionWithErrorIOS(message).catch(() => {})
    const gaveUp = cancelled(error) || isCancelled(error)
    if (android) {
      if (gaveUp) show(null)
      else {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
        show({ prompt, stage: 'failed', message })
        void pause(1800).then(() => session?.stage === 'failed' && show(null))
      }
    }
    throw gaveUp ? new CardError('Cancelled.', 0, { cancelled: true }) : error
  } finally {
    await NfcManager.cancelTechnologyRequest().catch(() => {})
  }
}

/** The person closed the NFC sheet, or it timed out: not an error worth showing. */
function cancelled(error: unknown): boolean {
  const text = String((error as { message?: string })?.message ?? error)
  return /cancel|UserCancel|session.*(invalidated|timeout)/i.test(text)
}

export const isCancelled = (error: unknown) =>
  error instanceof CardError && Boolean(error.details.cancelled)

// ── Holder actions ──────────────────────────────────────────────────────────────────────────

type SignTypedData = (typedData: TypedDataDefinition) => Promise<Hex>

const inTenMinutes = () => BigInt(Math.floor(Date.now() / 1000) + 540)

export interface LinkPlan {
  holder: Address
  dailyLimit: string
  pin: string
}

/**
 * Links a card in one tap and one approval. The card signs that it's being linked to this wallet
 * (so nobody can link a card they don't hold), then the wallet approves the link and lets the
 * card contract draw on it, which it only ever does for a tap Kova and the card both signed.
 */
export async function linkCard(plan: LinkPlan, signTypedData: SignTypedData): Promise<KovaCard> {
  const config = await getCardConfig()
  if (!config.ready || !config.contract)
    throw new CardError('Kova Cards aren’t switched on yet.', 0)
  const contract = config.contract
  const deadline = inTenMinutes()

  const { card, cardSignature } = await withCard(
    holdCard('your Kova Card'),
    async (transceive) => {
      const address = await readCard(transceive)
      const status = await cardStatus(address)
      if (status.linked && status.holder && getAddress(status.holder) !== getAddress(plan.holder))
        throw new CardError('This card is linked to another Kova wallet.', 409)
      const claim = claimTypedData(config.chain_id, contract, {
        card: address,
        holder: plan.holder,
        deadline,
      })
      const signed = await signWithCard(transceive, hashTypedData(claim))
      return { card: signed.card, cardSignature: signed.signature }
    },
    'Card read',
  )

  const list = await listCards(plan.holder)
  const dailyLimit = parseAmount(plan.dailyLimit)
  const holderSignature = await signTypedData(
    linkTypedData(config.chain_id, contract, {
      holder: plan.holder,
      card,
      dailyLimit,
      nonce: BigInt(list.nonce),
      deadline,
    }),
  )
  // One permit covers every card this wallet links: skip it when the allowance is already there.
  const needsPermit = BigInt(list.allowance) < maxUint256 / 2n
  const permitSignature = needsPermit
    ? await signTypedData(
        permitTypedData(settlementToken, config.chain_id, {
          owner: plan.holder,
          spender: contract,
          value: maxUint256,
          nonce: BigInt(list.permit_nonce),
          deadline,
        }),
      )
    : null

  return post<KovaCard>('/v1/cards/link', {
    holder: plan.holder,
    card,
    daily_limit: plan.dailyLimit,
    deadline: Number(deadline),
    holder_signature: holderSignature,
    card_signature: cardSignature,
    permit: permitSignature
      ? { value: maxUint256.toString(), deadline: Number(deadline), signature: permitSignature }
      : null,
    pin: plan.pin,
  })
}

/** A new daily limit, or a freeze, approved by the wallet. Kova stops a frozen card at once. */
export async function changeCard(
  card: KovaCard,
  change: { dailyLimit: string; frozen: boolean },
  signTypedData: SignTypedData,
): Promise<KovaCard> {
  const config = await getCardConfig()
  if (!config.contract) throw new CardError('Kova Cards aren’t switched on yet.', 0)
  const list = await listCards(card.holder)
  const deadline = inTenMinutes()
  const signature = await signTypedData(
    updateTypedData(config.chain_id, config.contract, {
      holder: card.holder,
      card: card.address,
      dailyLimit: parseAmount(change.dailyLimit),
      frozen: change.frozen,
      nonce: BigInt(list.nonce),
      deadline,
    }),
  )
  return post<KovaCard>(`/v1/cards/${card.address}/update`, {
    daily_limit: change.dailyLimit,
    frozen: change.frozen,
    deadline: Number(deadline),
    holder_signature: signature,
  })
}

export async function removeCard(card: KovaCard, signTypedData: SignTypedData): Promise<void> {
  const config = await getCardConfig()
  if (!config.contract) throw new CardError('Kova Cards aren’t switched on yet.', 0)
  const list = await listCards(card.holder)
  const deadline = inTenMinutes()
  const signature = await signTypedData(
    unlinkTypedData(config.chain_id, config.contract, {
      holder: card.holder,
      card: card.address,
      nonce: BigInt(list.nonce),
      deadline,
    }),
  )
  await post(`/v1/cards/${card.address}/unlink`, {
    deadline: Number(deadline),
    holder_signature: signature,
  })
}

export async function changePin(
  card: KovaCard,
  pin: string,
  signMessage: (message: string) => Promise<Hex>,
): Promise<void> {
  const signedAt = Math.floor(Date.now() / 1000)
  const signature = await signMessage(
    cardPinMessage({ card: card.address, holder: card.holder, signedAt }),
  )
  await post(`/v1/cards/${card.address}/pin`, { pin, signed_at: signedAt, signature })
}

// ── Till ────────────────────────────────────────────────────────────────────────────────────

export interface ReadTap {
  id: string
  amount: string
  pin_required: boolean
  card: Address
}

/**
 * The till's side of a tap, in one NFC session: read the card, have Kova prepare the payment,
 * have the card sign it. Nothing has moved yet; `finishTap` pays, with the PIN if one is needed.
 */
export async function readTap(paymentIntent: string): Promise<{ tap: ReadTap; signature: Hex }> {
  return withCard(
    holdCard('the Kova Card'),
    async (transceive) => {
      const card = await readCard(transceive)
      const prepared = await post<
        ReadTap & { typed_data: TypedDataDefinition & { message: Record<string, string> } }
      >('/v1/card_taps', { payment_intent: paymentIntent, card }, true)
      const td = prepared.typed_data
      const digest = hashTypedData({
        ...td,
        message: {
          ...td.message,
          amount: BigInt(td.message.amount ?? 0),
          deadline: BigInt(td.message.deadline ?? 0),
        },
      } as TypedDataDefinition)
      const { signature } = await signWithCard(transceive, digest)
      return { tap: prepared, signature }
    },
    'Card read',
  )
}

export interface FinishedTap {
  status: 'paid'
  payment: { id: string | null; tx_hash: string; explorer_url: string }
}

export const finishTap = (tapId: string, signature: Hex, pin?: string) =>
  post<FinishedTap>(`/v1/card_taps/${tapId}/complete`, { card_signature: signature, pin }, true)
