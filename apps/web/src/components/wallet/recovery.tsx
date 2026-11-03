'use client'

import { useEffect, useState } from 'react'
import { Icon } from '@/components/brand'
import { recoveryWords } from '@/lib/passkey'
import { useWallet } from './provider'

const WORDS = 24
const savedKey = (address: string) => `kova.words.saved.v1:${address.toLowerCase()}`

/** Two different word positions (0-based), smaller first, to ask back. */
function positions(): [number, number] {
  const [a, b] = crypto.getRandomValues(new Uint32Array(2))
  const first = (a as number) % WORDS
  let second = (b as number) % (WORDS - 1)
  if (second >= first) second++
  return first < second ? [first, second] : [second, first]
}

/**
 * Recovery words on the web: the passkey shows the wallet's 24 words, written on paper, then two of
 * them are asked back. They bring the wallet back in the Kova app if the passkey is ever lost. The
 * words live only in this component while it's open.
 */
export function RecoveryWords() {
  const { profile } = useWallet()
  const [step, setStep] = useState<'closed' | 'words' | 'check'>('closed')
  const [words, setWords] = useState<string[]>([])
  const [ask, setAsk] = useState<[number, number]>([0, 1])
  const [answers, setAnswers] = useState(['', ''])
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const address = profile?.address
  useEffect(() => {
    if (!address) return
    try {
      setSaved(localStorage.getItem(savedKey(address)) === '1')
    } catch {
      setSaved(false)
    }
  }, [address])
  if (!profile || profile.auth === 'google') return null

  const show = async () => {
    setBusy(true)
    setProblem(null)
    try {
      setWords(await recoveryWords(profile.passkey, profile.address))
      setStep('words')
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'Your words didn’t open. Try again.')
    } finally {
      setBusy(false)
    }
  }
  const close = () => {
    setWords([])
    setAnswers(['', ''])
    setProblem(null)
    setStep('closed')
  }
  const check = () => {
    const wrong = ask.findIndex((at, i) => answers[i]?.trim().toLowerCase() !== words[at])
    if (wrong !== -1) {
      setProblem(`That isn’t word ${(ask[wrong] as number) + 1}. Look at your paper again.`)
      return
    }
    try {
      localStorage.setItem(savedKey(profile.address), '1')
    } catch {
      // Not remembered here: the words are still on their paper, which is what counts.
    }
    setSaved(true)
    close()
  }

  return (
    <section className="w-words" data-saved={saved ? 'yes' : 'no'}>
      <div className="w-keys-head">
        <span className="w-keys-icon w-words-icon">
          <Icon name="pen" size={18} />
        </span>
        <span>
          <strong>Recovery words</strong>
          <small>
            {saved
              ? 'Saved. If you lose your passkey, they bring your wallet back in the Kova app.'
              : '24 words that bring your wallet back if you lose your passkey. Not saved yet.'}
          </small>
        </span>
      </div>

      {step === 'words' ? (
        <>
          <p className="w-fine">Write all 24 on paper, in this order. Don’t take a screenshot.</p>
          <ol className="w-words-grid">
            {words.map((word, i) => (
              <li key={`${i}-${word}`}>
                <small>{i + 1}</small>
                <strong>{word}</strong>
              </li>
            ))}
          </ol>
          <p className="w-words-warn">
            <Icon name="lock" size={14} /> Anyone with these words can take your money. Kova will
            never ask for them.
          </p>
          <div className="w-forget-actions">
            <button type="button" className="mini" onClick={close}>
              Hide
            </button>
            <button
              type="button"
              className="mini mini-ink"
              onClick={() => {
                setAsk(positions())
                setAnswers(['', ''])
                setProblem(null)
                setStep('check')
              }}
            >
              I wrote them down
            </button>
          </div>
        </>
      ) : step === 'check' ? (
        <form
          className="w-words-check"
          onSubmit={(e) => {
            e.preventDefault()
            check()
          }}
        >
          <p className="w-fine">From your paper, type these two words.</p>
          {ask.map((at, i) => (
            <label key={at}>
              <small>Word {at + 1}</small>
              <input
                value={answers[i]}
                onChange={(e) =>
                  setAnswers((prev) => prev.map((a, j) => (j === i ? e.target.value : a)))
                }
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                // biome-ignore lint/a11y/noAutofocus: the first answer is the only thing to do here
                autoFocus={i === 0}
              />
            </label>
          ))}
          {problem ? <p className="form-error">{problem}</p> : null}
          <div className="w-forget-actions">
            <button type="button" className="mini" onClick={() => setStep('words')}>
              Show them again
            </button>
            <button
              type="submit"
              className="mini mini-ink"
              disabled={answers.some((a) => !a.trim())}
            >
              Check
            </button>
          </div>
        </form>
      ) : (
        <>
          {problem ? <p className="form-error">{problem}</p> : null}
          <button
            type="button"
            className="mini mini-ink w-words-show"
            disabled={busy}
            onClick={() => void show()}
          >
            <Icon name="face" size={14} />{' '}
            {busy ? 'Opening…' : saved ? 'Show my words again' : 'Show my words'}
          </button>
        </>
      )}
    </section>
  )
}
