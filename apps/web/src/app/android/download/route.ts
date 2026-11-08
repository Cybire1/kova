import { ANDROID } from '@/lib/android'

export const dynamic = 'force-dynamic'

/** Whether GitHub is serving the APK right now, asked at most every five minutes. */
let checked: { ok: boolean; at: number } | null = null

async function githubServes(): Promise<boolean> {
  if (checked && Date.now() - checked.at < 5 * 60_000) return checked.ok
  const ok = await fetch(ANDROID.url, {
    headers: { range: 'bytes=0-0' },
    redirect: 'follow',
    signal: AbortSignal.timeout(4_000),
  })
    .then((r) => r.status === 206 || r.status === 200)
    .catch(() => false)
  checked = { ok, at: Date.now() }
  return ok
}

/**
 * mykova.app/android/download: always the latest APK, so shared links keep working. From Kova's
 * GitHub release, or from Expo's copy of the same file when GitHub can't serve it (the checksum on
 * /android is the same either way).
 */
export async function GET() {
  const url = (await githubServes()) ? ANDROID.url : ANDROID.mirror
  return Response.redirect(url, 302)
}
