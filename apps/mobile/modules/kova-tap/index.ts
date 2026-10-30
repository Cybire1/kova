import { requireOptionalNativeModule } from 'expo'
import { Platform } from 'react-native'

/**
 * Tap a phone to pay (Android tills only). While a charge is on screen, the till answers an NFC
 * tap as a tag holding the charge's pay link; the customer's phone opens it and they approve the
 * payment there. iPhones can't answer taps like this (Apple keeps that to Europe), so on iPhone
 * every function here does nothing and `tapToPhoneSupported` is false.
 */
interface KovaTapNative {
  isSupported(): boolean
  setLink(url: string | null): void
  addListener(event: 'onRead', listener: () => void): { remove(): void }
}

const native =
  Platform.OS === 'android' ? requireOptionalNativeModule<KovaTapNative>('KovaTap') : null

export function tapToPhoneSupported(): boolean {
  try {
    return native?.isSupported() ?? false
  } catch {
    return false
  }
}

/** Offer `url` to the next phone that taps; null stops offering it. */
export function offerTapLink(url: string | null) {
  try {
    native?.setLink(url)
  } catch {
    // No tap to pay on this phone; the QR code still works.
  }
}

/** Called when a phone has read the link. */
export function onPhoneTapped(listener: () => void): { remove(): void } {
  return native?.addListener('onRead', listener) ?? { remove() {} }
}
