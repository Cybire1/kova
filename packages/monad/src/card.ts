import {
  type Address,
  decodeEventLog,
  getAddress,
  type Hex,
  isAddressEqual,
  keccak256,
  type Log,
  parseAbi,
} from 'viem'
import type { NetworkId } from './networks.js'

/**
 * The Kova Card on Monad: an NFC chip (an Arx HaLo) whose own secp256k1 key spends from its
 * holder's wallet through the KovaCard contract (apps/card/contracts). A tap moves money only
 * when the card and Kova's cosigner both sign the same Payment, within the daily limit the holder
 * set on-chain. The money never leaves the wallet until a tap sends it to the shop.
 */

/** KovaCard deployments, each owned by Kova's relayer: testnet 2026-10-10, mainnet 2026-10-11 (tx 0xccdea354…901f17). */
export const kovaCardAddresses: Record<NetworkId, Address | null> = {
  testnet: getAddress('0x8430a32F08b6E4771eaa432729107492266A203d'),
  mainnet: getAddress('0x9bee9F2D59d9675F2723B274e1276F5931Ef325E'),
}

export function kovaCardAddress(network: NetworkId): Address | null {
  return kovaCardAddresses[network]
}

export const kovaCardAbi = parseAbi([
  'struct Permit { uint256 value; uint256 deadline; uint8 v; bytes32 r; bytes32 s; }',
  'function link(address holder, address card, uint96 dailyLimit, uint256 deadline, bytes holderSignature, bytes cardSignature, Permit permit)',
  'function update(address card, uint96 dailyLimit, bool frozen, uint256 deadline, bytes holderSignature)',
  'function unlink(address card, uint256 deadline, bytes holderSignature)',
  'function pay(address card, address to, uint256 amount, bytes32 memo, uint256 deadline, bytes cardSignature, bytes cosignerSignature)',
  'function cardOf(address card) view returns (address holder, uint96 dailyLimit, uint96 spentToday, bool frozen, uint256 left)',
  'function nonces(address holder) view returns (uint256)',
  'function memoUsed(bytes32 memo) view returns (bool)',
  'function cosigner() view returns (address)',
  'event CardLinked(address indexed card, address indexed holder, uint96 dailyLimit)',
  'event CardUpdated(address indexed card, address indexed holder, uint96 dailyLimit, bool frozen)',
  'event CardUnlinked(address indexed card, address indexed holder)',
  'event CardPayment(address indexed card, address indexed holder, address indexed to, uint256 amount, bytes32 memo)',
  'error NotOwner()',
  'error NotHolder()',
  'error Expired()',
  'error BadSignature()',
  'error CardTaken()',
  'error UnknownCard()',
  'error Frozen()',
  'error OverDailyLimit(uint256 left)',
  'error MemoUsed()',
  'error ZeroAmount()',
  'error TransferFailed()',
])

export const permitAbi = parseAbi([
  'function nonces(address owner) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
])

const domain = (chainId: number, contract: Address) => ({
  name: 'Kova Card',
  version: '1',
  chainId,
  verifyingContract: contract,
})

