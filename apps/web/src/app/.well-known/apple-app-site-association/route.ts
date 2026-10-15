/**
 * Tells iOS which apps this domain vouches for:
 * - webcredentials: Kova Pay may create and use passkeys for this domain. On Monad the wallet
 *   is a Mera passkey, so this file is what makes a wallet possible at all.
 * - applinks: scanning a shop's code (a /pay/… link), opening a stall (/s/…), someone's request
 *   (/to/…) or a payment made with no signal (/o#…) with the iPhone camera opens Kova Pay straight
 *   at it, when it's installed; without it, the page opens in the browser.
 *
 * Served as JSON with no redirect, as Apple requires.
 */
export const dynamic = 'force-static'

// Kova's Apple team (R38YN743Q6), and the team earlier builds were signed with, so both keep passkeys.
const list = (value: string) =>
  value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
const teams = list(process.env.APPLE_TEAM_ID ?? 'R38YN743Q6,5N8DU2A9WH')
const bundles = list(process.env.KOVA_IOS_BUNDLE_IDS ?? 'xyz.kova.pay.monad')
const apps = teams.flatMap((team) => bundles.map((bundle) => `${team}.${bundle}`))

export function GET() {
  return Response.json({
    webcredentials: { apps },
    applinks: {
      details: [
        {
          appIDs: apps,
          components: [
            { '/': '/pay/*' },
            { '/': '/s/*' },
            { '/': '/to/*' },
            { '/': '/o' },
            { '/': '/a/*' },
          ],
        },
      ],
    },
  })
}
