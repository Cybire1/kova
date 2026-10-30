import { ANDROID } from '@/lib/android'

/** mykova.app/android/download: always the latest APK, so shared links keep working. */
export function GET() {
  return Response.redirect(ANDROID.url, 302)
}
