import type { Metadata, Viewport } from 'next'
import './globals.css'
import '../styles/app.css'
import '../styles/auth.css'
import '../styles/landing.css'
import '../styles/stalls.css'
import '../styles/takings.css'
import '../styles/wallet.css'

const DESCRIPTION = 'Your dollars, anywhere, in seconds. A wallet that opens with a passkey, with your shop inside it. On Monad.'

/** The preview card (app/opengraph-image.png) is drawn from the Kovi film: film/src/OgCard.tsx. */
export const metadata: Metadata = {
  metadataBase: new URL('https://mykova.app'),
  title: { default: 'Kova', template: '%s · Kova' },
  description: DESCRIPTION,
  openGraph: { siteName: 'Kova', type: 'website', title: 'Kova · Tap. Paid. Anywhere.', description: DESCRIPTION },
  twitter: { card: 'summary_large_image', site: '@kovafinance', title: 'Kova · Tap. Paid. Anywhere.', description: DESCRIPTION },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#E7E5E0',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  )
}
