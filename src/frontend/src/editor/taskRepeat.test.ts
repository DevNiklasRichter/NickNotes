import { expect, test } from 'vitest'
import { canonicalRepeat, customOfRepeat, repeatFromCustom } from './taskRepeat'

test('rules are written in the same tokens the backend reads', () => {
  expect(canonicalRepeat('Weekly')).toBe('weekly')
  expect(canonicalRepeat(' every  2 weeks ')).toBe('every 2 weeks')
  expect(canonicalRepeat('every 1 month')).toBe('monthly')
  expect(canonicalRepeat('every 4 day')).toBe('every 4 days')
  expect(canonicalRepeat(undefined)).toBe('')
  expect(canonicalRepeat('manchmal')).toBeNull()
  expect(canonicalRepeat('every 0 days')).toBeNull()
})

test('a custom distance round-trips and is clamped', () => {
  expect(repeatFromCustom({ interval: 10, unit: 'day' })).toBe('every 10 days')
  expect(repeatFromCustom({ interval: 1, unit: 'year' })).toBe('yearly')
  expect(repeatFromCustom({ interval: 999, unit: 'week' })).toBe('every 365 weeks')
  expect(repeatFromCustom({ interval: Number.NaN, unit: 'month' })).toBe('monthly')
  expect(customOfRepeat('every 6 months')).toEqual({ interval: 6, unit: 'month' })
  expect(customOfRepeat('weekly')).toEqual({ interval: 1, unit: 'week' })
})
