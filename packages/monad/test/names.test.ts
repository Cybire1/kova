import { namehash, type PublicClient, zeroAddress } from 'viem'
import { describe, expect, it, vi } from 'vitest'
import { nadNameInput, nadNameOf, resolveNadName } from '../src/names.js'

const ADA = '0x1111111111111111111111111111111111111111'
const EVE = '0x2222222222222222222222222222222222222222'

/** A Monad that knows these names, and these primary names. */
function chain(names: Record<string, string>, primary: Record<string, string> = {}) {
  const readContract = vi.fn(
    async ({ functionName, args }: { functionName: string; args: [string] }) => {
      if (functionName === 'getPrimaryNameForAddress') return primary[args[0]] ?? ''
      const name = Object.keys(names).find((n) => namehash(n) === args[0])
      return name ? names[name] : zeroAddress
    },
  )
  return { client: { readContract } as unknown as PublicClient, readContract }
}

describe('nad names', () => {
  it('reads .nad names, normalized, and plain words only when asked', () => {
    expect(nadNameInput('ada.nad')).toBe('ada.nad')
    expect(nadNameInput('  Ada.NAD ')).toBe('ada.nad')
    expect(nadNameInput('@ada.nad')).toBe('ada.nad')
    expect(nadNameInput('ada')).toBeNull()
    expect(nadNameInput('ada', true)).toBe('ada.nad')
    expect(nadNameInput('2348012345678', true)).toBeNull()
    expect(nadNameInput('0x1111111111111111111111111111111111111111', true)).toBeNull()
    expect(nadNameInput('https://mykova.app/to/0x11', true)).toBeNull()
    expect(nadNameInput('ada lovelace', true)).toBeNull()
    expect(nadNameInput('a.nad')).toBeNull()
    expect(nadNameInput('a.b.nad')).toBeNull()
  })

  it('resolves a name, and says when no one has it', async () => {
    const { client } = chain({ 'ada1.nad': ADA })
    expect(await resolveNadName('ada1.nad', client)).toBe(ADA)
    expect(await resolveNadName('nobody1.nad', client)).toBeNull()
  })

  it('asks Monad once a name within a few minutes', async () => {
    const { client, readContract } = chain({ 'ada2.nad': ADA })
    await resolveNadName('ada2.nad', client)
    await resolveNadName('ada2.nad', client)
    expect(readContract).toHaveBeenCalledTimes(1)
  })

  it('throws when Monad cannot be reached, so the screen can say so', async () => {
    const client = {
      readContract: vi.fn().mockRejectedValue(new Error('down')),
    } as unknown as PublicClient
    await expect(resolveNadName('ada3.nad', client)).rejects.toThrow('down')
  })

  it('names an address only when its name points back to it', async () => {
    const { client } = chain({ 'ada4.nad': ADA, 'eve4.nad': EVE }, { [ADA]: 'ada4', [EVE]: 'ada4' })
    expect(await nadNameOf(ADA, client)).toBe('ada4.nad')
    expect(await nadNameOf(EVE, client)).toBeNull()
    const none = chain({})
    expect(await nadNameOf('0x3333333333333333333333333333333333333333', none.client)).toBeNull()
  })
})
