import * as SecureStore from 'expo-secure-store'

/** Someone this phone cashed out to in naira before. Kept on the phone only, never sent anywhere. */
export interface NairaRecent {
  name: string
  bankCode: string
  bankName: string
  accountNumber: string
  logo?: string | null
}

export const NAIRA_RECENTS = 'kova.naira.recents.v1'

/** The last few naira accounts, newest first; none when the phone has none or can't read them. */
export async function loadNairaRecents(): Promise<NairaRecent[]> {
  try {
    const raw = await SecureStore.getItemAsync(NAIRA_RECENTS)
    const list = raw ? (JSON.parse(raw) as NairaRecent[]) : []
    return Array.isArray(list) ? list.slice(0, 5) : []
  } catch {
    return []
  }
}

/** How Cash out names one in a list, and passes it to the naira screen: "058:0123456789". */
export const recentKey = (r: Pick<NairaRecent, 'bankCode' | 'accountNumber'>) =>
  `${r.bankCode}:${r.accountNumber}`
