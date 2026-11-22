/** Triggers typed directly in the text: `/` commands, `[[` links, `#` tags and `@` dates. */
export type InlineTrigger = '/' | '[[' | '#' | '@'

export type InlineMatch = {
  trigger: InlineTrigger
  from: number
  to: number
  query: string
}

/** Finds the trigger the cursor is in. `before` is the line up to the cursor, `after` the rest of the line. */
export function detectInlineTrigger(before: string, after: string, lineFrom: number): InlineMatch | null {
  const cursor = lineFrom + before.length
  const link = before.match(/\[\[([^[\]\n]*)$/)
  if (link) {
    // Swallow closing brackets that are already there, so choosing a note never leaves `]]]]`.
    const closing = after.startsWith(']]') ? 2 : 0
    return { trigger: '[[', from: cursor - link[0].length, to: cursor + closing, query: link[1] }
  }
  const tag = before.match(/(?:^|\s)#([\p{L}\p{N}_/-]+)$/u)
  if (tag) {
    return { trigger: '#', from: cursor - tag[1].length - 1, to: cursor, query: tag[1] }
  }
  const date = before.match(/(?:^|\s)@([\p{L}\p{N}.:-]*)$/u)
  if (date) {
    return { trigger: '@', from: cursor - date[1].length - 1, to: cursor, query: date[1] }
  }
  const slash = before.match(/(?:^|\s)\/([\w-]*)$/)
  if (slash) {
    return { trigger: '/', from: cursor - slash[1].length - 1, to: cursor, query: slash[1] }
  }
  return null
}

export type DateSuggestion = { label: string; description: string; iso: string; /** Hint rows leave the text as typed. */ hint?: boolean }

const WEEKDAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag']

export function isoDate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function plusDays(today: Date, days: number): Date {
  return new Date(today.getFullYear(), today.getMonth(), today.getDate() + days)
}

function readable(date: Date): string {
  return `${WEEKDAYS[date.getDay()]}, ${date.getDate()}.${date.getMonth() + 1}.${date.getFullYear()}`
}

function calendarDate(year: number, month: number, day: number): Date | null {
  const date = new Date(year, month - 1, day)
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null
}

/** Explicit dates: 20.11., 20.11.2026 or 2026-11-20. A day without year means the next such day. Impossible days (31.2.) give null. */
export function parseTypedDate(query: string, today: Date): Date | null {
  const iso = query.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (iso) return calendarDate(Number(iso[1]), Number(iso[2]), Number(iso[3]))
  const german = query.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})?$/)
  if (!german) return null
  const [day, month] = [Number(german[1]), Number(german[2])]
  if (german[3]) return calendarDate(Number(german[3]), month, day)
  const thisYear = calendarDate(today.getFullYear(), month, day)
  if (thisYear && thisYear >= plusDays(today, 0)) return thisYear
  // Feb 29 skips ahead to the next leap year.
  for (let year = today.getFullYear() + 1; year <= today.getFullYear() + 8; year += 1) {
    const next = calendarDate(year, month, day)
    if (next) return next
  }
  return null
}

/** A token after `@` that is meant as a date (digits, dots, dashes only) but is not a real day. */
export function isInvalidDateToken(token: string, today = new Date()): boolean {
  return /^[\d.-]*\d[\d.-]*$/.test(token) && !parseTypedDate(token, today)
}

/** Shapes that are complete enough to be judged; anything shorter is still being typed. */
const COMPLETE_DATE_SHAPE = /^(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\.\d{1,2}\.(\d{4})?)$/

const fold = (value: string) => value.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')

