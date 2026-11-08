import type {NoteTab} from '../app/AppShared'
import {parseNoteDocument} from '../editor/noteDocument'
type StoredDocument = {path: string; content: string; revision: string; title?: string}
/** Preserve typing performed while a save was in flight, updating only its stored base. */
export function mergeSavedTab(current: NoteTab, submitted: NoteTab, stored: StoredDocument): NoteTab {
  const changedDuringSave = current.content !== submitted.content
  const parsed = parseNoteDocument(stored.content, stored.title || current.title)
  return {...current, path: stored.path, revision: stored.revision, conflict: false,
    title: changedDuringSave ? current.title : (stored.title || parsed.frontmatter.title || current.title),
    content: changedDuringSave ? current.content : stored.content,
    parsedDocument: changedDuringSave ? current.parsedDocument : parsed,
    dirty: changedDuringSave,
  }
}
/** External changes replace clean tabs; a draft keeps its original revision until resolved. */
export function mergeExternalDocument(current: NoteTab, stored: StoredDocument): NoteTab {
  if (current.revision === stored.revision) return current
  if (current.dirty) return {...current, conflict: true}
  const parsed = parseNoteDocument(stored.content, stored.title || current.title)
  return {...current, ...stored, title: parsed.frontmatter.title || current.title, parsedDocument: parsed, dirty: false, conflict: false, loading: false}
}
