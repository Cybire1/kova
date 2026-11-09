'use server'

import { redirect } from 'next/navigation'
import { endAdmin } from '@/lib/admin'

/** Closes the dashboard on this browser. */
export async function signOut() {
  await endAdmin()
  redirect('/admin')
}
