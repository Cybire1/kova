import { Redirect, router, useLocalSearchParams } from 'expo-router'
import { useEffect, useRef, useState } from 'react'
import { Image, Share, View } from 'react-native'
import { checkStealthAddress, personalStealthKeysMessage, stealthKeysFromSignature, stealthMetaAddress, stealthRegistrationMessage } from '@kova/monad'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { createCharge, createItem, getCatalog, getCheckout, listOrders, lookupBarcode, ringUp, setOrderStatus, type StealthReceipt, updateStall, uploadImage } from '@/lib/api'
import { addPayrollPerson, addSupplier, listPayrollPeople, startPayrollRun } from '@/lib/api'
import { payPayroll, reachOf } from '@/lib/business'
import { apiUrl } from '@/lib/config'
import { finishTap, forgetDevCard, linkCard, readTap } from '@/lib/card'
import type { DisplayCurrency } from '@/lib/money'
import { type Mode, usePrefs } from '@/lib/prefs'
import { stashWallet, unstashWallet } from '@/lib/dev-slots'
import { useOffline } from '@/lib/offline'
import { publishReceivingKey } from '@/lib/private-core'
import { clearOffline } from '@/lib/offline-store'
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
 * on the screen it opens (`to=/private`, say). `/send/<address>?amount=…&private=1&autosend=1` films the sheet,
 * and `payfrom=private|balance` picks where payments come from, as the Pay from switch does.
 * `stash=<name>` keeps this dev wallet whole and signs it out; `unstash=<name>` puts it back for the next launch.
 * Offline payments: `offline=1` makes the app act as if it had no signal (it lasts across launches) and
 * `offline=0` brings it back online, which settles whatever is waiting (`offline=clear` forgets this
 * phone's offline payments, for a clean film). With `offline=1`,
 * `to=/send/<address>?amount=0.25&autosend=1` signs a payment code through the real flow, and
 * `to=%2Fo%3Fcode%3D<code>` opens a payment code as if it was scanned.
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
    /** Where payments come from, as if chosen: balance or private. */
    payfrom?: string
    /**
     * `biz=seed` fills this shop's business book: four people (three can be paid privately) and two
     * suppliers. `biz=pay&amount=0.05` pays everyone who can be paid privately that much, through the
     * real payroll code, and opens the run's receipt.
     */
    biz?: string
    /** Keeps this dev wallet under a name and signs it out, so another can take the phone. */
    stash?: string
    /** Puts a stashed wallet back; launch again to open it. */
    unstash?: string
    /** 1: act as if there's no signal (until 0). */
    offline?: string
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
  const offlinePay = useOffline()
  const offlineRef = useRef(offlinePay)
  offlineRef.current = offlinePay
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
        // stash=<name>: this dev wallet, kept whole, then signed out; unstash=<name>: one put back.
        if (params.stash && !progress.current.reset && wallet.profile) {
          progress.current.reset = true
          setStep(`stashing this wallet as ${params.stash}`)
          await stashWallet(params.stash, wallet.profile.address)
          await wallet.signOut()
          return
        }
        if (params.unstash && wallet.status === 'none' && !progress.current.finished) {
          progress.current.finished = true
          const owner = await unstashWallet(params.unstash)
          setStep(`${params.unstash} (${owner}) is back: launch again to open it`)
          return
        }
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
        if (params.offline === 'clear') {
          await clearOffline()
          console.log('[dev] offline payments on this phone forgotten')
        }
        if (params.offline === '1' || params.offline === '0') {
          await offlineRef.current.force(params.offline === '1')
          const o = offlineRef.current
          console.log(`[dev] ${params.offline === '1' ? 'offline on purpose' : 'back online'}: ${o.items.length} offline payments, ${o.waiting.length} waiting`)
        }
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
        if (params.payfrom === 'private' || params.payfrom === 'balance') privateRef.current.setSource(params.payfrom)
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
        if (params.biz === 'seed') {
          setStep('filling the business book')
          // Each person a wallet of their own; three publish a private-receiving key, as opening Kova does.
          const people: [string, string, boolean][] = [
            ['Tunde Bakare', '250', true],
            ['Amaka Obi', '180', true],
            ['Kemi Adeyemi', '120', true],
            ['Chidi Okafor', '150', false],
          ]
          for (const [name, amount, receives] of people) {
            const person = privateKeyToAccount(generatePrivateKey())
            if (receives) {
              const meta = stealthMetaAddress(stealthKeysFromSignature(await person.signMessage({ message: personalStealthKeysMessage(person.address) })))
              await publishReceivingKey(person.address, meta, await person.signMessage({ message: stealthRegistrationMessage(person.address, meta) }))
            }
            await addPayrollPerson({ name, wallet_address: person.address, amount })
          }
          await addSupplier({ name: 'Lisbon Coffee Roasters', wallet_address: privateKeyToAccount(generatePrivateKey()).address, country: 'Portugal', currency: 'EUR' })
          await addSupplier({ name: 'Shenzhen Parts Co', wallet_address: privateKeyToAccount(generatePrivateKey()).address, country: 'China', currency: 'USD' })
          console.log('[dev] business book filled: 4 people, 2 suppliers')
        }
        if (params.biz === 'pay') {
          setStep('paying the payroll')
          // The shop's owner key comes out of the Keychain a moment after launch.
          let people: Awaited<ReturnType<typeof listPayrollPeople>> = []
          for (let i = 0; i < 20; i++) {
            try {
              people = await listPayrollPeople()
              break
            } catch {
              await new Promise((r) => setTimeout(r, 500))
            }
          }
          const reach = await reachOf(people.map((p) => p.wallet_address))
          const paying = people.filter((p) => reach[p.wallet_address.toLowerCase()] === 'private')
          const run = await startPayrollRun(
            'October salary',
            paying.map((p) => ({ person: p.id, name: p.name, amount: params.amount || p.amount || '0.05' })),
          )
          const wallets = Object.fromEntries(
            run.payments.map((payment) => [payment.id, paying.find((p) => p.id === payment.person)?.wallet_address ?? '']),
          )
          await payPayroll({
            approve: wallet.approve,
            business: stall.owned?.name ?? 'My shop',
            run,
            wallets,
            onLine: (id, line) => console.log(`[dev] payroll ${id}: ${line.state}${line.state === 'failed' ? ` (${line.why})` : line.state === 'paid' ? ` in ${line.ms}ms ${line.explorer}` : ''}`),
          })
          return router.replace({ pathname: '/terminal/payroll-run', params: { id: run.id } })
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
