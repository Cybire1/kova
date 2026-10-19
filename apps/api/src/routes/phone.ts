import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { isAddress, type Address, type Hex } from 'viem'
import { z } from 'zod'
import { network } from '../chain.js'
import { config } from '../config.js'
import { KovaError, errorHandler } from '../errors.js'
import { clientIp, limit } from '../limits.js'
import {
  checkPhoneApproval,
  checkedPhone,
  confirmPhoneFunding,
  finishPhonePayment,
  invitePhoneRecipient,
  phonePayment,
  phonePaymentDestination,
  phonePaymentsReady,
  reconcilePhonePayment,
  requestPhoneCode,
  requirePhonePayments,
  reservePhonePayment,
  serializePhonePayment,
  verifyPhoneCode,
} from '../services/phone-payments.js'

const approval = z.object({
  action: z.enum(['resolve', 'reserve', 'confirm', 'otp', 'verify', 'claim', 'return', 'resend']),
  chainId: z.number().int(),
  wallet: z.string().refine(isAddress),
  signedAt: z.number().int(),
  signature: z.string().regex(/^0x[\da-fA-F]{130}$/),
  id: z
    .string()
    .regex(/^lnk_[a-z0-9]{26}$/)
    .optional(),
  phone: z.string().max(20).optional(),
  address: z.string().refine(isAddress).optional(),
  amount: z
    .string()
    .regex(/^\d{1,3}(\.\d{1,2})?$/)
    .optional(),
  // Checked against the signature exactly as signed; trimmed and shortened only after that.
  name: z.string().max(200).optional(),
  note: z.string().max(140).optional(),
  key: z
    .string()
    .regex(/^0x[\da-fA-F]{64}$/)
    .optional(),
  code: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
})
export const phoneRoutes = new Hono()
  .onError((error, c) => {
    if (error instanceof KovaError) return errorHandler(error, c)
    console.error('[phone] Request failed; sensitive request details omitted.')
    return errorHandler(
      new KovaError(
        'internal',
        'Couldn’t complete this request. Check the payment before trying again.',
      ),
      c,
    )
  })
  .use('/phone/*', bodyLimit({ maxSize: 4096 }))
  .get('/phone/info', (c) =>
    c.json({
      enabled: phonePaymentsReady(),
      network: config.KOVA_NETWORK,
      mode: config.AT_USERNAME === 'sandbox' ? 'sandbox' : 'live',
    }),
  )
  .get('/phone/payments/:id', async (c) => {
    const row = await reconcilePhonePayment(
      await confirmPhoneFunding(await phonePayment(c.req.param('id'))),
    )
    return c.json(serializePhonePayment(row))
  })
  .post('/phone/:action', async (c) => {
    limit(`phone-ip:${clientIp(c)}`, 60, 60_000, 'Wait a moment before trying again.')
    const parsed = approval.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success || parsed.data.action !== c.req.param('action'))
      throw new KovaError('invalid_request', 'Invalid phone payment approval.')
    const signed = parsed.data
    await checkPhoneApproval(
      {
        ...signed,
        wallet: signed.wallet as Address,
        address: signed.address as Address | undefined,
      },
      signed.signature as Hex,
    )
    const p = { ...signed, name: signed.name?.trim().slice(0, 60), note: signed.note?.trim() }
    limit(`phone-owner:${p.wallet.toLowerCase()}`, 60, 60_000, 'Wait a moment before trying again.')
    if (p.action === 'resolve') {
      requirePhonePayments()
      return c.json(await phonePaymentDestination(checkedPhone(p.phone)))
    }
    if (p.action === 'reserve') {
      if (!p.key || !p.amount || !p.address)
        throw new KovaError('invalid_request', 'Missing phone payment details.')
      return c.json(
        serializePhonePayment(
          await reservePhonePayment(
            { ...p, wallet: p.wallet as Address, address: p.address as Address },
            p.key as Hex,
          ),
        ),
      )
    }
    if (!p.id) throw new KovaError('invalid_request', 'Choose a phone payment.')
    const row = await phonePayment(p.id)
    const owner = row.senderAddress === p.wallet.toLowerCase()
    if (['confirm', 'resend', 'return'].includes(p.action) && !owner)
      throw new KovaError('forbidden', 'Only the sender can manage this payment.')
    if (p.action === 'confirm' || p.action === 'resend') {
      let funded = await confirmPhoneFunding(row)
      // SMS rejection never hides a funded payment or causes a second funding transaction.
      try {
        funded = await invitePhoneRecipient(funded, p.action === 'resend')
      } catch {
        /* Sender can resend from the payment screen. */
      }
      return c.json(serializePhonePayment(funded))
    }
    if (p.action === 'otp') {
      // Only a caller who knows this payment's number counts against that number's limit.
      const phone = checkedPhone(p.phone)
      if (phone !== row.recipientPhone)
        throw new KovaError(
          'invalid_request',
          'Check the phone number and whether this payment is still waiting.',
        )
      limit(
        `phone-code-wallet:${p.wallet.toLowerCase()}`,
        3,
        600_000,
        'Too many code requests. Try again in 10 minutes.',
      )
      limit(
        `phone-code:${row.recipientPhone}`,
        3,
        600_000,
        'Too many code requests. Try again in 10 minutes.',
      )
      await requestPhoneCode(row, p.wallet as Address, phone)
      return c.json({ sent: true })
    }
    if (p.action === 'verify') {
      if (!p.code) throw new KovaError('invalid_request', 'Enter the verification code.')
      await verifyPhoneCode(row, p.wallet as Address, checkedPhone(p.phone), p.code)
      return c.json({ verified: true })
    }
    const result = await finishPhonePayment(row, p.wallet as Address, p.action === 'return')
    return c.json({ ...serializePhonePayment(result), chain_id: network.chainId })
  })
