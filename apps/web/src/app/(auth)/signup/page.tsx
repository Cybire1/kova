import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { signInDemo } from '@/app/actions'
import { Pill } from '@/components/brand'
import { getSession } from '@/lib/session'

export const metadata: Metadata = { title: 'Open a shop' }

/**
 * Shops open inside the Kova app now: the wallet first, then the shop it owns. This page says how,
 * in the same frame as signing in, and sends you on to the wallet to do it.
 */
export default async function SignUpPage() {
  if (await getSession()) redirect('/dashboard')
  return (
    <div className="auth-card">
      <h1>Open your shop</h1>
      <p className="auth-lead">
        It lives in your Kova wallet: sales land there in about a second, and your passkey opens
        both.
      </p>
      <ol className="steps signup-steps">
        <li>Open your Kova wallet, or make one with a passkey</li>
        <li>Give your shop a name</li>
        <li>Take your first payment, on any phone</li>
      </ol>
      <Pill href="/wallet/shop?go=open" icon="arrow" tone="coral" wide>
        Open a shop, free
      </Pill>
      <div className="auth-or">
        <span>or</span>
      </div>
      <form action={signInDemo}>
        <Pill type="submit" icon="tap" tone="light" wide>
          Explore the demo shop
        </Pill>
      </form>
      <p className="auth-switch">
        Have a shop? <Link href="/signin">Sign in</Link>
      </p>
    </div>
  )
}
