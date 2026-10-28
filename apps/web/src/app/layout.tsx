import type { Metadata, Viewport } from 'next'
import { GoogleWalletProvider } from '@/components/google-wallet-provider'
import { network } from '@/lib/network'
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
  // its own launch screen (public/splash: the icon on cream, one per iPhone shape) rather than white.
  appleWebApp: {
    capable: true,
    title: 'Kova',
    statusBarStyle: 'default',
    startupImage: [
      {
        url: '/splash/kova-1320x2868-light.png',
        media: `(device-width: 440px) and (device-height: 956px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)`,
      },
      {
        url: '/splash/kova-1206x2622-light.png',
        media: `(device-width: 402px) and (device-height: 874px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)`,
      },
      {
        url: '/splash/kova-1290x2796-light.png',
        media: `(device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)`,
      },
      {
        url: '/splash/kova-1179x2556-light.png',
        media: `(device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)`,
      },
      {
        url: '/splash/kova-1284x2778-light.png',
        media: `(device-width: 428px) and (device-height: 926px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)`,
      },
      {
        url: '/splash/kova-1170x2532-light.png',
        media: `(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)`,
      },
      {
        url: '/splash/kova-1125x2436-light.png',
        media: `(device-width: 375px) and (device-height: 812px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)`,
      },
      {
        url: '/splash/kova-1242x2688-light.png',
        media: `(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)`,
      },
      {
        url: '/splash/kova-828x1792-light.png',
        media: `(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)`,
      },
      {
        url: '/splash/kova-750x1334-light.png',
        media: `(device-width: 375px) and (device-height: 667px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)`,
      },
    ],
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#E7E5E0',
  // Edge to edge on the Home Screen; the dock and sheets keep clear of the home bar themselves.
  viewportFit: 'cover',
}

/**
 * The theme, set before the first paint so a dark page never flashes light, with the browser's and
 * the phone's top bar in the page's colour (theme-color: cream, or black in the dark). Dark is
 * opt-in while every screen is checked in it: ?theme=dark turns it on for this browser, ?theme=light
 * off.
 */
const THEME = `try{var q=new URLSearchParams(location.search).get('theme');if(q==='dark'||q==='light')localStorage.setItem('kova.theme',q);if(localStorage.getItem('kova.theme')==='dark'){document.documentElement.dataset.theme='dark';var bar=function(){var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute('content','#000000')};bar();document.addEventListener('DOMContentLoaded',bar)}}catch(e){}`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          // biome-ignore lint/security/noDangerouslySetInnerHtml: a fixed script, no input in it
          dangerouslySetInnerHTML={{ __html: THEME }}
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
