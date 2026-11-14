import { describe, expect, it } from 'vitest'
import { dateSuggestions, detectInlineTrigger } from './inlineSuggestions'

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
    expect(dateSuggestions('31.2.', friday)).toEqual([])
  })
})