export function dateSuggestions(query: string, today = new Date()): DateSuggestion[] {
  const typed = query.trim()
  const explicit = parseTypedDate(typed, today)
  if (explicit) return [{ label: `${explicit.getDate()}.${explicit.getMonth() + 1}.${explicit.getFullYear()}`, description: readable(explicit), iso: isoDate(explicit) }]
  if (/^[\d.-]+$/.test(typed)) {
    return COMPLETE_DATE_SHAPE.test(typed)
      ? [{ label: 'Ungültiges Datum', description: 'Dieser Tag existiert nicht – bitte korrigieren', iso: '', hint: true }]
      : [{ label: 'Eigenes Datum', description: 'Weiter tippen: 20.11. oder 20.11.2026', iso: '', hint: true }]
  }
  const named: Array<[string, Date]> = [['Heute', plusDays(today, 0)], ['Morgen', plusDays(today, 1)], ['Übermorgen', plusDays(today, 2)]]
  for (let offset = 1; offset <= 7; offset += 1) {
    const day = plusDays(today, offset)
    named.push([offset === 7 ? `Nächster ${WEEKDAYS[day.getDay()]}` : WEEKDAYS[day.getDay()], day])
  }
  named.push(['In zwei Wochen', plusDays(today, 14)])
  const wanted = fold(query.trim())
  const matches = named
    .filter(([label]) => !wanted || fold(label).split(' ').some(word => word.startsWith(wanted)) || fold(label).startsWith(wanted))
    .map(([label, date]) => ({ label, description: readable(date), iso: isoDate(date) }))
  return wanted ? matches : [...matches, { label: 'Eigenes Datum', description: 'Weiter tippen: 20.11. oder 20.11.2026', iso: '', hint: true }]
}

/** Repeat words a capture understands after `@`; the backend (`recurrence.py`) reads the same words. */
const REPEAT_WORDS: Array<[string, string]> = [
  ['täglich', 'Täglich'],
  ['werktags', 'Werktags (Mo–Fr)'],
  ['wöchentlich', 'Wöchentlich'],
  ['zweiwöchentlich', 'Alle 2 Wochen'],
  ['monatlich', 'Monatlich'],
  ['vierteljährlich', 'Vierteljährlich'],
  ['jährlich', 'Jährlich'],
]
const REPEAT_CUSTOM_UNITS: Array<[string, string]> = [['tage', 'Tage'], ['wochen', 'Wochen'], ['monate', 'Monate']]
const REPEAT_DESCRIPTION = 'Wiederkehrende Task, ohne Datum ab heute fällig'

export type RepeatSuggestion = { label: string; description: string; token: string; hint?: boolean }

const TIME_DESCRIPTION = 'Erinnerung am Fälligkeitstag, ohne Datum heute'

/** `@9:00` in a capture: the task reminds at that time on its due day (backend `parse_capture_time`). */
export function timeSuggestions(query: string): RepeatSuggestion[] {
  const typed = query.trim()
  if (!typed) return [{ label: 'Erinnern um …', description: 'Weiter tippen: 9:00 – Erinnerung am Fälligkeitstag', token: '', hint: true }]
  const match = /^(\d{1,2})(?::(\d{0,2}))?$/.exec(typed)
  if (!match) return []
  const hour = Number(match[1])
  const minutes = match[2] ?? ''
  const minute = minutes.length === 2 ? Number(minutes) : Number(minutes.padEnd(2, '0') || 0)
  if (hour > 23 || minute > 59) return []
  const time = `${hour}:${String(minute).padStart(2, '0')}`
  return [{ label: `Erinnern um ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`, description: TIME_DESCRIPTION, token: time }]
}

/** `@` suggestions for repeating tasks in a capture: fixed words, and `alle-N-…` for an own distance. */
export function repeatSuggestions(query: string): RepeatSuggestion[] {
  const wanted = fold(query.trim())
  const customHint: RepeatSuggestion = { label: 'Eigener Abstand', description: 'Weiter tippen: alle-3-tage, alle-2-wochen', token: '', hint: true }
  const custom = /^alle-?(\d{0,3})-?([a-z]*)$/.exec(wanted)
  if (custom) {
    const interval = Number(custom[1] || 0)
    if (!interval || interval > 365) return [customHint]
    return REPEAT_CUSTOM_UNITS
      .filter(([unit]) => unit.startsWith(custom[2]))
      .map(([unit, label]) => ({ label: `Alle ${interval} ${label}`, description: REPEAT_DESCRIPTION, token: `alle-${interval}-${unit}` }))
  }
  const words = REPEAT_WORDS
    .filter(([word]) => !wanted || fold(word).startsWith(wanted))
    .map(([word, label]) => ({ label, description: REPEAT_DESCRIPTION, token: word }))
  return 'alle'.startsWith(wanted) ? [...words, customHint] : words
}
