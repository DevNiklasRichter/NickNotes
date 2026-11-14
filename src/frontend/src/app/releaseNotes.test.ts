import {describe, expect, it} from 'vitest'
import {changelogSection, parseNotes} from './releaseNotes'

const changelog = `# Changelog

## [Unreleased]

### Neu
- Kommt bald

## [2.2.0] - 2026-12-01

### Neu
- Termine mit \`@morgen\`
  und Tasks daraus.

### Behoben
- **Absturz** beim Speichern

## [2.1.0] - 2026-11-20

- Alt
`

describe('release notes', () => {
  it('finds the section of one version up to the next version', () => {
    expect(changelogSection(changelog, '2.2.0')).toBe('### Neu\n- Termine mit `@morgen`\n  und Tasks daraus.\n\n### Behoben\n- **Absturz** beim Speichern')
    expect(changelogSection(changelog, 'Unreleased')).toBe('### Neu\n- Kommt bald')
    expect(changelogSection(changelog, '9.9.9')).toBeNull()
  })

  it('reads headings, list items with continuation lines and plain text', () => {
    expect(parseNotes(changelogSection(changelog, '2.2.0')!)).toEqual([
      {kind:'heading', text:'Neu'},
      {kind:'item', text:'Termine mit @morgen und Tasks daraus.'},
      {kind:'heading', text:'Behoben'},
      {kind:'item', text:'Absturz beim Speichern'},
    ])
    expect(parseNotes('Nur Text\n- Punkt')).toEqual([{kind:'text', text:'Nur Text'}, {kind:'item', text:'Punkt'}])
  })
})
