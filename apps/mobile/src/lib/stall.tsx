import * as SecureStore from 'expo-secure-store'
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import { AppState } from 'react-native'
import {
  createOwnerKey,
  createPairing,
  createStall,
  getOwnedShop,
  getStall,
  linkShopOwner,
  listStalls,
  onOwnerKeyRevoked,
  openShop,
  type StallDetail,
  setOwnerKey,
  shopChallenge,
  signInToShop,
} from './api'
import { confirmWithFace } from './auth'
import { useTerminal } from './terminal'
import { useWallet } from './wallet'

/**
 * The shop this phone opened, if it opened one.
 *
 * Opening a stall from the wallet creates a shop that settles into this wallet, keeps the
 * shop's owner key in the Keychain (this device only, never backed up), pairs the phone as
 * the shop's first terminal, and opens its first stall. Each step is saved as it succeeds, so
 * a dropped connection halfway resumes where it stopped rather than opening a second shop.
 */
interface Owned {
  merchantId: string
  name: string
  stallId: string | null
}

export type OpenStep = 'shop' | 'stall' | 'till' | 'done'

interface StallState {
  ready: boolean
  /** Set when this phone opened a shop and holds its owner key. */
  owned: Owned | null
  /** The shop, its stall and this phone as its till are all set up. False midway, or once unpaired. */
  complete: boolean
  /** The stall and what it sells, as last loaded. */
  stall: StallDetail | null
  refresh: () => Promise<StallDetail | null>
  /** Shows a change at once; the server's answer replaces it on the next refresh. */
  patch: (next: StallDetail) => void
  open: (
    input: { name: string; tagline?: string; phone: string; settleTo: string },
    onStep?: (step: OpenStep) => void,
  ) => Promise<void>
  /**
   * Brings back the shop this wallet owns, on a phone that doesn't hold its key: signs in with the
   * wallet, keeps a lasting owner key, and makes this phone its till. False if it owns none.
   */
  recover: () => Promise<boolean>
  /** The owner key, after Face ID, to sign in to the Kova dashboard with. */
  revealKey: () => Promise<string | null>
  /** Whether the wallet's passkey signs in to this shop on the web. Null until known. */
  ownerLinked: boolean | null
  /** Makes this wallet the shop's owner, for a shop opened before shops had owners. One Face ID. */
  linkOwner: () => Promise<void>
}

const STORE = 'kova.owner.v1'
const Ctx = createContext<StallState | null>(null)

export function useStall(): StallState {
  const value = useContext(Ctx)
  if (!value) throw new Error('useStall must be used inside <StallProvider>')
  return value
}

/** The shop this phone holds, with the lowercase address of the wallet that owns it (unknown for shops saved before phones kept it). */
type Saved = Owned & { key: string; owner?: string }

async function save(saved: Saved) {
  await SecureStore.setItemAsync(STORE, JSON.stringify(saved), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  })
}

