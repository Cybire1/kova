import { Redirect, router, useLocalSearchParams } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { Image, Share, View } from 'react-native'
import { checkStealthAddress } from '@kova/monad'
import { createCharge, createItem, getCatalog, getCheckout, listOrders, lookupBarcode, ringUp, setOrderStatus, type StealthReceipt, updateStall, uploadImage } from '@/lib/api'
import { apiUrl } from '@/lib/config'
import { finishTap, forgetDevCard, linkCard, readTap } from '@/lib/card'
import type { DisplayCurrency } from '@/lib/money'
import { type Mode, usePrefs } from '@/lib/prefs'
import { usePrivate } from '@/lib/private'
import { useStall } from '@/lib/stall'
import { save } from '@/lib/storage'
import { useTakings } from '@/lib/takings'
import { viewFrom } from '@/lib/takings-core'
import { forgetTakingsKeys } from '@/lib/takings-store'
import { useTerminal } from '@/lib/terminal'
import { colors } from '@/lib/theme'
import { useWallet } from '@/lib/wallet'
import { Txt } from '@/ui/primitives'
import { booksMessage } from '@/ui/Takings'

/**
 * Development only: `kova://dev?name=Maya&cur=EUR&fund=1&mode=pay&to=/send` sets up a wallet
 * (`fake=1` makes it from a random key, without the passkey sheet)
 * and jumps to a screen; `pay=<charge>` or `send=<address>&amount=<base units>&payee=<name>` runs the real
 * payment code, so every screen can be reached on a simulator without tapping. `pair=<code>`
 * pairs this phone as a terminal, `unpair=1` forgets it, `rename=<address>:<name>` names a contact,
 * `stall=<name>&tagline=<line>` opens a stall from this wallet the way Profile does, `seed=1` fills
 * that stall with a small menu (and a barcoded drink for the till), `seed=bakery` with a bakery's, `till=keypad|items|scan` picks
 * the till's mode, `tables=6&stamps=5` gives the stall table codes and a stamp card (0 turns either off), and `sell=<item name>*<qty>;<item name>*<qty>` rings a sale up at the till and shows the customer display.
 * `card=link&limit=100&pin=4827` links the software Kova Card (`newcard=1` makes a fresh one first); `tapcard=<charge>` taps it at this till.
 * `takings=on|off|open` turns this shop's private takings on or off (or opens its keys on this phone) through the real flow,
 * `takings=forget` drops this phone's copy of the keys (relaunch to see the phone without them),
 * `charge=8.00,3.25` makes a charge for each amount (with private takings on, each pays its own address), `move=1` moves
 * every private sale into the wallet, and `books=1` opens the share sheet with the accountant's view.
 * Private sends between people: `private=setup` makes this wallet's private-receiving keys and gives Kova
 * the public half (as opening the wallet does), `private=look` looks through Kova's feed now, `send=…&private=1`
 * sends privately through the real code, and `movein=1` moves every private payment into the balance
 * on the screen it opens (`to=/private`, say). `/send/<address>?amount=…&private=1&autosend=1` films the sheet.
 * Release builds redirect home.
 */
/** A small Lagos kitchen menu for trying the stall screens. */
const SEED = [
  {
    name: 'Jollof rice and chicken',
    price: '6.50',
    description: 'Smoky party jollof with a grilled drumstick',
  },
  { name: 'Suya, beef', price: '4.00', description: 'Spiced skewers with onions and yaji' },
  { name: 'Moi moi', price: '2.50', description: 'Steamed bean pudding with egg' },
  { name: 'Puff-puff, six', price: '2.00', description: null },
  { name: 'Zobo, 50cl', price: '1.50', description: 'Hibiscus, ginger and pineapple, cold' },
]

/** `seed=bakery`: a small bakery menu, for films and screens that shouldn't point at one country. */
const BAKERY = [
  {
    name: 'Sourdough loaf',
    price: '6.50',
    description: 'Slow-proved, with a crackly crust',
    category: 'Breads',
    stock: 8,
    photo: require('../../assets/demo/bakery-loaf.png'),
  },
  {
    name: 'Baguette',
    price: '3.00',
    description: 'Baked three times a day',
    category: 'Breads',
    stock: 14,
    photo: require('../../assets/demo/bakery-baguette.png'),
  },
  {
    name: 'Croissant',
    price: '3.25',
    description: 'All butter, baked this morning',
    category: 'Pastries',
    stock: 12,
    photo: require('../../assets/demo/bakery-croissant.png'),
  },
  {
    name: 'Cinnamon bun',
    price: '3.75',
    description: 'Cardamom sugar on top',
    category: 'Pastries',
    stock: 3,
    photo: require('../../assets/demo/bakery-bun.png'),
  },
  {
    name: 'Chocolate cookie',
    price: '2.50',
    description: 'Sea salt and dark chocolate',
    category: 'Pastries',
    stock: 0,
    photo: require('../../assets/demo/bakery-cookie.png'),
  },
  {
    name: 'Carrot cake',
    price: '5.00',
    description: 'Cream cheese frosting',
    category: 'Cakes',
    stock: 6,
    photo: require('../../assets/demo/bakery-cake.png'),
  },
  {
    name: 'Flat white',
    price: '4.50',
    description: 'Double shot, whole milk',
    category: 'Coffee',
    stock: null,
    photo: require('../../assets/demo/bakery-flatwhite.png'),
  },
  {
    name: 'Iced latte',
    price: '4.75',
    description: 'Over ice, oat milk on request',
    category: 'Coffee',
    stock: null,
    photo: require('../../assets/demo/bakery-latte.png'),
  },
]

