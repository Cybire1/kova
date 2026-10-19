import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { SignInForm } from '@/components/auth-forms'
import { network } from '@/lib/network'
import { getSession } from '@/lib/session'

export const metadata: Metadata = { title: 'Sign in' }

export default async function SignInPage(props: {
  searchParams: Promise<{ expired?: string; demo?: string }>
}) {
  const params = await props.searchParams
  if (!params.expired && (await getSession())) redirect('/dashboard')
  const notice = params.expired
    ? 'You were signed out. Sign in again to carry on.'
    : params.demo === 'off'
      ? 'The demo shop isn’t available right now.'
      : undefined
  // Read at request time, so the Privy app can be set on the server without rebuilding the site.
  return (
    <SignInForm
      notice={notice}
      privyAppId={process.env.PRIVY_APP_ID ?? null}
      chainId={network === 'mainnet' ? 143 : 10143}
    />
  )
}
