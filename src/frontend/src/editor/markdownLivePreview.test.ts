import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { todoMarkerCleanupFilter } from './markdownLivePreview'

const META = '<!-- nn:todo created=2026-01-01T10:00:00+01:00 --> ^abc123'
const LINE = `- [ ] Aufgabe ${META}`

function stateOf(doc: string): EditorState {
  return EditorState.create({ doc, extensions: [todoMarkerCleanupFilter] })
}

describe('todoMarkerCleanupFilter', () => {
  it('entfernt Checkbox und Metadaten, wenn eine Klammer geloescht wird', () => {
    const state = stateOf(LINE)
    expect(state.update({ changes: { from: 2, to: 3 } }).state.doc.toString()).toBe('- Aufgabe')
    expect(state.update({ changes: { from: 4, to: 5 } }).state.doc.toString()).toBe('- Aufgabe')
  })

  it('entfernt Checkbox und Metadaten, wenn die ganze Checkbox geloescht wird', () => {
    expect(stateOf(LINE).update({ changes: { from: 2, to: 5 } }).state.doc.toString()).toBe('- Aufgabe')
  })

  it('laesst Umschalten der Checkbox unveraendert', () => {
    expect(stateOf(LINE).update({ changes: { from: 2, to: 5, insert: '[x]' } }).state.doc.toString()).toBe(
      `- [x] Aufgabe ${META}`
    )
  })

  it('laesst Aenderungen im Text unveraendert', () => {
    expect(stateOf(LINE).update({ changes: { from: 6, insert: 'X' } }).state.doc.toString()).toBe(`- [ ] XAufgabe ${META}`)
  })

  it('laesst Zeilen ohne Metadaten unveraendert', () => {
    expect(stateOf('- [ ] Aufgabe').update({ changes: { from: 2, to: 3 } }).state.doc.toString()).toBe('-  ] Aufgabe')
  })
})
