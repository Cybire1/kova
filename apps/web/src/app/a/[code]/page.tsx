import { redirect } from 'next/navigation'

/** An allowance's or budget's invite link: opened in the wallet, where it's accepted. */
export default async function InviteLink({ params }: { params: Promise<{ code: string }> }) {
  const code = (await params).code
  redirect(`/wallet/keys/accept/${/^[A-Za-z0-9_-]{8,64}$/.test(code) ? code : 'invalid'}`)
}
