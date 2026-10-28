import type { MetadataRoute } from 'next'

/**
 * Kova on the Home Screen: it opens on the wallet, full screen with no browser bars, as the app
 * does. Links to pay pages and stalls stay inside it (scope "/").
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/wallet',
    name: 'Kova',
    short_name: 'Kova',
    description: 'Your dollars, anywhere, in seconds.',
    start_url: '/wallet',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#E7E5E0',
    theme_color: '#E7E5E0',
    icons: [
      { src: '/icons/kova-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/kova-512.png', sizes: '512x512', type: 'image/png' },
      // The mark sits well inside the safe circle, so the same art serves as the maskable icon.
      { src: '/icons/kova-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
