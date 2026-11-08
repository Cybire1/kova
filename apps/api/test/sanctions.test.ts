import { describe, expect, it } from 'vitest'
import { refuseSanctioned } from '../src/services/sanctions.js'

/** Cash-outs abroad and the dollar card are refused from countries under sanctions, by IP. */
describe('sanctioned countries', () => {
  it('refuses Iran, North Korea and Russia, naming the country', () => {
    expect(() => refuseSanctioned('2.176.0.1', 'Cashing out abroad')).toThrow(
      'Cashing out abroad isn’t available in Iran.',
    )
    expect(() => refuseSanctioned('175.45.176.1', 'The dollar card')).toThrow(/North Korea/)
    expect(() => refuseSanctioned('95.173.136.1', 'The dollar card')).toThrow(/Russia/)
  })

  it('lets everyone else through, and a country it can’t tell', () => {
    expect(() => refuseSanctioned('41.58.0.1', 'Cashing out abroad')).not.toThrow()
    expect(() => refuseSanctioned('local', 'Cashing out abroad')).not.toThrow()
  })
})
