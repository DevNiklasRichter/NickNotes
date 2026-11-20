/** Frontmatter `repeat` values; the backend (`recurrence.py`) reads the same tokens. */
export const REPEAT_PRESETS: Array<[string, string]> = [
  ['', 'Keine'],
  ['daily', 'Täglich'],
  ['weekdays', 'Werktags (Mo–Fr)'],
  ['weekly', 'Wöchentlich'],
  ['every 2 weeks', 'Alle 2 Wochen'],
  ['monthly', 'Monatlich'],
  ['every 3 months', 'Vierteljährlich'],
  ['yearly', 'Jährlich'],
]
export const REPEAT_UNITS: Array<[string, string]> = [['day', 'Tage'], ['week', 'Wochen'], ['month', 'Monate'], ['year', 'Jahre']]
const ONE_PER_UNIT: Record<string, string> = { day: 'daily', week: 'weekly', month: 'monthly', year: 'yearly' }
export const REPEAT_CUSTOM = 'custom'
const CUSTOM_PATTERN = /^every (\d{1,3}) (day|week|month|year)s?$/

export type RepeatCustom = { interval: number; unit: string }

/** Canonical token for a rule, or null when it is not one NickNotes understands. */
export function canonicalRepeat(raw: unknown): string | null {
  const clean = String(raw ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
  if (!clean) return ''
  if (REPEAT_PRESETS.some(([value]) => value === clean)) return clean
  const match = CUSTOM_PATTERN.exec(clean)
  if (!match) return null
  const interval = Number(match[1])
  if (interval < 1 || interval > 365) return null
  return repeatFromCustom({ interval, unit: match[2] })
}

export function repeatFromCustom({ interval, unit }: RepeatCustom): string {
  const clean = Math.min(365, Math.max(1, Math.round(interval) || 1))
  return clean === 1 ? ONE_PER_UNIT[unit] ?? 'daily' : `every ${clean} ${unit}s`
}

export function customOfRepeat(rule: string): RepeatCustom {
  const match = CUSTOM_PATTERN.exec(rule)
  if (match) return { interval: Number(match[1]), unit: match[2] }
  const unit = Object.entries(ONE_PER_UNIT).find(([, token]) => token === rule)?.[0]
  return { interval: unit ? 1 : 3, unit: unit ?? 'day' }
}
