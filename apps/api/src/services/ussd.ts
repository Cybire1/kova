import { formatAmount, normalizePhone, parseAmount } from '@kova/monad'
import { config } from '../config.js'
import { KovaError } from '../errors.js'
import {
  checkPin,
  intentForTillCode,
  type Pocket,
  pocketBalance,
  pocketForPhone,
  pocketsReady,
  recentSpends,
  reconcilePocket,
  type Spend,
  spend,
  spendForSession,
  spentToday,
  walletForPhone,
} from './pockets.js'
import { sendSmsLater } from './sms.js'

/**
 * Kova's USSD menu: what a phone with no data shows after dialling Kova's code.
 *
 * Africa's Talking calls once per step with everything typed so far, joined by "*" ("2*482913*1234"),
 * so the menu is a pure function of that text and needs no session state. A reply starting "CON"
 * waits for the next answer; "END" closes the session. A screen holds about 160 characters.
 *
 *   1 Balance          PIN, then the pocket's balance and what's left to spend today
 *   2 Pay a till       the till's 6-digit code, then PIN: pays that charge, the till shows Paid
 *   3 Send to a phone  number, amount, PIN: lands in the wallet behind that number
 *   4 My payments      PIN, then the last three
 */

const con = (text: string) => `CON ${text}`
const end = (text: string) => `END ${text}`

/** Phone networks give up on a step after about 15 seconds, so a payment answers within 9. */
const ANSWER_WITHIN_MS = 9_000

const money = (base: bigint) => `$${formatAmount(base)}`

function mask(phone: string): string {
  return `${phone.slice(0, 4)}…${phone.slice(-3)}`
}

export interface UssdRequest {
  sessionId: string
  phoneNumber: string
  text: string
}

export async function ussdReply(request: UssdRequest): Promise<string> {
  const phone = normalizePhone(request.phoneNumber)
  const pocket = phone ? await pocketForPhone(phone) : undefined
  if (!phone || !pocket)
    return end(
      'This number has no Kova pocket yet. Open Kova, go to Profile, then Pay by USSD to set one up.',
    )
  if (!pocketsReady())
    return end('USSD payments are paused. Your dollars can be returned from Kova’s USSD settings.')
  await reconcilePocket(pocket)

  const steps = request.text === '' ? [] : request.text.split('*')
  const [choice, ...rest] = steps

  if (choice === undefined)
    return con('Kova\n1 Balance\n2 Pay a till\n3 Send to a phone\n4 My payments')

  if (choice === '1') {
    const [pin] = rest
    if (pin === undefined) return con('Enter your Kova PIN:')
    const denied = await pinDenied(pocket, pin)
    if (denied) return denied
    const [balance, spent] = await Promise.all([pocketBalance(pocket), spentToday(pocket)])
    const left = pocket.cap > spent ? pocket.cap - spent : 0n
    return end(
      `Pocket: ${money(balance)}\nYou can spend ${money(left)} more today.\nAdd money in the Kova app.`,
    )
  }

  if (choice === '2') {
    const [code, pin] = rest
    if (pin !== undefined) {
      const earlier = await spendForSession(pocket, `ussd:${request.sessionId}`)
      if (earlier) {
        const denied = await pinDenied(pocket, pin)
        if (denied) return denied
        return answerFor(earlier, earlier.kind)
      }
    }
    if (code === undefined) return con('Enter the 6-digit code on the till:')
    const charge = /^\d{6}$/.test(code) ? await intentForTillCode(code) : null
    if (!charge) return end('No open charge has that code. Check the till and dial again.')
    if (pin === undefined)
      return con(
        `Pay ${charge.merchantName}\n${money(charge.intent.amount)}\n\nEnter your PIN to pay:`,
      )
    const denied = await pinDenied(pocket, pin)
    if (denied) return denied
    return pay(pocket, {
      sessionId: `ussd:${request.sessionId}`,
      kind: 'till',
      to: charge.intent.payTo as `0x${string}`,
      toLabel: charge.merchantName,
      amount: charge.intent.amount,
      intent: charge.intent,
    })
  }

  if (choice === '3') {
    const [number, amountText, pin] = rest
    if (number === undefined)
      return con('Send to which number?\nWith the country code, e.g. 2348012345678')
    const to = normalizePhone(number.startsWith('+') ? number : `+${number}`)
    if (!to) return end('That number doesn’t look right. Dial again and include the country code.')
    if (to === phone) return end('That’s your own number.')
    const wallet = await walletForPhone(to)
    if (!wallet) return end(`${mask(to)} isn’t on Kova yet. Ask them to get Kova at mykova.app.`)
    if (amountText === undefined) return con(`Send to ${mask(to)}\nAmount in dollars:`)
    if (!/^\d{1,4}(\.\d{1,2})?$/.test(amountText) || Number(amountText) === 0)
      return end('Enter dollars and cents, like 5 or 0.50.')
    const amount = parseAmount(amountText)
    if (pin === undefined)
      return con(`Send ${money(amount)} to ${mask(to)}\n\nEnter your PIN to send:`)
    const denied = await pinDenied(pocket, pin)
    if (denied) return denied
    return pay(pocket, {
      sessionId: `ussd:${request.sessionId}`,
      kind: 'phone',
      to: wallet,
      toLabel: to,
      amount,
    })
  }

  if (choice === '4') {
    const [pin] = rest
    if (pin === undefined) return con('Enter your Kova PIN:')
    const denied = await pinDenied(pocket, pin)
    if (denied) return denied
    const spends = (await recentSpends(pocket, 3)).filter((s) => s.status !== 'failed')
    if (spends.length === 0) return end('No payments yet.')
    return end(spends.map((s) => `${s.reference} ${money(s.amount)} ${label(s)}`).join('\n'))
  }

  return end('Choose 1, 2, 3 or 4. Dial again to start over.')
}