export function StallProvider({ children }: { children: ReactNode }) {
  const terminal = useTerminal()
  const wallet = useWallet()
  const [ready, setReady] = useState(false)
  const [owned, setOwned] = useState<Owned | null>(null)
  const [stall, setStall] = useState<StallDetail | null>(null)
  const saved = useRef<Saved | null>(null)
  const [ownerLinked, setOwnerLinked] = useState<boolean | null>(null)
  // Which wallet the saved shop belongs to. Another wallet signed in on this phone neither sees
  // nor runs it; the owner's comes back with the owner.
  const [holder, setHolder] = useState<string | null>(null)
  const me = wallet.profile?.address?.toLowerCase()
  const mine = owned !== null && (holder === null || holder === me)

  useEffect(() => {
    void (async () => {
      const raw = await SecureStore.getItemAsync(STORE).catch(() => null)
      if (raw) {
        const value = JSON.parse(raw) as Saved
        saved.current = value
        setHolder(value.owner ?? null)
        setOwned({ merchantId: value.merchantId, name: value.name, stallId: value.stallId })
      }
      setReady(true)
    })()
  }, [])

  const remember = useCallback(async (next: Saved) => {
    saved.current = next
    await save(next)
    setHolder(next.owner ?? null)
    setOwned({ merchantId: next.merchantId, name: next.name, stallId: next.stallId })
  }, [])

  // Owner requests carry the shop's key only while its owner's wallet is the one signed in.
  useEffect(() => {
    setOwnerKey(mine ? (saved.current?.key ?? null) : null)
  }, [mine, owned?.merchantId])

  const refresh = useCallback(async () => {
    const current = saved.current
    if (!current) return null
    let stallId = current.stallId
    try {
      if (stallId) {
        const detail = await getStall(stallId)
        setStall(detail)
        return detail
      }
    } catch (error) {
      // Closed for good from the dashboard: fall through and pick up the shop's next stall.
      if (!(error instanceof Error) || !/no such|not found/i.test(error.message)) throw error
    }
    const [first] = await listStalls()
    stallId = first?.id ?? null
    await remember({ ...current, stallId })
    if (!stallId) {
      setStall(null)
      return null
    }
    const detail = await getStall(stallId)
    setStall(detail)
    return detail
  }, [remember])

  // Load the stall once the key is in, and again whenever the app comes back to the front.
  useEffect(() => {
    if (!owned || !mine) return
    const load = () => void refresh().catch(() => {})
    load()
    const sub = AppState.addEventListener('change', (state) => state === 'active' && load())
    return () => sub.remove()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owned?.merchantId, mine])

  // The owner key was revoked from the dashboard: this phone no longer runs the shop.
  useEffect(() => {
    onOwnerKeyRevoked(() => {
      saved.current = null
      setOwnerKey(null)
      setOwned(null)
      setHolder(null)
      setStall(null)
      void SecureStore.deleteItemAsync(STORE)
    })
    return () => onOwnerKeyRevoked(null)
  }, [])

  const open = useCallback<StallState['open']>(
    async ({ name, tagline, phone, settleTo }, onStep) => {
      const address = wallet.profile?.address
      let current = saved.current
      // A shop saved before phones kept its owner: ask Kova whose it is.
      if (current && !current.owner) {
        setOwnerKey(current.key)
        const owner = (await getOwnedShop().catch(() => null))?.owner_address?.toLowerCase()
        if (owner) {
          current = { ...current, owner }
          await remember(current)
        }
      }
      // A shop another wallet opened on this phone stays theirs: this wallet opens its own.
      if (current?.owner && current.owner !== address?.toLowerCase()) current = null
      if (!current) {
        onStep?.('shop')
        // The wallet opening the shop owns it, so its passkey signs in to the same shop on the
        // web. One Face ID, or none if the wallet is already open.
        const me = address
        if (!me) throw new Error('Open your wallet first.')
        const challenge = await shopChallenge(me, 'open_shop')
        const signature = await wallet.signMessage(challenge.message)
        const shop = await openShop(name, settleTo, { message: challenge.message, signature })
        // That sign-in key lapses with a web session; the till gets a lasting owner key of its own.
        setOwnerKey(shop.key)
        const lasting = await createOwnerKey('Kova app')
        setOwnerKey(lasting.secret)
        current = {
          merchantId: shop.id,
          name: shop.name,
          stallId: null,
          key: lasting.secret,
          owner: me.toLowerCase(),
        }
        await remember(current)
      }
      if (!current.stallId) {
        onStep?.('stall')
        const created = await createStall({ name, tagline: tagline?.trim() || null })
        current = { ...current, stallId: created.id }
        await remember(current)
      }
      if (terminal.paired?.merchantId !== current.merchantId) {
        onStep?.('till')
        // A phone that was another shop's terminal stops being one (the screen asked first).
        if (terminal.paired) await terminal.unpair()
        const { code } = await createPairing()
        await terminal.pair(code, phone)
      }
      await refresh()
      onStep?.('done')
    },
    [remember, refresh, terminal, wallet],
  )

  const recover = useCallback<StallState['recover']>(async () => {
    const me = wallet.profile?.address
    if (!me) return false
    if (saved.current?.owner === me.toLowerCase()) return true
    const challenge = await shopChallenge(me, 'sign_in')
    const signature = await wallet.signMessage(challenge.message)
    let session: Awaited<ReturnType<typeof signInToShop>>
    try {
      session = await signInToShop(challenge.message, signature)
    } catch (error) {
      if (error instanceof Error && /no shop/i.test(error.message)) return false
      throw error
    }
    // The session lapses in a month; the phone keeps a lasting owner key of its own, as when opening.
    setOwnerKey(session.key)
    const lasting = await createOwnerKey('Kova app')
    setOwnerKey(lasting.secret)
    await remember({
      merchantId: session.merchant.id,
      name: session.merchant.name,
      stallId: null,
      key: lasting.secret,
      owner: me.toLowerCase(),
    })
    await refresh()
    if (terminal.paired?.merchantId !== session.merchant.id) {
      if (terminal.paired) await terminal.unpair()
      const { code } = await createPairing()
      await terminal.pair(code, 'This phone')
    }
    return true
  }, [remember, refresh, terminal, wallet])

  // Whether this wallet already signs in to the shop on the web. A shop saved before phones kept
  // its owner learns it here, and disappears if it belongs to another wallet.
  useEffect(() => {
    if (!owned || !me || !mine) return
    let live = true
    getOwnedShop()
      .then((shop) => {
        if (!live) return
        const owner = shop.owner_address?.toLowerCase() ?? null
        if (owner && saved.current && !saved.current.owner)
          void remember({ ...saved.current, owner })
        setOwnerLinked(owner === me)
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [owned, me, mine, remember])

  const linkOwner = useCallback(async () => {
    if (!me) throw new Error('Open your wallet first.')
    const challenge = await shopChallenge(me, 'own_shop')
    const signature = await wallet.signMessage(challenge.message)
    const shop = await linkShopOwner(challenge.message, signature)
    if (saved.current) await remember({ ...saved.current, owner: me })
    setOwnerLinked(shop.owner_address?.toLowerCase() === me)
  }, [me, wallet, remember])

  const revealKey = useCallback(async () => {
    if (!saved.current || !mine) return null
    if (!(await confirmWithFace('Copy your shop key'))) return null
    return saved.current.key
  }, [mine])

  const shown = mine ? owned : null
  const complete = Boolean(shown?.stallId) && terminal.paired?.merchantId === shown?.merchantId
  return (
    <Ctx.Provider
      value={{
        ready,
        owned: shown,
        complete,
        stall: mine ? stall : null,
        refresh,
        patch: setStall,
        open,
        recover,
        revealKey,
        ownerLinked,
        linkOwner,
      }}
    >
      {children}
    </Ctx.Provider>
  )
}
