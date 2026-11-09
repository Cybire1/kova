import { parsePhoneNumberFromString } from 'libphonenumber-js'

/**
 * A phone number as card issuers want it, E.164: "+234 0803 123 4567" → "+2348031234567". People
 * often keep the leading 0 after the country code; Nuvion's API takes that, but the card provider
 * behind it refuses the card. Null when it can't be a real number.
 */
export function e164(phone: string): string | null {
  const parsed = parsePhoneNumberFromString(phone.replace(/[\s().-]/g, ''))
  return parsed?.isValid() ? parsed.number : null
}

/** An email as it's kept and sent on: no spaces around it, lower case. */
export const cleanEmail = (email: string) => email.trim().toLowerCase()
