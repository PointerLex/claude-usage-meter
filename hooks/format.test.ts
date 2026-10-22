import { expect, test } from 'claude-code/testing'
import { k, lerp, until } from './register'

test('gradient ends, token units and reset countdown', () => {
  expect(lerp('#00f0ff', '#ff00e6', 0, 12)).toBe('#00f0ff')
  expect(lerp('#00f0ff', '#ff00e6', 11, 12)).toBe('#ff00e6')
  expect([k(678), k(12345), k(2_500_000)]).toEqual(['678', '12.3k', '2.50M'])
  const now = Date.parse('2026-10-22T12:00:00Z')
  expect(until('2026-10-22T13:30:00Z', now)).toBe('1h30m')
  expect(until('2026-10-25T16:00:00Z', now)).toBe('3d4h')
})
