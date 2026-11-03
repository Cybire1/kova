import type { CardDetails, DollarCard } from './partners'

/**
 * Development only: a pretend approved dollar card, so its screens (balance, top-up, withdraw,
 * details, freeze) can be tried on a simulator with no card issuer behind it. The dev link turns it
 * on with `dollarcard=demo`; release builds never do (`demoCardOn` is false outside __DEV__). Its
 * numbers add up: two top-ups less two purchases is the balance.
 */

const USD = 1_000_000n
const ago = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString()

let on = false
let state = fresh()

function fresh() {
  return {
    balance: 144_020_000n, // $225.00 topped up − $69.99 − $10.99
    today: 25_000_000n,
    frozen: false,
    activity: [
      {
        id: 'd1',
        kind: 'spend',
        amount: '-69990000',
        status: 'successful',
        title: 'PlayStation Store',
        at: ago(1),
      },
      {
        id: 'd2',
        kind: 'topup',
        amount: '25000000',
        status: 'successful',
        title: 'Top up from Kova',
        at: ago(2),
      },
      {
        id: 'd3',
        kind: 'spend',
        amount: '-10990000',
        status: 'successful',
        title: 'Spotify',
        at: ago(26),
      },
      {
        id: 'd4',
        kind: 'topup',
        amount: '200000000',
        status: 'successful',
        title: 'Top up from Kova',
        at: ago(28),
      },
    ] as NonNullable<DollarCard['activity']>,
  }
}

export const demoCardOn = () => __DEV__ && on

export function startDemoCard() {
  on = true
  state = fresh()
}

export function demoCard(): DollarCard {
  const cap = 100n * USD
  return {
    live: true,
    sandbox: false,
    requested: false,
    stage: 'card',
    daily_topup: cap.toString(),
    topup_fee_bps: 50,
    card: {
      last_four: '4821',
      brand: 'mastercard',
      exp_month: '09',
      exp_year: '29',
      frozen: state.frozen,
      balance: state.balance.toString(),
      name: 'Ada Okafor',
    },
    topups: {
      today: state.today.toString(),
      left: (cap > state.today ? cap - state.today : 0n).toString(),
      treasury: '0x0000000000000000000000000000000000000001',
    },
    activity: state.activity,
  } as unknown as DollarCard
}

export function demoTopUp(amount: bigint): DollarCard {
  state.balance += amount
  state.today += amount
  state.activity = [
    {
      id: `t${Date.now()}`,
      kind: 'topup',
      amount: amount.toString(),
      status: 'successful',
      title: 'Top up from Kova',
      at: new Date().toISOString(),
    },
    ...state.activity,
  ] as typeof state.activity
  return demoCard()
}

export function demoWithdraw(amount: bigint): DollarCard {
  if (amount > state.balance) throw new Error('Your card doesn’t have that much.')
  state.balance -= amount
  state.activity = [
    {
      id: `w${Date.now()}`,
      kind: 'withdraw',
      amount: (-amount).toString(),
      status: 'successful',
      title: 'Moved to Kova',
      at: new Date().toISOString(),
    },
    ...state.activity,
  ] as typeof state.activity
  return demoCard()
}

export function demoFreeze(frozen: boolean): DollarCard {
  state.frozen = frozen
  return demoCard()
}

export const demoDetails = {
  brand: 'mastercard',
  number: '5412751234124821',
  cvv: '381',
  exp_month: '09',
  exp_year: '2029',
  name: 'Ada Okafor',
  billing_address: {
    line1: '390 NE 191st St',
    line2: 'Ste 8972',
    city: 'Miami',
    state: 'FL',
    postal_code: '33179',
    country: 'US',
  },
} as CardDetails
