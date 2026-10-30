/**
 * Tells Android which apps this domain vouches for (Digital Asset Links), the Android twin of
 * apple-app-site-association:
 * - get_login_creds: Kova for Android may create and use passkeys for mykova.app. The wallet is a
 *   passkey, so without this no wallet can be made on Android.
 * - handle_all_urls: a shop's code (/pay/…), a stall (/s/…), a request (/to/…), an offline payment
 *   (/o) or a claim link (/a/…) opens the app straight at it, when it's installed.
 *
 * The fingerprints are the SHA-256 of each certificate the app is signed with: Kova's own upload
 * key (the downloadable build) and, once it's on Google Play, Play's app-signing key.
 */
export const dynamic = 'force-static'

const list = (value: string) =>
  value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
const packages = list(process.env.KOVA_ANDROID_PACKAGES ?? 'xyz.kova.pay.monad')
const fingerprints = list(
  process.env.KOVA_ANDROID_CERT_SHA256 ??
    '1D:93:56:FF:4C:60:32:AB:79:D0:39:FC:FD:8F:C9:19:D0:21:8E:C7:82:E0:92:4C:76:E1:1A:26:FD:57:2D:F0',
)

export function GET() {
  return Response.json(
    packages.map((package_name) => ({
      relation: [
        'delegate_permission/common.handle_all_urls',
        'delegate_permission/common.get_login_creds',
      ],
      target: { namespace: 'android_app', package_name, sha256_cert_fingerprints: fingerprints },
    })),
  )
}