function label(s: Spend): string {
  if (s.kind === 'withdraw') return 'to your wallet'
  return s.kind === 'phone' ? `to ${mask(s.toLabel)}` : s.toLabel.slice(0, 18)
}

async function pinDenied(pocket: Pocket, pin: string): Promise<string | null> {
  const check = await checkPin(pocket, pin)
  if (check.ok) return null
  if (check.locked) return end('Too many wrong PINs. Try again in 15 minutes.')
  return end(`Wrong PIN. ${check.triesLeft} ${check.triesLeft === 1 ? 'try' : 'tries'} left.`)
}

async function pay(pocket: Pocket, request: Parameters<typeof spend>[1]): Promise<string> {
  // A network resending the last step gets the same answer, and no second receipt.
  let answered = false
  const job = spend(pocket, request).then(
    (done) => done,
    (error: unknown) => {
      // Only text about a failure the screen couldn't show: the phone had already been answered.
      if (answered) {
        const why =
          error instanceof KovaError
            ? error.message
            : 'Check your Kova payments before trying again.'
        sendSmsLater(
          pocket.phone,
          `Kova: your payment of ${money(request.amount)} didn’t go through. ${why}`,
        )
      }
      throw error
    },
  )
  const answer = await Promise.race([
    job.then(
      (done) => ({ done }),
      (error: unknown) => ({ error }),
    ),
    new Promise<{ slow: true }>((resolve) =>
      setTimeout(() => resolve({ slow: true }), ANSWER_WITHIN_MS),
    ),
  ])
  answered = true
  if ('slow' in answer)
    return end(`Paying ${money(request.amount)}… You’ll get a text when it’s done.`)
  if ('error' in answer) {
    const message =
      answer.error instanceof KovaError
        ? answer.error.message
        : 'We couldn’t confirm the request. Check your Kova payments before trying again.'
    return end(message)
  }
  return answerFor(answer.done, request.kind)
}

function answerFor(done: Spend, kind: Spend['kind']): string {
  if (done.status === 'failed') return end('That payment didn’t go through, and nothing was paid.')
  if (done.status !== 'paid')
    return end(`Paying ${money(done.amount)}… You’ll get a text when it’s done.`)
  return end(
    `Paid ${money(done.amount)} to ${kind === 'phone' ? mask(done.toLabel) : done.toLabel}.\nRef ${done.reference}. A text is on its way.`,
  )
}

export const ussdCode = () => config.KOVA_USSD_CODE
