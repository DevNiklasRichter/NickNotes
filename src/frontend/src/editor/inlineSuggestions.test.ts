import { describe, expect, it } from 'vitest'
import { dateSuggestions, detectInlineTrigger, isInvalidDateToken, repeatSuggestions, timeSuggestions } from './inlineSuggestions'

describe('inline triggers', () => {
  it('recognises links, tags, dates and commands at the cursor', () => {
    expect(detectInlineTrigger('Siehe [[Proj', '', 10)).toEqual({ trigger: '[[', from: 16, to: 22, query: 'Proj' })
    expect(detectInlineTrigger('Siehe [[Proj', ']] weiter', 0)).toMatchObject({ to: 14 })  // closing brackets are replaced too
    expect(detectInlineTrigger('Treffen #proj', '', 0)).toEqual({ trigger: '#', from: 8, to: 13, query: 'proj' })
    expect(detectInlineTrigger('- [ ] Abgabe @mor', '', 0)).toEqual({ trigger: '@', from: 13, to: 17, query: 'mor' })
    expect(detectInlineTrigger('/tab', '', 0)).toMatchObject({ trigger: '/', query: 'tab' })
  })

  it('leaves headings, mail addresses and finished links alone', () => {
    expect(detectInlineTrigger('# Titel', '', 0)).toBeNull()
    expect(detectInlineTrigger('##', '', 0)).toBeNull()
    expect(detectInlineTrigger('max@firma', '', 0)).toBeNull()
    expect(detectInlineTrigger('[[Fertig]] und', '', 0)).toBeNull()
  })
})

describe('date suggestions', () => {
  const friday = new Date(2026, 10, 13)  // Friday, 13 November 2026

  it('offers relative days and the coming weekdays', () => {
    const all = dateSuggestions('', friday)
    expect(all.slice(0, 3).map(item => [item.label, item.iso])).toEqual([['Heute', '2026-11-13'], ['Morgen', '2026-11-14'], ['Übermorgen', '2026-11-15']])
    expect(dateSuggestions('mon', friday).map(item => item.iso)).toEqual(['2026-11-16'])
    expect(dateSuggestions('ueber', friday)[0].label).toBe('Übermorgen')
  })

  it('reads typed German and ISO dates; a past day without year means next year', () => {
    expect(dateSuggestions('20.11.', friday)[0].iso).toBe('2026-11-20')
    expect(dateSuggestions('3.1.', friday)[0].iso).toBe('2027-01-03')
    expect(dateSuggestions('2026-12-24', friday)[0].iso).toBe('2026-12-24')
    expect(dateSuggestions('31.2.', friday)).toEqual([expect.objectContaining({ label: 'Ungültiges Datum', hint: true })])
    expect(dateSuggestions('2026-13-40', friday)[0].label).toBe('Ungültiges Datum')
    expect(dateSuggestions('20.1', friday)[0]).toMatchObject({ label: 'Eigenes Datum', hint: true })
    expect(dateSuggestions('', friday).at(-1)).toMatchObject({ label: 'Eigenes Datum', hint: true })
  })

  it('flags impossible day tokens but leaves words and real dates alone', () => {
    expect(isInvalidDateToken('31.2.', friday)).toBe(true)
    expect(isInvalidDateToken('2026-13-40', friday)).toBe(true)
    expect(isInvalidDateToken('20.11.2026', friday)).toBe(false)
    expect(isInvalidDateToken('2026-11-20', friday)).toBe(false)
    expect(isInvalidDateToken('mon', friday)).toBe(false)
  })
})

describe('repeat suggestions', () => {
  const tokens = (query: string) => repeatSuggestions(query).map((item) => item.hint ? `hint:${item.label}` : item.token)

  it('offers repeat words by prefix, also with umlauts typed as ae/oe/ue', () => {
    expect(tokens('w')).toEqual(['werktags', 'wöchentlich'])
    expect(tokens('woe')).toEqual(['wöchentlich'])
    expect(tokens('mon')).toEqual(['monatlich'])
    expect(tokens('')).toContain('hint:Eigener Abstand')
    expect(tokens('2026')).toEqual([])
  })

  it('builds an own distance from alle-N-unit', () => {
    expect(tokens('alle')).toEqual(['hint:Eigener Abstand'])
    expect(tokens('alle-3')).toEqual(['alle-3-tage', 'alle-3-wochen', 'alle-3-monate'])
    expect(tokens('alle-10-w')).toEqual(['alle-10-wochen'])
    expect(tokens('alle-400')).toEqual(['hint:Eigener Abstand'])
  })
})

describe('reminder times in a capture', () => {
  const tokens = (query: string) => timeSuggestions(query).map((item) => item.hint ? `hint:${item.label}` : `${item.token}=${item.label}`)

  it('completes a typed time and ignores everything else', () => {
    expect(tokens('')).toEqual(['hint:Erinnern um …'])
    expect(tokens('9')).toEqual(['9:00=Erinnern um 09:00'])
    expect(tokens('9:3')).toEqual(['9:30=Erinnern um 09:30'])
    expect(tokens('18:45')).toEqual(['18:45=Erinnern um 18:45'])
    expect(tokens('24')).toEqual([])
    expect(tokens('9:75')).toEqual([])
    expect(tokens('morgen')).toEqual([])
  })

  it('keeps the trigger open while a time is typed', () => {
    expect(detectInlineTrigger('Arzt anrufen @9:3', '', 0)).toMatchObject({ trigger: '@', query: '9:3' })
  })
})
