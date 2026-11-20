import { useEffect, useState } from 'react'

export type NoteBacklink = { path: string; title: string }

type NoteBacklinksProps = {
  path: string
  /** Load only while the properties are open; the graph read is not free on large NoteBases. */
  active: boolean
  /** Changes when the graph was updated, so a new link shows up without reopening. */
  refreshKey: number
  load: (path: string) => Promise<NoteBacklink[]>
  onOpen: (backlink: NoteBacklink) => void
}

/** "Verlinkt von": notes whose text links to this one (incoming links from the knowledge graph). */
export function NoteBacklinks({ path, active, refreshKey, load, onOpen }: NoteBacklinksProps) {
  const [result, setResult] = useState<{ key: string; items: NoteBacklink[]; error: string } | null>(null)
  const key = `${path}\u0000${refreshKey}`
  useEffect(() => {
    if (!active || !path) return
    let current = true
    load(path).then(
      (items) => { if (current) setResult({ key, items, error: '' }) },
      (error: unknown) => { if (current) setResult({ key, items: [], error: error instanceof Error ? error.message : 'Rückverweise konnten nicht geladen werden.' }) },
    )
    return () => { current = false }
  }, [active, key, load, path])

  const loaded = result?.key === key ? result : null
  return (
    <>
      <span className="property-key">Verlinkt von</span>
      <div className="property-token-line note-backlinks">
        {!loaded ? <span className="property-value-static note-backlinks-hint">…</span> : null}
        {loaded?.error ? <span className="property-value-static note-backlinks-error">{loaded.error}</span> : null}
        {loaded && !loaded.error && loaded.items.length === 0 ? <span className="property-value-static note-backlinks-hint">Keine Notiz verlinkt hierher.</span> : null}
        {loaded?.items.map((item) => (
          <button key={item.path} type="button" className="property-chip property-chip-link-button note-backlink" onClick={() => onOpen(item)}
            data-tooltip={`„${item.title}“ öffnen`}>
            {item.title}
          </button>
        ))}
      </div>
    </>
  )
}
