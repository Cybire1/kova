import type { Metadata, Viewport } from 'next'
import { GoogleWalletProvider } from '@/components/google-wallet-provider'
import { network } from '@/lib/network'
import { BAR, THEME_SCRIPT } from '@/lib/theme'
import './globals.css'
import '../styles/app.css'
import '../styles/auth.css'
import '../styles/landing.css'
import '../styles/stalls.css'
import '../styles/takings.css'
import '../styles/wallet.css'
import '../styles/offline.css'

const DESCRIPTION =
  'Your dollars, anywhere, in seconds. A wallet that opens with a passkey, with your shop inside it. On Monad.'

/**
 * The iPhone launch screens (public/splash), one per shape: the icon on cream, or on black when the
 * phone is dark. [image width, height, device width, height, pixel ratio].
 */
const SPLASH = [
  [1320, 2868, 440, 956, 3],
  [1206, 2622, 402, 874, 3],
  [1290, 2796, 430, 932, 3],
  [1179, 2556, 393, 852, 3],
  [1284, 2778, 428, 926, 3],
  [1170, 2532, 390, 844, 3],
  [1125, 2436, 375, 812, 3],
  [1242, 2688, 414, 896, 3],
  [828, 1792, 414, 896, 2],
  [750, 1334, 375, 667, 2],
] as const

/** The preview card (app/opengraph-image.png) is drawn from the Kovi film: film/src/OgCard.tsx. */
export const metadata: Metadata = {
  metadataBase: new URL('https://mykova.app'),
  title: { default: 'Kova', template: '%s · Kova' },
  description: DESCRIPTION,
  openGraph: {
    siteName: 'Kova',
    type: 'website',
    title: 'Kova · Tap. Paid. Anywhere.',
    description: DESCRIPTION,
  },
  twitter: {
    card: 'summary_large_image',
    site: '@kovafinance',
    title: 'Kova · Tap. Paid. Anywhere.',
    description: DESCRIPTION,
  },
  // Added to an iPhone's Home Screen, Kova opens full screen like an app (app/manifest.ts), on
  // its own launch screen (SPLASH) rather than white.
  appleWebApp: {
    capable: true,
    title: 'Kova',
    statusBarStyle: 'default',
    startupImage: SPLASH.flatMap(([w, h, dw, dh, ratio]) => {
      const media = `(device-width: ${dw}px) and (device-height: ${dh}px) and (-webkit-device-pixel-ratio: ${ratio}) and (orientation: portrait)`
      return [
        { url: `/splash/kova-${w}x${h}-light.png`, media },
        // After the light one, so a phone that can't tell dark from light still gets cream.
        {
          url: `/splash/kova-${w}x${h}-dark.png`,
          media: `${media} and (prefers-color-scheme: dark)`,
        },
      ]
    }),
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: BAR.light,
  // Edge to edge on the Home Screen; the dock and sheets keep clear of the home bar themselves.
  viewportFit: 'cover',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* The wallet's theme, set before the first paint so a dark page never flashes light
            (lib/theme.ts). */}
        <script
          // biome-ignore lint/security/noDangerouslySetInnerHtml: a fixed script, no input in it
          dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }}
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <GoogleWalletProvider appId={process.env.PRIVY_APP_ID ?? null} network={network}>
          {children}
        </GoogleWalletProvider>
      </body>
    </html>
  )
}
