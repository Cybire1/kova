// Render stills of the xStocks v2 film from one bundle:
//   node scripts/xstocks2/stills.mjs <outDir> <scale> <frame...>
import { bundle } from '@remotion/bundler'
import { renderStill, selectComposition } from '@remotion/renderer'

const [outDir, scale, ...frames] = process.argv.slice(2)
const serveUrl = await bundle({ entryPoint: 'src/xstocks3/index.tsx' })
const composition = await selectComposition({ serveUrl, id: 'XStocks3', port: 3071 })
for (const f of frames) {
  const output = `${outDir}/f${String(f).padStart(3, '0')}.png`
  await renderStill({ serveUrl, composition, frame: Number(f), output, scale: Number(scale), port: 3071 })
}
console.log('done', frames.length)