export const cardTypes = {
  Link: [
    { name: 'holder', type: 'address' },
    { name: 'card', type: 'address' },
    { name: 'dailyLimit', type: 'uint96' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
  Claim: [
    { name: 'card', type: 'address' },
    { name: 'holder', type: 'address' },
    { name: 'deadline', type: 'uint256' },
  ],
  Update: [
    { name: 'holder', type: 'address' },
    { name: 'card', type: 'address' },
    { name: 'dailyLimit', type: 'uint96' },
    { name: 'frozen', type: 'bool' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
  Unlink: [
    { name: 'holder', type: 'address' },
    { name: 'card', type: 'address' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
  Payment: [
    { name: 'card', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'memo', type: 'bytes32' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const

/** What the wallet signs to link a card. */
export function linkTypedData(
  chainId: number,
  contract: Address,
  message: { holder: Address; card: Address; dailyLimit: bigint; nonce: bigint; deadline: bigint },
) {
  return {
    domain: domain(chainId, contract),
    types: { Link: cardTypes.Link },
    primaryType: 'Link' as const,
    message,
  }
}

/** What the card signs to prove it is the card being linked. */
export function claimTypedData(
  chainId: number,
  contract: Address,
  message: { card: Address; holder: Address; deadline: bigint },
) {
  return {
    domain: domain(chainId, contract),
    types: { Claim: cardTypes.Claim },
    primaryType: 'Claim' as const,
    message,
  }
}

export function updateTypedData(
  chainId: number,
  contract: Address,
  message: {
    holder: Address
    card: Address
    dailyLimit: bigint
    frozen: boolean
    nonce: bigint
    deadline: bigint
  },
) {
  return {
    domain: domain(chainId, contract),
    types: { Update: cardTypes.Update },
    primaryType: 'Update' as const,
    message,
  }
}

export function unlinkTypedData(
  chainId: number,
  contract: Address,
  message: { holder: Address; card: Address; nonce: bigint; deadline: bigint },
) {
  return {
    domain: domain(chainId, contract),
    types: { Unlink: cardTypes.Unlink },
    primaryType: 'Unlink' as const,
    message,
  }
}

/** A tap: the card and Kova's cosigner both sign exactly this. */
export function paymentTypedData(
  chainId: number,
  contract: Address,
  message: { card: Address; to: Address; amount: bigint; memo: Hex; deadline: bigint },
) {
  return {
    domain: domain(chainId, contract),
    types: { Payment: cardTypes.Payment },
    primaryType: 'Payment' as const,
    message,
  }
}

/** EIP-2612: what the wallet signs to let the KovaCard contract draw on it. */
export function permitTypedData(
  token: { address: Address; domain: { name: string; version: string } },
  chainId: number,
  message: { owner: Address; spender: Address; value: bigint; nonce: bigint; deadline: bigint },
) {
  return {
    domain: { ...token.domain, chainId, verifyingContract: token.address },
    types: {
      Permit: [
        { name: 'owner', type: 'address' },
        { name: 'spender', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
      ],
    },
    primaryType: 'Permit' as const,
    message,
  }
}

/** A permit signature split the way the contract takes it. */
export function splitPermit(value: bigint, deadline: bigint, signature: Hex) {
  return {
    value,
    deadline,
    r: `0x${signature.slice(2, 66)}` as Hex,
    s: `0x${signature.slice(66, 130)}` as Hex,
    v: Number.parseInt(signature.slice(130, 132), 16),
  }
}

export const NO_PERMIT = {
  value: 0n,
  deadline: 0n,
  v: 0,
  r: `0x${'00'.repeat(32)}` as Hex,
  s: `0x${'00'.repeat(32)}` as Hex,
}

/**
 * The four digits printed on a card and shown in the app, from the card's own address: the same
 * card always shows the same number, and it says nothing about the key.
 */
export function cardLastFour(card: Address): string {
  const n = BigInt(keccak256(getAddress(card))) % 10_000n
  return n.toString().padStart(4, '0')
}

export interface CardPaymentLog {
  card: Address
  holder: Address
  to: Address
  amount: bigint
  memo: Hex
  logIndex: number
}

/** Every CardPayment the KovaCard contract emitted in these logs. */
export function decodeCardPayments(
  logs: readonly Log[],
  contract: Address | null,
): CardPaymentLog[] {
  if (!contract) return []
  const found: CardPaymentLog[] = []
  logs.forEach((log, position) => {
    if (!isAddressEqual(log.address, contract)) return
    try {
      const event = decodeEventLog({ abi: kovaCardAbi, data: log.data, topics: log.topics })
      if (event.eventName !== 'CardPayment') return
      found.push({ ...event.args, logIndex: log.logIndex ?? position })
    } catch {
      // Another KovaCard event.
    }
  })
  return found
}

/** What a holder signs (personal_sign) to change their card's PIN. */
export function cardPinMessage(change: {
  card: Address
  holder: Address
  signedAt: number
}): string {
  return [
    'Kova Card: change PIN',
    `Card: ${getAddress(change.card)}`,
    `Wallet: ${getAddress(change.holder)}`,
    `Signed at: ${change.signedAt}`,
  ].join('\n')
}

/** A PIN is 4 to 6 digits, and not one a stranger would guess first. */
export function cardPinProblem(pin: string): string | null {
  if (!/^\d{4,6}$/.test(pin)) return 'A PIN is 4 to 6 digits.'
  if (/^(\d)\1+$/.test(pin)) return 'Pick a PIN that isn’t one digit repeated.'
  if ('0123456789'.includes(pin) || '9876543210'.includes(pin))
    return 'Pick a PIN that isn’t a run of digits.'
  return null
}
