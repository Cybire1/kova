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
  // Added to an iPhone's Home Screen, Kova opens full screen like an app (app/manifest.ts).
  appleWebApp: { capable: true, title: 'Kova', statusBarStyle: 'default' },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#E7E5E0',
  // Edge to edge on the Home Screen; the dock and sheets keep clear of the home bar themselves.
  viewportFit: 'cover',
}

/**
 * The theme, set before the first paint so a dark page never flashes light. Dark is opt-in while
 * every screen is checked in it: ?theme=dark turns it on for this browser, ?theme=light off.
 */
const THEME = `try{var q=new URLSearchParams(location.search).get('theme');if(q==='dark'||q==='light')localStorage.setItem('kova.theme',q);if(localStorage.getItem('kova.theme')==='dark')document.documentElement.dataset.theme='dark'}catch(e){}`

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
