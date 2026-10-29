import { pruneReport, pruneTransfers } from '../workers/prune.js'

/**
 * How many old transfers between strangers a prune would remove (workers/prune.ts), and with
 * --yes, removes them now. Read-only without --yes.
 *
 *   pnpm --filter @kova/api prune:transfers          # the count
 *   pnpm --filter @kova/api prune:transfers --yes    # remove them
 */
const report = await pruneReport()
console.log(
  `transfers: ${report.total.toLocaleString()} rows, ${report.size}. Old transfers between strangers: ${report.remove.toLocaleString()}.`,
)
if (process.argv.includes('--yes')) {
  const removed = await pruneTransfers()
  console.log(`removed ${removed.toLocaleString()} rows`)
}
process.exit(0)
