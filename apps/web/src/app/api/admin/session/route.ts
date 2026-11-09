import { getAddress, isAddress, verifyMessage } from 'viem'
import { dashboardReady, endAdmin, isTeam, startAdmin } from '@/lib/admin'
import { adminMessage } from '@/lib/admin-message'

/**
 * Opens Kova's dashboard for a team wallet: it signs which wallet, this site and the time, and the
 * signature must be this wallet's and under five minutes old. DELETE signs the dashboard out.
 */
export async function POST(request: Request) {
  if (!dashboardReady())
    return Response.json({ error: 'The dashboard isn’t set up on this server.' }, { status: 503 })
  const body = (await request.json().catch(() => ({}))) as {
    address?: string
    signed_at?: number
    signature?: string
  }
  const { address, signed_at: signedAt, signature } = body
  if (
    !address ||
    !isAddress(address, { strict: false }) ||
    typeof signedAt !== 'number' ||
    !/^0x[0-9a-fA-F]+$/.test(signature ?? '')
  )
    return Response.json({ error: 'Sign in from your wallet again.' }, { status: 400 })
  if (!isTeam(address))
    return Response.json({ error: 'This wallet isn’t on Kova’s team list.' }, { status: 403 })
  if (Math.abs(Date.now() / 1000 - signedAt) > 300)
    return Response.json({ error: 'That signature is too old. Try again.' }, { status: 400 })
  const site = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? ''
  const valid = await verifyMessage({
    address: getAddress(address),
    message: adminMessage(getAddress(address), site, signedAt),
    signature: signature as `0x${string}`,
  }).catch(() => false)
  if (!valid)
    return Response.json({ error: 'That signature isn’t this wallet’s.' }, { status: 403 })
  await startAdmin(address)
  return Response.json({ ok: true })
}

export async function DELETE() {
  await endAdmin()
  return Response.json({ ok: true })
}
