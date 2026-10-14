import { redirect } from 'next/navigation'

/** The iPhone beta's first address: the waitlist lives at /waitlist now. */
export default function IphonePage() {
  redirect('/waitlist')
}
