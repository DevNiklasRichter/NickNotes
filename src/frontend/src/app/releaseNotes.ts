import changelog from '../../../../CHANGELOG.md?raw'

/** The changelog is written for users; the app shows the section of its own version as "Was ist neu". */
export type NotesBlock = {kind:'heading'|'item'|'text'; text:string}

export const SEEN_VERSION_KEY = 'nicknotes.whatsNew.seenVersion'

export function changelogSection(text:string, version:string):string|null {
  const lines = text.split(/\r?\n/)
  const heading = `## [${version}]`
  const start = lines.findIndex(line => line === heading || line.startsWith(heading + ' - '))
  if (start < 0) return null
  const rest = lines.slice(start + 1)
  const end = rest.findIndex(line => line.startsWith('## '))
  return rest.slice(0, end < 0 ? undefined : end).join('\n').trim() || null
}

/** Reads the small Markdown subset of the changelog and of GitHub release notes: headings, list items, text. */
export function parseNotes(text:string):NotesBlock[] {
  const blocks:NotesBlock[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().replace(/`|\*\*/g, '')
    if (!line) continue
    const last = blocks.at(-1)
    if (line.startsWith('#')) blocks.push({kind:'heading', text:line.replace(/^#+\s*/, '')})
    else if (/^[-*] /.test(line)) blocks.push({kind:'item', text:line.slice(2)})
    else if (/^\s/.test(raw) && last?.kind === 'item') last.text += ' ' + line
    else blocks.push({kind:'text', text:line})
  }
  return blocks
}

/** Notes of the running version; a development build falls back to the unreleased section. */
export const bundledNotes = (version:string):string|null =>
  (version ? changelogSection(changelog, version) : null) ?? changelogSection(changelog, 'Unreleased')
