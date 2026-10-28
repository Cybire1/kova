/**
 * Nigerian banks, for cashing out to naira: which banks an account number could belong to, so a
 * person types the number first and picks from a few likely banks instead of a list of hundreds.
 *
 * Two signals, as Nigerian banking apps use them:
 *
 * - **NUBAN check digit.** A commercial bank's 10-digit account number ends in a check digit over
 *   its CBN bank code and the first nine digits (CBN, NUBAN standard: weights 3, 7, 3 repeating;
 *   10 minus the sum mod 10). A number "fits" a bank when its last digit matches. Several banks can
 *   fit the same number, so this narrows the list; the bank still confirms the name.
 * - **Phone-number accounts.** OPay, PalmPay, Moniepoint and Kuda give out account numbers made from
 *   the owner's phone number, which the check digit can't place. A number that looks like a
 *   Nigerian mobile number (70…, 80…, 81…, 90…, 91…) puts them first.
 *
 * Bank codes here are NIBSS transfer (NIP) codes, the ones PAJ's bank list uses.
 */

export interface SuggestableBank {
  name: string
  code: string
  logo?: string | null
}

export type SuggestionReason = 'phone' | 'fits' | 'popular'

export interface BankSuggestion<B extends SuggestableBank = SuggestableBank> {
  bank: B
  reason: SuggestionReason
}

/** NIP code → CBN bank code, for the commercial banks whose account numbers carry a NUBAN check digit. */
export const NUBAN_BANKS: Record<string, string> = {
  '000001': '232', // Sterling Bank
  '000002': '082', // Keystone Bank
  '000003': '214', // FCMB
  '000004': '033', // United Bank for Africa
  '000006': '301', // Jaiz Bank
  '000007': '070', // Fidelity Bank
  '000008': '076', // Polaris Bank
  '000009': '023', // Citibank
  '000010': '050', // Ecobank
  '000011': '215', // Unity Bank
  '000012': '221', // Stanbic IBTC
  '000013': '058', // Guaranty Trust Bank
  '000014': '044', // Access Bank
  '000015': '057', // Zenith Bank
  '000016': '011', // First Bank
  '000017': '035', // Wema Bank
  '000018': '032', // Union Bank
  '000020': '030', // Heritage Bank
  '000021': '068', // Standard Chartered
  '000022': '100', // SunTrust Bank
  '000023': '101', // Providus Bank
}

/** Accounts made from a phone number: OPay, PalmPay, Moniepoint, Kuda. */
export const PHONE_ACCOUNT_BANKS = ['100004', '100033', '090405', '090267']

/** The banks most people send to, in that order: offered when nothing narrows it further. */
export const POPULAR_BANKS = [
  '100004', // OPay
  '090405', // Moniepoint
  '100033', // PalmPay
  '090267', // Kuda
  '000013', // GTBank
  '000014', // Access Bank
  '000015', // Zenith Bank
  '000016', // First Bank
  '000004', // UBA
]

const WEIGHTS = [3, 7, 3]

/** The NUBAN check digit for a CBN bank code and the first nine digits of an account number. */
export function nubanCheckDigit(cbnCode: string, serial: string): number {
  // The 2020 standard pads the bank code to six digits; leading zeros add nothing to the sum.
  const seed = (cbnCode.padStart(6, '0') + serial).split('').map(Number)
  const sum = seed.reduce((total, digit, i) => total + digit * (WEIGHTS[i % 3] as number), 0)
  return (10 - (sum % 10)) % 10
}

/** Whether a 10-digit account number carries the right check digit for this CBN bank code. */
export function nubanFits(accountNumber: string, cbnCode: string): boolean {
  if (!/^\d{10}$/.test(accountNumber)) return false
  return nubanCheckDigit(cbnCode, accountNumber.slice(0, 9)) === Number(accountNumber[9])
}

/** Looks like a Nigerian mobile number without its leading 0: 70…, 80…, 81…, 90…, 91…. */
export const looksLikePhoneNumber = (accountNumber: string) =>
  /^(70|71|80|81|90|91)\d{8}$/.test(accountNumber)

/**
 * The banks this account number most likely belongs to, best first: phone-number banks when it
 * looks like a phone number, then every commercial bank whose check digit it fits (most-used
 * first), then popular banks to fill up to `max`. Banks missing from `banks` are skipped.
 */
export function suggestBanks<B extends SuggestableBank>(
  accountNumber: string,
  banks: B[],
  max = 5,
): BankSuggestion<B>[] {
  if (!/^\d{10}$/.test(accountNumber)) return []
  const byCode = new Map(banks.map((b) => [b.code, b]))
  const out: BankSuggestion<B>[] = []
  const add = (code: string, reason: SuggestionReason) => {
    const bank = byCode.get(code)
    if (bank && !out.some((s) => s.bank.code === code)) out.push({ bank, reason })
  }
  const phone = looksLikePhoneNumber(accountNumber)
  if (phone) for (const code of PHONE_ACCOUNT_BANKS) add(code, 'phone')
  const fits = Object.entries(NUBAN_BANKS)
    .filter(([, cbn]) => nubanFits(accountNumber, cbn))
    .map(([code]) => code)
    .sort((a, b) => rank(a) - rank(b))
  for (const code of fits) add(code, 'fits')
  for (const code of POPULAR_BANKS) if (out.length < max) add(code, 'popular')
  return out.slice(0, max)
}

/** Most-used banks first, then everything else in its NIP order. */
function rank(code: string): number {
  const i = POPULAR_BANKS.indexOf(code)
  return i === -1 ? 100 + Number(code) : i
}

/** The names people use for the banks most people send to. */
const SHORT_NAMES: Record<string, string> = {
  '100004': 'OPay',
  '100033': 'PalmPay',
  '090405': 'Moniepoint',
  '090267': 'Kuda',
  '000013': 'GTBank',
  '000014': 'Access Bank',
  '000015': 'Zenith Bank',
  '000016': 'First Bank',
  '000004': 'UBA',
  '000010': 'Ecobank',
  '000003': 'FCMB',
  '000007': 'Fidelity Bank',
  '000006': 'Jaiz Bank',
  '000002': 'Keystone Bank',
  '000008': 'Polaris Bank',
  '000023': 'Providus Bank',
  '000012': 'Stanbic IBTC',
  '000001': 'Sterling Bank',
  '000018': 'Union Bank',
  '000017': 'Wema Bank',
  '000011': 'Unity Bank',
}

/** A bank's name as people say it: the short name for well-known banks, else its name tidied up. */
export function bankDisplayName(bank: { code: string; name: string }): string {
  const short = SHORT_NAMES[bank.code]
  if (short) return short
  return bank.name
    .trim()
    .replace(/\s+(PLC|LIMITED|LTD)\.?$/i, '')
    .toLowerCase()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase())
    .replace(/\bMfb\b/g, 'MFB')
}
