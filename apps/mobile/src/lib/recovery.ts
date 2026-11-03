import { entropyToMnemonic, mnemonicToEntropy, validateMnemonic } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english.js'

/**
 * Recovery words: the passkey's 32-byte secret written as 24 BIP-39 words. It is the wallet's seed
 * (keys.ts derives the account from it), so the words bring back the same wallet with or without
 * the passkey, in Kova or in any wallet app that takes a 24-word phrase.
 */

export const WORD_COUNT = 24

/** The 24 words for this secret. */
export function wordsFor(secret: Uint8Array): string[] {
  return entropyToMnemonic(secret, wordlist).split(' ')
}

/**
 * The secret back from words as someone types or pastes them: any case, numbered or not, on one
 * line or many. Throws a sentence they can act on.
 */
export function secretFromWords(text: string): Uint8Array {
  const words = text
    .toLowerCase()
    .replace(/\d+[.)]?/g, ' ')
    .split(/[^a-z]+/)
    .filter(Boolean)
  if (words.length !== WORD_COUNT)
    throw new Error(
      words.length === 12
        ? 'Kova’s recovery words are 24 words. These 12 belong to another wallet app.'
        : `That’s ${words.length} words. Kova’s recovery words are ${WORD_COUNT}.`,
    )
  const unknown = words.find((w) => !wordlist.includes(w))
  if (unknown) throw new Error(`“${unknown}” isn’t a recovery word. Check its spelling.`)
  const phrase = words.join(' ')
  if (!validateMnemonic(phrase, wordlist))
    throw new Error('Those words don’t make a wallet. Check their order and spelling.')
  return mnemonicToEntropy(phrase, wordlist)
}

/** Two different word positions (0-based) to ask back, so we know they were written down. */
export function checkPositions(): [number, number] {
  const [a, b] = crypto.getRandomValues(new Uint32Array(2))
  const first = (a as number) % WORD_COUNT
  let second = (b as number) % (WORD_COUNT - 1)
  if (second >= first) second++
  return first < second ? [first, second] : [second, first]
}
