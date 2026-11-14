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
  const date = before.match(/(?:^|\s)@([\p{L}\p{N}.-]*)$/u)
  if (date) {
    return { trigger: '@', from: cursor - date[1].length - 1, to: cursor, query: date[1] }
  }
  const slash = before.match(/(?:^|\s)\/([\w-]*)$/)
  if (slash) {
    return { trigger: '/', from: cursor - slash[1].length - 1, to: cursor, query: slash[1] }
  }
  return null
}

export type DateSuggestion = { label: string; description: string; iso: string }

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

/** Explicit dates: 20.11., 20.11.2026 or 2026-11-20. A day without year means the next such day. */
function typedDate(query: string, today: Date): Date | null {
  const iso = query.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  const german = query.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})?$/)
  let date: Date | null = null
  if (iso) date = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]))
  else if (german) {
    const [day, month] = [Number(german[1]), Number(german[2])]
    date = new Date(german[3] ? Number(german[3]) : today.getFullYear(), month - 1, day)
    if (!german[3] && date < plusDays(today, 0)) date = new Date(today.getFullYear() + 1, month - 1, day)
    if (date.getDate() !== day) return null
  }
  return date && !Number.isNaN(date.getTime()) ? date : null
}

const fold = (value: string) => value.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')

export function dateSuggestions(query: string, today = new Date()): DateSuggestion[] {
  const explicit = typedDate(query.trim(), today)
  if (explicit) return [{ label: `${explicit.getDate()}.${explicit.getMonth() + 1}.${explicit.getFullYear()}`, description: readable(explicit), iso: isoDate(explicit) }]
  const named: Array<[string, Date]> = [['Heute', plusDays(today, 0)], ['Morgen', plusDays(today, 1)], ['Übermorgen', plusDays(today, 2)]]
  for (let offset = 1; offset <= 7; offset += 1) {
    const day = plusDays(today, offset)
    named.push([offset === 7 ? `Nächster ${WEEKDAYS[day.getDay()]}` : WEEKDAYS[day.getDay()], day])
  }
  named.push(['In zwei Wochen', plusDays(today, 14)])
  const wanted = fold(query.trim())
  return named
    .filter(([label]) => !wanted || fold(label).split(' ').some(word => word.startsWith(wanted)) || fold(label).startsWith(wanted))
    .map(([label, date]) => ({ label, description: readable(date), iso: isoDate(date) }))
}
