import {
  type Address,
  getAddress,
  isAddressEqual,
  namehash,
  type PublicClient,
  zeroAddress,
} from 'viem'
import { normalize } from 'viem/ens'
import { monClient } from './mon-conversion.js'

/**
 * Nad Name Service (nad.domains), Monad's names: send to "ada.nad" instead of an address.
 * Names live on Monad mainnet only. Checked on 2026-10-20: the mainnet contract below resolves
 * monad.nad and nad.nad; the testnet address in their docs has no code. So on testnet too, a name
 * is looked up on mainnet, and the dollars go to that address on the network you're on.
 */
export const NAD_NAME_SERVICE: Address = '0xCc7a1bfF8845573dbF0B3b96e25B9b549d4a2eC7'

const nnsAbi = [
  {
    name: 'getResolvedAddress',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'getPrimaryNameForAddress',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'addr', type: 'address' }],
    outputs: [{ name: '', type: 'string' }],
  },
] as const

/**
 * The .nad name typed, normalized (ENSIP-15, so "Ada.NAD" and "ada.nad" are one name, and
 * look-alike characters are refused), or null. With `bare`, a plain word ("ada", "@ada") counts
 * too, unless it's only digits, so a phone number being typed never becomes a lookup.
 */
export function nadNameInput(text: string, bare = false): string | null {
  const t = text.trim().replace(/^@/, '')
  const label = /\.nad$/i.test(t) ? t.slice(0, -4) : bare ? t : null
  if (!label || label.length < 2 || label.length > 63 || /[\s./:@]/.test(label)) return null
  if (!/[^\d-]/.test(label) || /^0x[0-9a-f]*$/i.test(label)) return null
  try {
    return normalize(`${label}.nad`)
  } catch {
    return null
  }
}

const TTL = 5 * 60_000
const forward = new Map<string, { at: number; address: Address | null }>()
const reverse = new Map<string, { at: number; name: string | null }>()

/** Who a .nad name points to now, or null when no one has it. Throws when Monad can't be reached. */
export async function resolveNadName(
  name: string,
  client: PublicClient = monClient,
): Promise<Address | null> {
  const hit = forward.get(name)
  if (hit && Date.now() - hit.at < TTL) return hit.address
  const found = await client.readContract({
    address: NAD_NAME_SERVICE,
    abi: nnsAbi,
    functionName: 'getResolvedAddress',
    args: [namehash(name)],
  })
  const address = isAddressEqual(found, zeroAddress) ? null : getAddress(found)
  forward.set(name, { at: Date.now(), address })
  return address
}

/**
 * An address's own .nad name, or null. Only when the name points back to the address, so a
 * wallet can't show itself under someone else's name. Never throws: a name is a nicety here.
 */
export async function nadNameOf(
  address: Address,
  client: PublicClient = monClient,
): Promise<string | null> {
  const key = address.toLowerCase()
  const hit = reverse.get(key)
  if (hit && Date.now() - hit.at < TTL) return hit.name
  try {
    const label = await client.readContract({
      address: NAD_NAME_SERVICE,
      abi: nnsAbi,
      functionName: 'getPrimaryNameForAddress',
      args: [address],
    })
    const name = label ? nadNameInput(`${label}.nad`) : null
    const back = name ? await resolveNadName(name, client) : null
    const mine = name && back && isAddressEqual(back, address) ? name : null
    reverse.set(key, { at: Date.now(), name: mine })
    return mine
  } catch {
    return null
  }
}
