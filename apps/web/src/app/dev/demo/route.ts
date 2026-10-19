import { redirect } from 'next/navigation'
import { startSession } from '@/lib/session'

/**
 * Development only: /dev/demo?to=/dashboard/stalls signs into the demo shop and opens a page,
 * so screens can be checked (and screenshotted) without clicking through sign-in. Production
 * answers 404.
 */
export async function GET(request: Request) {
  if (process.env.NODE_ENV === 'production' || !process.env.DEMO_API_KEY)
    return new Response('Not found', { status: 404 })
  const to = new URL(request.url).searchParams.get('to') ?? '/dashboard'
  await startSession({ key: process.env.DEMO_API_KEY, demo: true })
  redirect(to.startsWith('/') && !to.startsWith('//') ? to : '/dashboard')
}
