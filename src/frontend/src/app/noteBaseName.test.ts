import {describe, expect, it} from 'vitest'
import {noteBaseNameProblem} from './appLifecycleService'

describe('noteBaseNameProblem', () => {
  it('accepts ordinary folder names', () => {
    for (const name of ['Arbeit', 'Meine NoteBase', 'Projekte 2026', 'Notizen.alt', 'Console']) {
      expect(noteBaseNameProblem(name)).toBe('')
    }
  })

  it('rejects names Windows cannot store as a folder', () => {
    for (const name of ['../Nicht erlaubt', 'a\\b', 'Plan?', 'A:B', 'Ende.', 'Ende ', '.', '..', 'Tab\tName']) {
      expect(noteBaseNameProblem(name)).not.toBe('')
    }
  })

  it('names reserved device names', () => {
    expect(noteBaseNameProblem('CON')).toContain('reserviert')
    expect(noteBaseNameProblem('aux.notes')).toContain('reserviert')
    expect(noteBaseNameProblem('Lpt1')).toContain('reserviert')
  })

  it('keeps the path separator wording the create dialog shows', () => {
    expect(noteBaseNameProblem('../Nicht erlaubt')).toContain('Pfadtrenner')
  })
})
