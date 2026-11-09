/**
 * What a team wallet signs to open Kova's dashboard: which wallet, which site and when. The site
 * checks all three, so a signature is good only here and only for a few minutes.
 */
export const adminMessage = (address: string, site: string, signedAt: number) =>
  `Open Kova’s dashboard\n\nWallet: ${address}\nSite: ${site}\nSigned at: ${signedAt}`
