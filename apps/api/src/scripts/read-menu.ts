/**
 * Reads one menu photo the way "Snap your menu" does, with whichever service is configured
 * (Anthropic or DeepSeek), and prints what it found:
 *   pnpm menu:read ./menu.jpg
 */
import { readFile } from 'node:fs/promises'
import { menuImportReady, readMenu } from '../services/menu-import.js'

async function main() {
  const [path] = process.argv.slice(2)
  if (!path) throw new Error('usage: menu:read <photo.jpg|png|webp>')
  if (!menuImportReady()) throw new Error('Set ANTHROPIC_API_KEY or DEEPSEEK_API_KEY first')
  const bytes = await readFile(path)
  const mediaType = path.endsWith('.png')
    ? 'image/png'
    : path.endsWith('.webp')
      ? 'image/webp'
      : 'image/jpeg'
  const started = Date.now()
  const menu = await readMenu({ data: bytes.toString('base64'), mediaType })
  console.log(`read in ${Date.now() - started}ms, priced in ${menu.currency}`)
  for (const item of menu.items)
    console.log(
      `  ${item.name.padEnd(32)} $${item.price.padStart(6)}   (${item.original.amount} ${item.original.currency})`,
    )
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
