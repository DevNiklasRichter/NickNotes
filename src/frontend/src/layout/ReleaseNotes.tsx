import {parseNotes, type NotesBlock} from '../app/releaseNotes'

/** Headings and grouped list items of a changelog section, rendered as plain text. */
export function ReleaseNotes({text}:{text:string}) {
  const groups:(NotesBlock|NotesBlock[])[] = []
  for (const block of parseNotes(text)) {
    const last = groups.at(-1)
    if (block.kind === 'item' && Array.isArray(last)) last.push(block)
    else groups.push(block.kind === 'item' ? [block] : block)
  }
  return <div className="release-notes">{groups.map((group, index) => Array.isArray(group)
    ? <ul key={index}>{group.map((item, itemIndex) => <li key={itemIndex}>{item.text}</li>)}</ul>
    : group.kind === 'heading' ? <h4 key={index}>{group.text}</h4> : <p key={index}>{group.text}</p>)}</div>
}