/** A weaver's shop, for the film: each item with its photo, uploaded like any owner's. */
const WEAVES = [
  {
    name: 'Mountain blanket',
    price: '48.00',
    description: 'Handwoven wool, three weeks on the loom',
    photo: require('../../assets/demo/blanket.png'),
  },
  {
    name: 'Wool scarf',
    price: '22.00',
    description: 'Soft, warm, striped in saffron',
    photo: require('../../assets/demo/scarf.png'),
  },
  {
    name: 'Table runner',
    price: '16.00',
    description: 'Diamond weave, finished by hand',
    photo: require('../../assets/demo/runner.png'),
  },
  {
    name: 'Woven pouch',
    price: '9.00',
    description: 'For coins, keys, small treasures',
    photo: require('../../assets/demo/pouch.png'),
  },
]

export default function Dev() {
  const params = useLocalSearchParams<{
    name?: string
    cur?: string
    fake?: string
    fund?: string
    mode?: string
    to?: string
    then?: string
    reset?: string
    pay?: string
    send?: string
    amount?: string
    pair?: string
    unpair?: string
    rename?: string
    stall?: string
    tagline?: string
    seed?: string
    tables?: string
    /** Moves the newest open stall order to this status: preparing, ready, collected. */
    order?: string
    stamps?: string
    till?: string
    sell?: string
    payee?: string
    card?: string
    newcard?: string
    limit?: string
    pin?: string
    tapcard?: string
    demo?: string
    takings?: string
    charge?: string
    move?: string
    books?: string
    private?: string
    movein?: string
  }>()
  const wallet = useWallet()
  const prefs = usePrefs()
  const terminal = useTerminal()
  const stall = useStall()
  // The takings callbacks read their latest state themselves; `ready` is read through this ref.
  const takings = useTakings()
  const takingsRef = useRef(takings)
  takingsRef.current = takings
  const privately = usePrivate()
  const privateRef = useRef(privately)
  privateRef.current = privately
  const [step, showStep] = useState('starting')
  const setStep = (next: string) => {
    console.log(`[dev] ${next}`)
    showStep(next)
  }
  // The effect runs again whenever the wallet changes: reset and create each happen once, and
  // the steps after them run once, in the run that has the new wallet.
  const progress = useRef({ reset: false, created: false, finished: false })

  useEffect(() => {
    if (
      !__DEV__ ||
      wallet.status === 'loading' ||
      !prefs.ready ||
      !terminal.ready ||
      !stall.ready ||
      progress.current.finished
    )
      return
    void (async () => {
      try {
        if (params.reset && !progress.current.reset) {
          progress.current.reset = true
          if (wallet.status !== 'none') {
            setStep('signing out')
            await wallet.signOut()
            return
          }
        }
        // demo=<username>:<password>: signs in to the App Review demo account, as its screen does.
        if (params.demo && !progress.current.created) {
          progress.current.created = true
          setStep('signing in to the demo account')
          const [user, ...pass] = params.demo.split(':')
          await wallet.signInDemo(user ?? '', pass.join(':'))
          return
        }
        if (params.demo && !progress.current.finished) {
          progress.current.finished = true
          setStep('bringing back the shop')
          await stall.recover()
          return router.replace((params.to as never) || '/')
        }
        if (params.mode) prefs.setMode(params.mode as Mode)
        if (params.name && wallet.status === 'none') {
          if (progress.current.created) return
          progress.current.created = true
          setStep('creating wallet')
          // fake=1: no passkey sheet, for a simulator nobody is tapping.
          if (params.fake && wallet.createForDev)
            await wallet.createForDev(params.name, (params.cur as DisplayCurrency) || 'USD')
          else await wallet.create(params.name, (params.cur as DisplayCurrency) || 'USD')
          return
        }
        progress.current.finished = true
        console.log(`[dev] wallet ${wallet.profile?.address ?? 'none'}`)
        if (params.fund) {
          setStep('funding')
          await wallet.addMoney().catch(() => {})
        }
        if (params.unpair) await terminal.unpair()
        if (params.pair) {
          setStep('pairing')
          await terminal.pair(params.pair, 'Front counter')
        }
        if (params.stall) {
          setStep('opening a stall')
          const profile = wallet.profile
          if (profile)
            await stall.open(
              {
                name: params.stall,
                tagline: params.tagline,
                phone: `${profile.name.split(' ')[0]}’s phone`,
                settleTo: profile.address,
              },
              setStep,
            )
        }
        if (params.seed) {
          setStep('filling the stall')
          const detail = await stall.refresh()
          if (params.seed === 'weaves' || params.seed === 'bakery')
            for (const { photo, ...item } of params.seed === 'weaves' ? WEAVES : BAKERY) {
              const image = await uploadImage(
                Image.resolveAssetSource(photo).uri,
                'image/png',
              ).catch(() => null)
              await createItem({
                ...item,
                image_id: image?.id ?? null,
                stall_ids: detail ? [detail.id] : [],
              })
            }
          else
            for (const item of SEED)
              await createItem({ ...item, stall_ids: detail ? [detail.id] : [] })
          if (params.seed !== 'bakery' && params.seed !== 'weaves') {
            const coke = await lookupBarcode('5449000000996', 'owner').catch(() => null)
            const photo = coke?.suggestion?.image_url
              ? await uploadImage(coke.suggestion.image_url).catch(() => null)
              : null
            await createItem({
              name: 'Coca-Cola 33cl',
              price: '1.20',
              barcode: '5449000000996',
              image_id: photo?.id ?? null,
            })
          }
          await stall.refresh()
        }
        if (params.tables || params.stamps) {
          setStep('setting up tables and the stamp card')
          const detail = await stall.refresh()
          if (detail)
            await updateStall(detail.id, {
              ...(params.tables ? { table_count: Number(params.tables) || null } : {}),
              ...(params.stamps ? { loyalty_every: Number(params.stamps) || null } : {}),
            })
          await stall.refresh()
        }
        if (params.order) {
          setStep(`marking the newest order ${params.order}`)
          const [newest] = await listOrders('open', 1)
          if (newest) await setOrderStatus(newest.id, params.order as Parameters<typeof setOrderStatus>[1])
        }
        if (params.till) await save('kova.till.mode', params.till)
        if (params.sell) {
          setStep('ringing up')
          const catalog = await getCatalog()
          const lines = params.sell.split(';').flatMap((part) => {
            const [name, qty] = part.split('*')
            const item = catalog.find((i) => i.name === name)
            return item ? [{ id: item.id, quantity: Number(qty ?? 1) }] : []
          })
          const sale = await ringUp(lines)
          const usd = sale.payment_intent.amount
          console.log(`[dev] till sale ${sale.payment_intent.id} for $${usd}`)
          return router.replace({
            pathname: '/terminal/[id]',
            params: { id: sale.payment_intent.id, price: `$${usd}`, usd },
          })
        }
        // card=link: links this install's software Kova Card (the simulator has no NFC) through the
        // real flow, with `limit` dollars a day and `pin`, then shows the Card tab.
        if (params.card === 'link' && wallet.profile) {
          setStep('linking a card')
          // newcard=1: a fresh software card, when this install's last one is linked to an old wallet.
          if (params.newcard) await forgetDevCard()
          await linkCard(
            {
              holder: wallet.profile.address,
              dailyLimit: params.limit || '100',
              pin: params.pin || '4827',
            },
            wallet.signTypedData,
          )
          return router.replace('/(tabs)/card')
        }
        // tapcard=<charge>: taps the software card on this till for that charge, as a customer would.
        if (params.tapcard) {
          setStep('tapping a card')
          const { tap, signature } = await readTap(params.tapcard)
          if (!tap.pin_required) await finishTap(tap.id, signature)
          else if (params.pin) await finishTap(tap.id, signature, params.pin)
          return router.replace({ pathname: '/terminal/[id]', params: { id: params.tapcard } })
        }
        if (params.takings === 'forget') {
          await forgetTakingsKeys()
          console.log('[dev] private takings keys forgotten on this phone')
        } else if (params.takings || params.move || params.books) {
          setStep('opening private takings')
          for (let i = 0; i < 100 && !takingsRef.current.ready; i++) await new Promise((r) => setTimeout(r, 200))
          await takingsRef.current.refresh()
        }
        if (params.takings && params.takings !== 'forget') {
          setStep(`private takings ${params.takings}`)
          const t = takingsRef.current
          const ok = await (params.takings === 'off' ? t.turnOff() : params.takings === 'open' ? t.openHere() : t.turnOn())
          console.log(`[dev] private takings ${params.takings}: ${ok ? 'done' : 'failed'}`)
        }
        if (params.charge) {
          setStep('making charges')
          for (const amount of params.charge.split(',')) {
            const charge = await createCharge(amount, { reference: 'Dev sale' })
            console.log(`[dev] charge ${charge.id} for $${charge.amount} pays ${charge.pay_to}`)
          }
        }
        if (params.rename) {
          const [address, ...name] = params.rename.split(':')
          await wallet.renameContact(address as `0x${string}`, name.join(':'))
        }
        if (params.pay) {
          setStep('paying')
          const entry = await wallet.payCheckout(await getCheckout(params.pay))
          return router.replace({ pathname: '/receipt/[id]', params: { id: entry.id } })
        }
        if (params.private === 'setup') {
          setStep('making private-receiving keys')
          const ok = await privateRef.current.setUp()
          console.log(`[dev] private receiving: ${ok ? 'keys on this phone, Kova has the public half' : `not set up (${privateRef.current.problem?.text ?? 'unknown'})`}`)
        }
        if (params.private === 'look' || params.movein) {
          setStep('looking for private payments')
          for (let i = 0; i < 50 && !privateRef.current.ready; i++) await new Promise((r) => setTimeout(r, 100))
          await privateRef.current.refresh()
          await new Promise((r) => setTimeout(r, 300))
          const p = privateRef.current
          console.log(`[dev] private payments: ${p.receipts.length} found, ${p.waiting} base units waiting at ${p.waitingCount}`)
        }
        if (params.send && params.amount) {
          setStep(params.private === '1' ? 'sending privately' : 'sending')
          const entry = await wallet.send(
            { address: params.send as `0x${string}`, name: params.payee || 'Tunde' },
            BigInt(params.amount),
            undefined,
            { privately: params.private === '1' },
          )
          console.log(`[dev] sent ${entry.amount} base units ${entry.privately ? `privately to ${entry.oneTime}` : `to ${entry.address}`}: ${entry.txHash}`)
          return router.replace({ pathname: '/receipt/[id]', params: { id: entry.id } })
        }
        router.replace((params.to as never) || '/')
        // A screen to open over that one, e.g. `then=/send` for the send sheet over Home.
        if (params.then) setTimeout(() => router.push(params.then as never), 600)
        // On the screen it was asked from, so it shows the move as it happens.
        if (params.movein)
          setTimeout(() => {
            void privateRef.current.moveIn().then((outcome) =>
              console.log(
                `[dev] moved in ${outcome ? `${outcome.count} for ${outcome.amount} base units in ${outcome.ms}ms, ${outcome.failed} failed${outcome.reason ? ` (${outcome.reason})` : ''}, ${outcome.empty} empty: ${outcome.moved.map((m) => m.txHash).join(', ')}` : `nothing (${privateRef.current.problem?.text ?? 'no private dollars waiting'})`}`,
              ),
            )
          }, 1500)
        // On the screen it was asked from, so the card shows the move as it happens.
        if (params.move)
          setTimeout(() => {
            void takingsRef.current.move().then((outcome) =>
              console.log(
                `[dev] moved ${outcome ? `${outcome.count} for ${outcome.amount} base units in ${outcome.ms}ms, ${outcome.failed} failed${outcome.reason ? ` (${outcome.reason})` : ''}, ${outcome.empty} empty` : 'nothing'}`,
              ),
            )
          }, 1500)
        if (params.books) {
          const name = stall.owned?.name ?? 'My shop'
          const link = takingsRef.current.booksLink(name)
          if (link) {
            // What the accountant's page does with it: read the key after the #, and find the shop's
            // sales among everyone's. Logged without the key.
            const [fragment = ''] = link.split('#')[1]?.split('&') ?? []
            const view = viewFrom(decodeURIComponent(fragment))
            const all = await fetch(`${apiUrl}/v1/public/stealth/announcements?limit=1000`).then((r) => r.json() as Promise<{ data: StealthReceipt[] }>)
            const opens = all.data.filter(
              (a) => checkStealthAddress(view, { ephemeralPublicKey: a.ephemeral_public_key, viewTag: a.view_tag, stealthAddress: a.stealth_address }) !== null,
            )
            console.log(`[dev] accountant view ${link.split('#')[0]}#kova-view:… opens ${opens.length} of ${all.data.length} sales on Kova`)
            setTimeout(() => void Share.share({ message: booksMessage(name, link) }), 1200)
          }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.warn(`[dev] failed: ${message}`)
        showStep(`failed: ${message}`)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet.status, prefs.ready, terminal.ready, stall.ready])

  if (!__DEV__) return <Redirect href="/" />
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.paper,
      }}
    >
      <Txt>{step}</Txt>
    </View>
  )
}
