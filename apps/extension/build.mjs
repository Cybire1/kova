// Builds Kova for Chrome into dist/ (load it unpacked from chrome://extensions) and a zip.
// Defaults to Kova on Monad mainnet; for the test network and a local mykova.app:
//   KOVA_NETWORK=testnet KOVA_WEB=http://localhost:3014 node build.mjs
// For the Chrome Web Store, `--store`: the manifest's `key` (which fixes the unpacked ID) is left
// out, since the store refuses it and assigns its own ID; add that ID to the web app's
// NEXT_PUBLIC_KOVA_EXTENSION_IDS. `--watch` rebuilds on every change.
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'

const here = dirname(fileURLToPath(import.meta.url))
const out = join(here, 'dist')
const watch = process.argv.includes('--watch')
const store = process.argv.includes('--store')

const network = process.env.KOVA_NETWORK === 'testnet' ? 'testnet' : 'mainnet'
const web = (
  process.env.KOVA_WEB ?? (network === 'mainnet' ? 'https://mykova.app' : 'https://test.mykova.app')
).replace(/\/$/, '')
const api = (
  process.env.KOVA_API ??
  (network === 'mainnet'
    ? 'https://api-monad-mainnet.up.railway.app'
    : 'https://api-monad.up.railway.app')
).replace(/\/$/, '')

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
cpSync(join(here, 'public'), out, { recursive: true })

const webUrl = new URL(web)
const manifest = JSON.parse(readFileSync(join(here, 'manifest.json'), 'utf8'))
// externally_connectable takes no port: localhost:3014 is matched as localhost.
manifest.externally_connectable.matches = [`${webUrl.protocol}//${webUrl.hostname}/*`]
if (network !== 'mainnet') manifest.name = 'Kova (test network)'
if (store) delete manifest.key
writeFileSync(join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)

const options = {
  bundle: true,
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  target: 'chrome116',
  legalComments: 'none',
  logLevel: 'info',
  outdir: out,
  define: {
    __KOVA_NETWORK__: JSON.stringify(network),
    __KOVA_WEB__: JSON.stringify(web),
    __KOVA_API__: JSON.stringify(api),
    'process.env.NODE_ENV': JSON.stringify(watch ? 'development' : 'production'),
  },
  loader: { '.ttf': 'file', '.webp': 'file' },
  // The fonts and images are copied from public/ as they are.
  external: ['fonts/*', 'img/*'],
}

const entries = [
  { in: 'src/background/index.ts', out: 'background', format: 'esm' },
  { in: 'src/content/inpage.ts', out: 'inpage', format: 'iife' },
  { in: 'src/content/bridge.ts', out: 'bridge', format: 'iife' },
  { in: 'src/ui/popup.tsx', out: 'popup', format: 'iife' },
  { in: 'src/ui/prompt.tsx', out: 'prompt', format: 'iife' },
]

const contexts = await Promise.all(
  entries.map((e) =>
    esbuild.context({
      ...options,
      entryPoints: { [e.out]: join(here, e.in) },
      format: e.format,
      jsx: 'automatic',
    }),
  ),
)

if (watch) {
  await Promise.all(contexts.map((c) => c.watch()))
  console.log(`Watching. ${network} · ${web} · ${api}`)
} else {
  await Promise.all(contexts.map((c) => c.rebuild()))
  await Promise.all(contexts.map((c) => c.dispose()))
  const zip = join(
    here,
    `kova-chrome-${manifest.version}${network === 'mainnet' ? '' : '-testnet'}${store ? '-store' : ''}.zip`,
  )
  rmSync(zip, { force: true })
  execFileSync('zip', ['-qr', zip, '.'], { cwd: out })
  console.log(
    `Built dist/ and ${zip.split('/').pop()} · ${network} · ${web} · ${api}${store ? ' · for the Chrome Web Store' : ''}`,
  )
}
