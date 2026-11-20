import { expect, test } from 'vitest'
import { formatMinutes } from './duration'

test('focus time reads as minutes, then hours and minutes', () => {
  expect(formatMinutes(0)).toBe('0 min')
  expect(formatMinutes(45)).toBe('45 min')
  expect(formatMinutes(60)).toBe('1 h')
  expect(formatMinutes(75)).toBe('1 h 15 min')
  expect(formatMinutes(Number.NaN)).toBe('0 min')
})
