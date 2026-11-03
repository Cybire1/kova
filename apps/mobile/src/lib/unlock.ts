import * as LocalAuthentication from 'expo-local-authentication'
import { useEffect, useState } from 'react'
import { Platform } from 'react-native'

/**
 * How this phone unlocks a Kova wallet, in the words its owner knows. The wallet is a passkey, but
 * nobody unlocks a passkey: they use Face ID, Touch ID, a fingerprint or face unlock, and the phone's
 * password manager keeps it. Screens say that instead.
 */
export interface Unlock {
  /** "Face ID", "Touch ID", "fingerprint", "face unlock". */
  name: string
  /** In a sentence: "Face ID", "Touch ID", "your fingerprint", "face unlock". */
  your: string
  /** For a button: "Continue with Face ID", "Continue with your fingerprint". */
  continueWith: string
  icon: 'face' | 'fingerprint'
  /** Where the phone keeps the wallet's key, so it comes back on the next phone. */
  keychain: string
  /** "One look", "One touch": how quick it is. */
  gesture: string
}

const ios = Platform.OS === 'ios'

const faceId: Unlock = {
  name: 'Face ID',
  your: 'Face ID',
  continueWith: 'Continue with Face ID',
  icon: 'face',
  keychain: 'iCloud Keychain',
  gesture: 'One look',
}
const touchId: Unlock = {
  ...faceId,
  name: 'Touch ID',
  continueWith: 'Continue with Touch ID',
  icon: 'fingerprint',
  gesture: 'One touch',
}
const fingerprint: Unlock = {
  name: 'fingerprint',
  your: 'your fingerprint',
  continueWith: 'Continue with your fingerprint',
  icon: 'fingerprint',
  keychain: 'Google Password Manager',
  gesture: 'One touch',
}
const faceUnlock: Unlock = {
  ...fingerprint,
  name: 'face unlock',
  continueWith: 'Continue with face unlock',
  icon: 'face',
  gesture: 'One look',
}

/** Before the phone answers: the most likely, so the first frame already reads right. */
export const likelyUnlock: Unlock = ios ? faceId : fingerprint

let known: Unlock | null = null

export async function readUnlock(): Promise<Unlock> {
  if (known) return known
  const types: LocalAuthentication.AuthenticationType[] =
    await LocalAuthentication.supportedAuthenticationTypesAsync().catch(() => [])
  const face = types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)
  const finger = types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)
  known = ios ? (finger && !face ? touchId : faceId) : face && !finger ? faceUnlock : fingerprint
  return known
}

export function useUnlock(): Unlock {
  const [unlock, setUnlock] = useState<Unlock>(known ?? likelyUnlock)
  useEffect(() => {
    void readUnlock().then(setUnlock)
  }, [])
  return unlock
}
