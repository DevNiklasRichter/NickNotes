import {ContextMenu, ContextMenuItem} from '../ui/ContextMenu'
import {isContextMenuKey} from '../ui/contextMenuAnchor'
import type {ContextMenuAnchor} from '../ui/contextMenuAnchor'
import type {MarkdownTableMenuRequest} from './markdownLivePreview'
import { useEffect, useCallback, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, MutableRefObject } from 'react'
import { defaultKeymap, history, historyKeymap, undo, redo, selectAll, isolateHistory } from '@codemirror/commands'
import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { javascript } from '@codemirror/lang-javascript'
import { markdown, markdownKeymap } from '@codemirror/lang-markdown'
import { bracketMatching, indentOnInput, LanguageDescription } from '@codemirror/language'
import { highlightSelectionMatches, searchKeymap, openSearchPanel } from '@codemirror/search'
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  drawSelection,
  dropCursor,
  EditorView,
  highlightSpecialChars,
  keymap,
  placeholder,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view'
import { GFM } from '@lezer/markdown'

import {
  buildMarkdownTable,
  filterMarkdownCommands,
  runMarkdownCommand,
  type MarkdownCommand,
  type MarkdownCommandId,
} from './editorCommands'
import { markdownKeyBindings } from './markdownCommands'
import { liveMarkdownPreview, markdownTagLookupExtension, flushMarkdownTableDrafts } from './markdownLivePreview'
import { buildCodeMirrorTheme, markdownHighlightExtension } from './markdownTheme'
import type { TagDefinition, TagGroupDefinition } from '../tags/tagTypes'

type PaletteAnchor = {
  left: number
  top: number
}

type PaletteState =
  | {
      mode: 'slash'
      query: string
      from: number
      to: number
      selectedIndex: number
      anchor: PaletteAnchor
    }
  | {
      mode: 'palette'
      query: string
      selectedIndex: number
    }
  | {
      mode: 'tag-group'
      query: string
      selectedIndex: number
      context: {
        from: number
        to: number
        anchor: PaletteAnchor
      }
    }
  | {
      mode: 'tag-item'
      query: string
      selectedIndex: number
      group: TagGroupDefinition
      context: {
        from: number
        to: number
        anchor: PaletteAnchor
      }
    }
  | {
      mode: 'link-browse'
      query: string
      selectedIndex: number
      pathParts: string[]
      context: {
        from: number
        to: number
        anchor: PaletteAnchor
      }
    }
  | {
      mode: 'table-size'
      rows: number
      columns: number
      selectedIndex: number
      context: {
        from: number
        to: number
        anchor: PaletteAnchor
      }
    }

export type MarkdownEditorApi = {
  insertText: (text: string) => void
  getSelectedText: () => string
  getMarkdown: () => string
  focus: () => void
  openCommandPalette: () => void
  runCommand: (commandId: MarkdownCommandId) => boolean
  edit: (action: 'undo'|'redo'|'cut'|'copy'|'paste'|'selectAll') => Promise<void>
  find: () => void
  flushChanges: () => void
}

export type MarkdownLinkTarget = {
  path: string
  title: string
  target: string
  relativePath: string
  noteType: 'note' | 'task'
}

type CodeMirrorMarkdownEditorProps = {
  value: string
  theme: 'light' | 'dark'
  notePath?: string
  backendUrl?: string
  readOnly?: boolean
  tagGroups: TagGroupDefinition[]
  linkTargets?: MarkdownLinkTarget[]
  searchHighlightQuery?: string
  className?: string
  embeddedInScroll?: boolean
  placeholderText?: string
  tagSuggestions?: MarkdownEditorTagSuggestion[]
  selectedTagSuggestionKeys?: string[]
  onChange: (nextValue: string) => void
  onSubmitShortcut?: (markdown: string) => void
  onToggleTagSuggestion?: (tagKey: string) => void
  onRejectTagSuggestion?: (tagKey: string) => void
  onCreateTagFromSelection?: (selectedText: string, replaceSelection: (tagSyntax: string) => boolean) => void
  onInsertImageAsset?: (file: File) => Promise<string | null>
  onOpenWikiLink?: (target: string) => void
  onOpenTagReference?: (groupId: string, tagId: string) => void
  editorApiRef: MutableRefObject<MarkdownEditorApi | null>
}

export type MarkdownEditorTagSuggestion = {
  key: string
  category: string
  slug: string
  displayName: string
  source: string
}

const EMPTY_TAG_SUGGESTIONS: MarkdownEditorTagSuggestion[] = []

type SlashMatch = {
  from: number
  to: number
  query: string
}

type TagSuggestionMenu = ContextMenuAnchor & {
  suggestion: MarkdownEditorTagSuggestion
  view: EditorView
  document: EditorState['doc']
  from: number
  to: number
  initialFocus: 'first' | 'none'
}

type SelectionTagContextMenu = ContextMenuAnchor & {
  view: EditorView
  document: EditorState['doc']
  selectedText: string
  from: number
  to: number
}

type ResolvedTagSuggestion = {
  suggestion: MarkdownEditorTagSuggestion
  from: number
  to: number
}

const EXPLORER_MULTI_DRAG_MIME = 'application/x-nicknotes-explorer-files'

const codeLanguages = [
  LanguageDescription.of({
    name: 'TypeScript',
    alias: ['ts', 'typescript', 'tsx'],
    support: javascript({ typescript: true, jsx: true }),
  }),
  LanguageDescription.of({
    name: 'JavaScript',
    alias: ['js', 'javascript', 'jsx', 'mjs', 'cjs'],
    support: javascript({ jsx: true }),
  }),
  LanguageDescription.of({
    name: 'HTML',
    alias: ['html', 'htm'],
    support: html(),
  }),
  LanguageDescription.of({
    name: 'CSS',
    alias: ['css', 'scss', 'sass', 'less'],
    support: css(),
  }),
]

const explorerSearchHitDeco = Decoration.mark({ class: 'cm-explorer-search-hit' })

function normalizeSearchTerm(value: string): string {
  return value.trim().toLowerCase()
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildSearchTermDecorations(view: EditorView, query: string): DecorationSet {
  const cleanQuery = normalizeSearchTerm(query)
  if (!cleanQuery) {
    return Decoration.none
  }

  const ranges: ReturnType<typeof explorerSearchHitDeco.range>[] = []
  const seenLines = new Set<number>()
  for (const visibleRange of view.visibleRanges) {
    const end = Math.max(visibleRange.from, visibleRange.to - 1)
    let line = view.state.doc.lineAt(visibleRange.from)
    const endLine = view.state.doc.lineAt(end).number
    while (true) {
      if (!seenLines.has(line.number)) {
        const haystack = line.text.toLowerCase()
        let fromIndex = 0
        while (fromIndex <= haystack.length - cleanQuery.length) {
          const at = haystack.indexOf(cleanQuery, fromIndex)
          if (at < 0) {
            break
          }
          const from = line.from + at
          const to = from + cleanQuery.length
          ranges.push(explorerSearchHitDeco.range(from, to))
          fromIndex = at + Math.max(1, cleanQuery.length)
        }
        seenLines.add(line.number)
      }
      if (line.number >= endLine) {
        break
      }
      line = view.state.doc.line(line.number + 1)
    }
  }

  return ranges.length > 0 ? Decoration.set(ranges, true) : Decoration.none
}

function buildExplorerSearchHighlightExtension(query: string): Extension {
  const cleanQuery = normalizeSearchTerm(query)
  if (!cleanQuery) {
    return []
  }

  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet

      constructor(view: EditorView) {
        this.decorations = buildSearchTermDecorations(view, cleanQuery)
      }

      update(update: ViewUpdate): void {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = buildSearchTermDecorations(update.view, cleanQuery)
        }
      }
    },
    {
      decorations: (instance) => instance.decorations,
    }
  )
}

function buildTagSuggestionTerms(suggestion: MarkdownEditorTagSuggestion): string[] {
  const terms = new Set<string>()
  const addTerm = (value: string) => {
    const clean = value.trim()
    if (clean.length >= 3) {
      terms.add(clean)
    }
  }
  addTerm(suggestion.slug.replace(/[_-]+/g, ' '))
  addTerm(suggestion.slug)
  addTerm(suggestion.displayName)
  if (suggestion.source === 'explicit') {
    addTerm(`${suggestion.category}:${suggestion.slug}`)
  }
  return Array.from(terms).sort((left, right) => right.length - left.length)
}

function overlapsInlineTag(text: string, from: number, to: number): boolean {
  for (const match of text.matchAll(/\{tag:[^}\r\n]+\}/gi)) {
    if (match.index < to && match.index + match[0].length > from) return true
  }
  return false
}

function buildTagSuggestionHighlightExtension(
  suggestions: readonly MarkdownEditorTagSuggestion[],
  selectedKeys: readonly string[]
): Extension {
  const usableSuggestions = suggestions.filter((item) => item.source !== 'explicit')
  if (usableSuggestions.length === 0) {
    return []
  }

  const selected = new Set(selectedKeys)
  const highlights = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet

      constructor(view: EditorView) {
        this.decorations = this.build(view)
      }

      update(update: ViewUpdate): void {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = this.build(update.view)
        }
      }

      build(view: EditorView): DecorationSet {
        const ranges: ReturnType<Decoration['range']>[] = []
        const occupied = new Set<string>()
        for (const visibleRange of view.visibleRanges) {
          const end = Math.max(visibleRange.from, visibleRange.to - 1)
          let line = view.state.doc.lineAt(visibleRange.from)
          const endLine = view.state.doc.lineAt(end).number
          while (true) {
            for (const suggestion of usableSuggestions) {
              const decoration = Decoration.mark({
                class: `cm-capture-tag-suggestion${selected.has(suggestion.key) ? ' selected' : ''}`,
                attributes: {title: `Tagvorschlag: ${suggestion.displayName} (${suggestion.category}). Aktionen: Shift+F10 oder Menütaste.`},
              })
              for (const term of buildTagSuggestionTerms(suggestion)) {
                const pattern = new RegExp(`\\b${escapeRegExp(term)}\\b`, 'gi')
                for (const match of line.text.matchAll(pattern)) {
                  if (typeof match.index !== 'number') {
                    continue
                  }
                  if (overlapsInlineTag(line.text, match.index, match.index + match[0].length)) continue
                  const from = line.from + match.index
                  const to = from + match[0].length
                  const key = `${from}:${to}`
                  if (occupied.has(key)) {
                    continue
                  }
                  occupied.add(key)
                  ranges.push(decoration.range(from, to))
                }
              }
            }
            if (line.number >= endLine) {
              break
            }
            line = view.state.doc.line(line.number + 1)
          }
        }
        ranges.sort((left, right) => left.from - right.from || left.to - right.to)
        return ranges.length > 0 ? Decoration.set(ranges, true) : Decoration.none
      }
    },
    {
      decorations: (instance) => instance.decorations,
    }
  )
  return [highlights, EditorView.contentAttributes.of({
    tabindex: '0',
    'aria-description': 'Tagvorschläge sind im Text markiert. Cursor in einen Vorschlag setzen und Shift+F10 oder Menütaste für die Aktionen drücken.',
  })]
}

function findTagSuggestionAtPosition(
  view: EditorView,
  position: number,
  suggestions: readonly MarkdownEditorTagSuggestion[]
): ResolvedTagSuggestion | null {
  const line = view.state.doc.lineAt(position)
  const offset = position - line.from
  for (const suggestion of suggestions) {
    if (suggestion.source === 'explicit') {
      continue
    }
    for (const term of buildTagSuggestionTerms(suggestion)) {
      const pattern = new RegExp(`\\b${escapeRegExp(term)}\\b`, 'gi')
      for (const match of line.text.matchAll(pattern)) {
        if (typeof match.index !== 'number') {
          continue
        }
        if (overlapsInlineTag(line.text, match.index, match.index + match[0].length)) continue
        if (offset >= match.index && offset <= match.index + match[0].length) {
          const from = line.from + match.index
          return {
            suggestion,
            from,
            to: from + match[0].length,
          }
        }
      }
    }
  }
  return null
}

function detectSlashMatch(view: EditorView): SlashMatch | null {
  const selection = view.state.selection.main
  if (!selection.empty) {
    return null
  }

  const cursor = selection.head
  const line = view.state.doc.lineAt(cursor)
  const prefix = line.text.slice(0, cursor - line.from)
  const match = prefix.match(/(?:^|\s)\/([\w-]*)$/)
  if (!match) {
    return null
  }

  const slashIndex = prefix.lastIndexOf('/')
  if (slashIndex < 0) {
    return null
  }

  return {
    from: line.from + slashIndex,
    to: cursor,
    query: match[1] ?? '',
  }
}

function resolveSlashAnchor(view: EditorView, position: number, host: HTMLElement | null): PaletteAnchor {
  const coords = view.coordsAtPos(position)
  if (!coords || !host) {
    return { left: 16, top: 32 }
  }

  const rect = host.getBoundingClientRect()
  const panelWidth = 340
  const panelHeight = Math.min(320, Math.max(160, rect.height - 20))
  const left = Math.max(10, Math.min(coords.left - rect.left - 16, rect.width - panelWidth - 10))
  const preferredBelow = coords.bottom - rect.top + 8
  const maxTop = Math.max(10, rect.height - panelHeight - 10)
  const top =
    preferredBelow <= maxTop
      ? preferredBelow
      : Math.max(10, Math.min(maxTop, coords.top - rect.top - panelHeight - 8))
  return { left, top }
}

function resolveSelectionAnchor(view: EditorView, host: HTMLElement | null): PaletteAnchor {
  const selection = view.state.selection.main
  return resolveSlashAnchor(view, selection.head, host)
}

function clampIndex(index: number, itemCount: number): number {
  if (itemCount <= 0) {
    return 0
  }
  return Math.max(0, Math.min(index, itemCount - 1))
}

function insertSizedMarkdownTable(
  view: EditorView,
  context: { from: number; to: number },
  rows: number,
  columns: number
): void {
  const from = Math.max(0, Math.min(context.from, view.state.doc.length))
  const to = Math.max(from, Math.min(context.to, view.state.doc.length))
  const prefix = from > 0 && view.state.doc.sliceString(from - 1, from) !== '\n' ? '\n\n' : ''
  const suffix = to < view.state.doc.length && view.state.doc.sliceString(to, to + 1) !== '\n' ? '\n\n' : '\n'
  const insert = `${prefix}${buildMarkdownTable(rows, columns)}${suffix}`
  const cursor = from + insert.length
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: cursor, head: cursor },
    scrollIntoView: true,
    userEvent: 'input.type',
  })
}

function extractImageFiles(fileList: FileList | null | undefined): File[] {
  if (!fileList || fileList.length === 0) {
    return []
  }
  return Array.from(fileList).filter((file) => {
    if (file.type.toLowerCase().startsWith('image/')) {
      return true
    }
    return /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i.test(file.name)
  })
}

function normalizeDraggedPath(value: string): string {
  return value.trim().replace(/\\/g, '/').replace(/\.md$/i, '').toLowerCase()
}

function readDraggedNotePaths(dataTransfer: DataTransfer | null | undefined): string[] {
  if (!dataTransfer) {
    return []
  }

  const paths: string[] = []
  const addPath = (value: string) => {
    const clean = value.trim()
    if (clean && !paths.includes(clean)) {
      paths.push(clean)
    }
  }

  const multiRaw = dataTransfer.getData(EXPLORER_MULTI_DRAG_MIME)
  if (multiRaw) {
    try {
      const parsed = JSON.parse(multiRaw) as unknown
      if (Array.isArray(parsed)) {
        for (const entry of parsed) {
          if (typeof entry === 'string') {
            addPath(entry)
          }
        }
      }
    } catch {
      // Ignore malformed external drag data.
    }
  }

  addPath(dataTransfer.getData('application/x-note-path'))
  addPath(dataTransfer.getData('application/x-open-tab-path'))
  return paths
}

function resolveDroppedLinkTarget(path: string, targets: readonly MarkdownLinkTarget[]): string | null {
  const cleanPath = normalizeDraggedPath(path)
  if (!cleanPath) {
    return null
  }
  const match = targets.find((target) => {
    return normalizeDraggedPath(target.path) === cleanPath || normalizeDraggedPath(target.relativePath) === cleanPath
  })
  return match?.target ?? null
}

type PaletteItem =
  | {
      kind: 'tag-root'
      title: string
      description: string
    }
  | {
      kind: 'link-root'
      title: string
      description: string
    }
  | {
      kind: 'command'
      command: MarkdownCommand
    }
  | {
      kind: 'link-folder'
      name: string
      pathParts: string[]
      count: number
    }
  | {
      kind: 'note-link'
      target: MarkdownLinkTarget
    }
  | {
      kind: 'tag-group'
      group: TagGroupDefinition
    }
  | {
      kind: 'tag'
      group: TagGroupDefinition
      tag: TagDefinition
    }
  | {
      kind: 'tag-direct'
      group: TagGroupDefinition
      tag: TagDefinition
    }

function splitLinkTargetPath(target: MarkdownLinkTarget): string[] {
  const raw = (target.relativePath || target.target || target.title).replace(/\.md$/i, '')
  return raw
    .split(/[\\/]+/)
    .map((part) => part.trim())
    .filter(Boolean)
}

function linkTargetSearchText(target: MarkdownLinkTarget): string {
  return `${target.title} ${target.target} ${target.relativePath} ${target.path} ${target.noteType}`.toLowerCase()
}

function buildLinkPaletteItems(targets: readonly MarkdownLinkTarget[], pathParts: readonly string[], query: string): PaletteItem[] {
  const cleanQuery = query.trim().toLowerCase()
  if (cleanQuery) {
    return targets
      .filter((target) => linkTargetSearchText(target).includes(cleanQuery))
      .slice()
      .sort((left, right) => left.relativePath.localeCompare(right.relativePath, 'de', { sensitivity: 'base' }))
      .map<PaletteItem>((target) => ({ kind: 'note-link', target }))
  }

  const folders = new Map<string, { pathParts: string[]; count: number }>()
  const notes: MarkdownLinkTarget[] = []

  for (const target of targets) {
    const parts = splitLinkTargetPath(target)
    const isInFolder =
      parts.length > pathParts.length &&
      pathParts.every((part, index) => parts[index]?.toLowerCase() === part.toLowerCase())
    if (!isInFolder) {
      continue
    }

    if (parts.length > pathParts.length + 1) {
      const folderName = parts[pathParts.length]
      const key = folderName.toLowerCase()
      const existing = folders.get(key)
      if (existing) {
        existing.count += 1
      } else {
        folders.set(key, { pathParts: [...pathParts, folderName], count: 1 })
      }
      continue
    }

    notes.push(target)
  }

  const folderItems = Array.from(folders.entries())
    .sort((left, right) => left[0].localeCompare(right[0], 'de', { sensitivity: 'base' }))
    .map<PaletteItem>(([, folder]) => ({
      kind: 'link-folder',
      name: folder.pathParts[folder.pathParts.length - 1] ?? '',
      pathParts: folder.pathParts,
      count: folder.count,
    }))

  const noteItems = notes
    .slice()
    .sort((left, right) => left.title.localeCompare(right.title, 'de', { sensitivity: 'base' }))
    .map<PaletteItem>((target) => ({ kind: 'note-link', target }))

  return [...folderItems, ...noteItems]
}

export function CodeMirrorMarkdownEditor({
  value,
  theme,
  notePath = '',
  backendUrl = '',
  readOnly = false,
  tagGroups,
  linkTargets = [],
  searchHighlightQuery = '',
  className = '',
  embeddedInScroll = false,
  placeholderText = 'Starte mit einer Notiz ...',
  tagSuggestions = EMPTY_TAG_SUGGESTIONS,
  selectedTagSuggestionKeys = [],
  onChange,
  onSubmitShortcut,
  onToggleTagSuggestion,
  onRejectTagSuggestion,
  onCreateTagFromSelection,
  onInsertImageAsset,
  onOpenWikiLink,
  onOpenTagReference,
  editorApiRef,
}: CodeMirrorMarkdownEditorProps) {
  const shellRef = useRef<HTMLDivElement | null>(null)
  const hostRef = useRef<HTMLDivElement | null>(null)
  const paletteInputRef = useRef<HTMLInputElement | null>(null)
  const paletteListRef = useRef<HTMLDivElement | null>(null)
  const activePaletteItemRef = useRef<HTMLButtonElement | null>(null)
  const editorRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  const onSubmitShortcutRef = useRef(onSubmitShortcut)
  const onToggleTagSuggestionRef = useRef(onToggleTagSuggestion)
  const onRejectTagSuggestionRef = useRef(onRejectTagSuggestion)
  const onCreateTagFromSelectionRef = useRef(onCreateTagFromSelection)
  const onInsertImageAssetRef = useRef(onInsertImageAsset)
  const linkTargetsRef = useRef(linkTargets)
  const tagSuggestionsRef = useRef(tagSuggestions)
  const selectedTagSuggestionKeysRef = useRef(selectedTagSuggestionKeys)
  const syncingRef = useRef(false)
  const pendingDocRef = useRef<string | null>(null)
  const onChangeFrameRef = useRef<number | null>(null)
  const localEchoValuesRef = useRef<string[]>([])
  const themeCompartmentRef = useRef(new Compartment())
  const readOnlyCompartmentRef = useRef(new Compartment())
  const tagLookupCompartmentRef = useRef(new Compartment())
  const searchHighlightCompartmentRef = useRef(new Compartment())
  const tagSuggestionHighlightCompartmentRef = useRef(new Compartment())
  const previewCompartmentRef = useRef(new Compartment())
  const initialValueRef = useRef(value)
  const initialThemeRef = useRef(theme)
  const initialReadOnlyRef = useRef(readOnly)
  const initialNotePathRef = useRef(notePath)
  const initialBackendUrlRef = useRef(backendUrl)
  const initialLinkTargetsRef = useRef(linkTargets)
  const initialTagGroupsRef = useRef(tagGroups)
  const initialSearchHighlightQueryRef = useRef(searchHighlightQuery)
  const initialPlaceholderTextRef = useRef(placeholderText)
  const initialTagSuggestionsRef = useRef(tagSuggestions)
  const initialSelectedTagSuggestionKeysRef = useRef(selectedTagSuggestionKeys)
  const [paletteState, setPaletteState] = useState<PaletteState | null>(null)
  const [tagSuggestionMenu, setTagSuggestionMenu] = useState<TagSuggestionMenu | null>(null)
  const [suggestionSource, setSuggestionSource] = useState(tagSuggestions)
  // A new preview invalidates its old action snapshot, even when the key remains.
  if (suggestionSource !== tagSuggestions) {
    setSuggestionSource(tagSuggestions)
    setTagSuggestionMenu(null)
  }
  const tagSuggestionMenuRef = useRef<TagSuggestionMenu | null>(null)
  const suggestionDismissTimerRef = useRef<number | null>(null)
  const [selectionTagContextMenu, setSelectionTagContextMenu] = useState<SelectionTagContextMenu | null>(null)
  const [tableContextMenu, setTableContextMenu] = useState<MarkdownTableMenuRequest | null>(null)
  const paletteStateRef = useRef<PaletteState | null>(null)

  useEffect(() => {tagSuggestionMenuRef.current = tagSuggestionMenu}, [tagSuggestionMenu])
  const cancelSuggestionDismiss = useCallback(() => {
    if (suggestionDismissTimerRef.current !== null) window.clearTimeout(suggestionDismissTimerRef.current)
    suggestionDismissTimerRef.current = null
  }, [])
  const closeSuggestionMenu = useCallback(() => {
    cancelSuggestionDismiss()
    setTagSuggestionMenu(null)
  }, [cancelSuggestionDismiss])
  const delaySuggestionDismiss = useCallback(() => {
    cancelSuggestionDismiss()
    suggestionDismissTimerRef.current = window.setTimeout(() => {
      suggestionDismissTimerRef.current = null
      setTagSuggestionMenu(current => current?.initialFocus === 'none' ? null : current)
    }, 180)
  }, [cancelSuggestionDismiss])
  useEffect(() => cancelSuggestionDismiss, [cancelSuggestionDismiss])

  const paletteItems = useMemo<PaletteItem[]>(() => {
    if (!paletteState) {
      return []
    }

    if (paletteState.mode === 'slash') {
      const slashQuery = paletteState.query.trim().toLowerCase()
      const directTagItems: PaletteItem[] =
        slashQuery.length === 0
          ? []
          : tagGroups.flatMap((group) =>
              group.tags
                .filter((tag) =>
                  `${group.id}/${tag.id} ${group.displayName} ${tag.displayName}`.toLowerCase().includes(slashQuery)
                )
                .map<PaletteItem>((tag) => ({ kind: 'tag-direct', group, tag }))
            )
      const linkRootItem: PaletteItem = {
        kind: 'link-root',
        title: 'Link',
        description: 'Verlinkt eine Notiz oder Task per [[...]].',
      }
      const tagRootItem: PaletteItem = {
        kind: 'tag-root',
        title: 'Tag',
        description: 'Fügt ein hierarchisches Tag ({tag:gruppe/tag}) ein.',
      }
      const rootItems =
        slashQuery && 'link'.startsWith(slashQuery)
          ? [linkRootItem]
          : slashQuery && 'tag'.startsWith(slashQuery)
            ? [tagRootItem]
            : slashQuery
              ? []
              : [linkRootItem, tagRootItem]
      return [
        ...rootItems,
        ...directTagItems,
        ...filterMarkdownCommands(paletteState.query).map<PaletteItem>((command) => ({ kind: 'command', command })),
      ]
    }

    if (paletteState.mode === 'palette') {
      return filterMarkdownCommands(paletteState.query).map<PaletteItem>((command) => ({ kind: 'command', command }))
    }

    if (paletteState.mode === 'tag-group') {
      const query = paletteState.query.trim().toLowerCase()
      const groupItems = (!query
        ? tagGroups
        : tagGroups.filter((group) => `${group.id} ${group.displayName}`.toLowerCase().includes(query))
      ).map<PaletteItem>((group) => ({ kind: 'tag-group', group }))

      if (!query) {
        return groupItems
      }

      const directTagItems: PaletteItem[] = []
      for (const group of tagGroups) {
        for (const tag of group.tags) {
          const searchable = `${group.id}/${tag.id} ${group.displayName} ${tag.displayName}`.toLowerCase()
          if (searchable.includes(query)) {
            directTagItems.push({ kind: 'tag-direct', group, tag })
          }
        }
      }

      return [...groupItems, ...directTagItems]
    }

    if (paletteState.mode === 'link-browse') {
      return buildLinkPaletteItems(linkTargets, paletteState.pathParts, paletteState.query)
    }

    if (paletteState.mode === 'table-size') {
      return []
    }

    const query = paletteState.query.trim().toLowerCase()
    const tags = paletteState.group.tags
    if (!query) {
      return tags.map<PaletteItem>((tag) => ({ kind: 'tag', group: paletteState.group, tag }))
    }
    return tags
      .filter((tag) => `${tag.id} ${tag.displayName}`.toLowerCase().includes(query))
      .map<PaletteItem>((tag) => ({ kind: 'tag', group: paletteState.group, tag }))
  }, [linkTargets, paletteState, tagGroups])

  const paletteItemsRef = useRef<PaletteItem[]>([])

  useEffect(() => {
    paletteItemsRef.current = paletteItems
  }, [paletteItems])

  useEffect(() => {
    paletteStateRef.current = paletteState
  }, [paletteState])

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    onSubmitShortcutRef.current = onSubmitShortcut
  }, [onSubmitShortcut])

  useEffect(() => {
    onToggleTagSuggestionRef.current = onToggleTagSuggestion
  }, [onToggleTagSuggestion])

  useEffect(() => {
    onRejectTagSuggestionRef.current = onRejectTagSuggestion
  }, [onRejectTagSuggestion])

  useEffect(() => {
    onCreateTagFromSelectionRef.current = onCreateTagFromSelection
  }, [onCreateTagFromSelection])

  useEffect(() => {
    tagSuggestionsRef.current = tagSuggestions
  }, [tagSuggestions])

  useEffect(() => {
    selectedTagSuggestionKeysRef.current = selectedTagSuggestionKeys
  }, [selectedTagSuggestionKeys])

  const openWikiRef = useRef(onOpenWikiLink)
  const openTagRef = useRef(onOpenTagReference)
  const openPreviewWikiLink = useCallback((target: string) => openWikiRef.current?.(target), [])
  const openPreviewTag = useCallback((groupId: string, tagId: string) => openTagRef.current?.(groupId, tagId), [])
  useEffect(() => {openWikiRef.current=onOpenWikiLink;openTagRef.current=onOpenTagReference}, [onOpenWikiLink,onOpenTagReference])

  // Keep emitted snapshots until the parent acknowledges them. A slow render
  // must not turn an older local echo into an external document replacement.
  const rememberLocalEchoValue = useCallback((nextValue: string) => {
    const pending = localEchoValuesRef.current
    if (pending[pending.length - 1] !== nextValue) pending.push(nextValue)
  }, [])

  const acknowledgeLocalEchoValue = useCallback((nextValue: string): boolean => {
    const pending = localEchoValuesRef.current
    const index = pending.indexOf(nextValue)
    if (index < 0) return false
    pending.splice(0, index + 1)
    return true
  }, [])

  const flushQueuedOnChange = useCallback((forceSnapshot = false) => {
    if (forceSnapshot && editorRef.current) flushMarkdownTableDrafts(editorRef.current)
    if (onChangeFrameRef.current !== null) {
      window.cancelAnimationFrame(onChangeFrameRef.current)
      onChangeFrameRef.current = null
    }
    const queued = pendingDocRef.current ?? (forceSnapshot ? editorRef.current?.state.doc.toString() ?? null : null)
    pendingDocRef.current = null
    if (queued !== null) {
      rememberLocalEchoValue(queued)
      onChangeRef.current(queued)
    }
  }, [rememberLocalEchoValue])

  const scheduleOnChange = useCallback((nextValue: string) => {
    pendingDocRef.current = nextValue
    if (onChangeFrameRef.current !== null) {
      return
    }

    onChangeFrameRef.current = window.requestAnimationFrame(() => {
      onChangeFrameRef.current = null
      const queued = pendingDocRef.current
      pendingDocRef.current = null
      if (queued !== null) {
        rememberLocalEchoValue(queued)
        onChangeRef.current(queued)
      }
    })
  }, [rememberLocalEchoValue])

  useEffect(() => {
    onInsertImageAssetRef.current = onInsertImageAsset
  }, [onInsertImageAsset])

  useEffect(() => {
    linkTargetsRef.current = linkTargets
  }, [linkTargets])

  const paletteMode = paletteState?.mode
  useEffect(() => {
    if (
      !paletteMode ||
      (paletteMode !== 'palette' &&
        paletteMode !== 'tag-group' &&
        paletteMode !== 'tag-item' &&
        paletteMode !== 'link-browse' &&
        paletteMode !== 'table-size')
    ) {
      return
    }
    window.requestAnimationFrame(() => {
      const input = paletteInputRef.current
      if (!input) {
        return
      }
      input.focus()
      if (input.type !== 'number') {
        const cursor = input.value.length
        input.setSelectionRange(cursor, cursor)
      }
    })
  }, [paletteMode])

  useEffect(() => {
    if (!paletteState) {
      return
    }

    const onPointerDown = (event: PointerEvent) => {
      const shell = shellRef.current
      if (!shell) {
        return
      }
      if (!shell.contains(event.target as Node)) {
        setPaletteState(null)
      }
    }

    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [paletteState])


  useEffect(() => {
    const host = hostRef.current
    if (!host) {
      return
    }

    const openGlobalPalette = (): boolean => {
      setPaletteState((current) => ({
        mode: 'palette',
        query: current && current.mode === 'palette' ? current.query : '',
        selectedIndex: 0,
      }))
      return true
    }

    const movePaletteSelection = (delta: number): boolean => {
      const current = paletteStateRef.current
      if (!current) {
        return false
      }
      const available = paletteItemsRef.current.length
      if (available === 0) {
        return true
      }
      setPaletteState((previous) => {
        if (!previous) {
          return previous
        }
        const next = (previous.selectedIndex + delta + available) % available
        return { ...previous, selectedIndex: next }
      })
      return true
    }

    const insertTagSyntax = (view: EditorView, from: number, to: number, groupId: string, tagId: string): void => {
      const syntax = `{tag:${groupId}/${tagId}}`
      const cursor = from + syntax.length
      view.dispatch({
        changes: { from, to, insert: syntax },
        selection: { anchor: cursor, head: cursor },
        scrollIntoView: true,
        userEvent: 'input.type',
      })
    }

    const insertWikiLinkSyntax = (view: EditorView, from: number, to: number, target: string): void => {
      const syntax = `[[${target}]]`
      const cursor = from + syntax.length
      view.dispatch({
        changes: { from, to, insert: syntax },
        selection: { anchor: cursor, head: cursor },
        scrollIntoView: true,
        userEvent: 'input.type',
      })
    }

    const applyPaletteCommand = (indexOverride?: number): boolean => {
      const current = paletteStateRef.current
      const view = editorRef.current
      if (!current || !view) {
        return false
      }
      if (view.state.facet(EditorState.readOnly)) {
        return false
      }

      const available = paletteItemsRef.current
      if (available.length === 0) {
        return true
      }

      const index = clampIndex(typeof indexOverride === 'number' ? indexOverride : current.selectedIndex, available.length)
      const item = available[index]

      if (item.kind === 'command') {
        if (item.command.id === 'table') {
          const selection = view.state.selection.main
          const context =
            current.mode === 'slash'
              ? {
                  from: current.from,
                  to: current.to,
                  anchor: current.anchor,
                }
              : {
                  from: selection.from,
                  to: selection.to,
                  anchor: resolveSelectionAnchor(view, shellRef.current),
                }
          setPaletteState({
            mode: 'table-size',
            rows: 3,
            columns: 3,
            selectedIndex: 0,
            context,
          })
          return true
        }
        const context =
          current.mode === 'slash'
            ? {
                replaceFrom: current.from,
                replaceTo: current.to,
              }
            : undefined
        runMarkdownCommand(view, item.command.id, context)
        setPaletteState(null)
        view.focus()
        return true
      }

      if (item.kind === 'tag-root') {
        if (current.mode !== 'slash') {
          return false
        }
        setPaletteState({
          mode: 'tag-group',
          query: '',
          selectedIndex: 0,
          context: {
            from: current.from,
            to: current.to,
            anchor: current.anchor,
          },
        })
        return true
      }

      if (item.kind === 'link-root') {
        if (current.mode !== 'slash') {
          return false
        }
        setPaletteState({
          mode: 'link-browse',
          query: '',
          selectedIndex: 0,
          pathParts: [],
          context: {
            from: current.from,
            to: current.to,
            anchor: current.anchor,
          },
        })
        return true
      }

      if (item.kind === 'link-folder') {
        if (current.mode !== 'link-browse') {
          return false
        }
        setPaletteState({
          ...current,
          query: '',
          selectedIndex: 0,
          pathParts: item.pathParts,
        })
        return true
      }

      if (item.kind === 'note-link') {
        if (current.mode !== 'link-browse' && current.mode !== 'slash') {
          return false
        }
        const from = current.mode === 'slash' ? current.from : current.context.from
        const to = current.mode === 'slash' ? current.to : current.context.to
        insertWikiLinkSyntax(view, from, to, item.target.target)
        setPaletteState(null)
        view.focus()
        return true
      }

      if (item.kind === 'tag-group') {
        if (current.mode !== 'tag-group') {
          return false
        }
        setPaletteState({
          mode: 'tag-item',
          query: '',
          selectedIndex: 0,
          group: item.group,
          context: current.context,
        })
        return true
      }

      if (item.kind === 'tag-direct') {
        if (current.mode !== 'tag-group' && current.mode !== 'slash') {
          return false
        }
        const from = current.mode === 'slash' ? current.from : current.context.from
        const to = current.mode === 'slash' ? current.to : current.context.to
        insertTagSyntax(view, from, to, item.group.id, item.tag.id)
        setPaletteState(null)
        view.focus()
        return true
      }

      if (item.kind === 'tag') {
        if (current.mode !== 'tag-item') {
          return false
        }
        insertTagSyntax(view, current.context.from, current.context.to, item.group.id, item.tag.id)
        setPaletteState(null)
        view.focus()
        return true
      }

      return true
    }

    const closePalette = (): boolean => {
      if (!paletteStateRef.current) {
        return false
      }
      setPaletteState(null)
      editorRef.current?.focus()
      return true
    }

    const syncSlashPalette = (view: EditorView): void => {
      const current = paletteStateRef.current
      if (current && current.mode !== 'slash') {
        return
      }

      const slash = detectSlashMatch(view)
      if (!slash) {
        if (current && current.mode === 'slash') {
          setPaletteState(null)
        }
        return
      }

      const anchor = resolveSlashAnchor(view, slash.to, shellRef.current)
      setPaletteState((previous) => {
        if (!previous || previous.mode !== 'slash') {
          return {
            mode: 'slash',
            query: slash.query,
            from: slash.from,
            to: slash.to,
            selectedIndex: 0,
            anchor,
          }
        }

        const selectedIndex = previous.query === slash.query ? previous.selectedIndex : 0
        if (
          previous.query === slash.query &&
          previous.from === slash.from &&
          previous.to === slash.to &&
          previous.anchor.left === anchor.left &&
          previous.anchor.top === anchor.top
        ) {
          return previous
        }

        return {
          ...previous,
          query: slash.query,
          from: slash.from,
          to: slash.to,
          selectedIndex,
          anchor,
        }
      })
    }

    const insertImageMarkdown = async (view: EditorView, files: File[], position?: number): Promise<boolean> => {
      if (view.state.facet(EditorState.readOnly)) {
        return false
      }
      const uploader = onInsertImageAssetRef.current
      if (!uploader || files.length === 0) {
        return false
      }

      let insertAt =
        typeof position === 'number'
          ? Math.max(0, Math.min(position, view.state.doc.length))
          : view.state.selection.main.from
      let inserted = false

      for (const file of files) {
        try {
          const snippet = await uploader(file)
          if (!snippet) {
            continue
          }
          const prefix = insertAt > 0 && view.state.doc.sliceString(insertAt - 1, insertAt) !== '\n' ? '\n' : ''
          const text = `${prefix}${snippet}\n`
          view.dispatch({
            changes: { from: insertAt, to: insertAt, insert: text },
            selection: { anchor: insertAt + text.length },
            scrollIntoView: true,
            userEvent: 'input.paste',
          })
          insertAt += text.length
          inserted = true
        } catch {
          continue
        }
      }

      if (inserted) {
        view.focus()
      }
      return inserted
    }

    const insertDraggedNoteLinks = (view: EditorView, dataTransfer: DataTransfer | null, position?: number): boolean => {
      if (view.state.facet(EditorState.readOnly)) {
        return false
      }
      const paths = readDraggedNotePaths(dataTransfer)
      if (paths.length === 0) {
        return false
      }
      const targets = paths
        .map((path) => resolveDroppedLinkTarget(path, linkTargetsRef.current))
        .filter((target): target is string => Boolean(target))
      const uniqueTargets = Array.from(new Set(targets))
      if (uniqueTargets.length === 0) {
        return false
      }

      const insert = uniqueTargets.map((target) => `[[${target}]]`).join(' ')
      const selection = view.state.selection.main
      const insertAt =
        typeof position === 'number'
          ? Math.max(0, Math.min(position, view.state.doc.length))
          : selection.from
      view.dispatch({
        changes: { from: insertAt, to: selection.empty ? insertAt : selection.to, insert },
        selection: { anchor: insertAt + insert.length },
        scrollIntoView: true,
        userEvent: 'input.drop',
      })
      view.focus()
      return true
    }

    const openSelectionMenu = (view: EditorView, x: number, y: number) => {
      const selection = view.state.selection.main
      const selectedText = view.state.doc.sliceString(selection.from, selection.to).trim()
      if (!onCreateTagFromSelectionRef.current || view.state.readOnly || selection.empty || !selectedText) return false
      setSelectionTagContextMenu({selectedText, from: selection.from, to: selection.to,
        x, y, trigger: view.contentDOM, view, document: view.state.doc})
      setPaletteState(null)
      closeSuggestionMenu()
      return true
    }

    const openSuggestionMenu = (view: EditorView, position: number, initialFocus: 'first' | 'none', pointer?: {x: number; y: number}) => {
      const resolved = findTagSuggestionAtPosition(view, position, tagSuggestionsRef.current)
      if (!resolved) return false
      const selection = view.state.selection.main
      if (initialFocus === 'first' && !selection.empty && (selection.from !== resolved.from || selection.to !== resolved.to)) return false
      const coords = view.coordsAtPos(resolved.to)
      if (!coords) return false
      cancelSuggestionDismiss()
      setTagSuggestionMenu(current => {
        if (initialFocus === 'none' && current?.suggestion === resolved.suggestion && current.document === view.state.doc) return current
        return {suggestion: resolved.suggestion, view, document: view.state.doc,
          from: resolved.from, to: resolved.to, initialFocus,
          x: pointer?.x ?? coords.left, y: pointer?.y ?? coords.bottom + 8, trigger: view.contentDOM}
      })
      setSelectionTagContextMenu(null)
      setPaletteState(null)
      return true
    }

    const instance = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: initialValueRef.current,
        extensions: [
          markdown({
            extensions: [GFM],
            codeLanguages,
            addKeymap: false,
          }),
          drawSelection(),
          dropCursor(),
          highlightSpecialChars(),
          indentOnInput(),
          bracketMatching(),
          history(),
          EditorView.lineWrapping,
          markdownHighlightExtension,
          tagLookupCompartmentRef.current.of(markdownTagLookupExtension(initialTagGroupsRef.current)),
          searchHighlightCompartmentRef.current.of(
            buildExplorerSearchHighlightExtension(initialSearchHighlightQueryRef.current)
          ),
          tagSuggestionHighlightCompartmentRef.current.of(
            buildTagSuggestionHighlightExtension(
              initialTagSuggestionsRef.current,
              initialSelectedTagSuggestionKeysRef.current
            )
          ),
          highlightSelectionMatches(),
          placeholder(initialPlaceholderTextRef.current),
          previewCompartmentRef.current.of(
            liveMarkdownPreview({
              onTableContextMenu: setTableContextMenu,
              notePath: initialNotePathRef.current,
              backendUrl: initialBackendUrlRef.current,
              linkTargets: initialLinkTargetsRef.current,
              onOpenWikiLink: openPreviewWikiLink,
              onOpenTagReference: openPreviewTag,
            })
          ),
          readOnlyCompartmentRef.current.of([
            EditorState.readOnly.of(initialReadOnlyRef.current),
            EditorView.editable.of(!initialReadOnlyRef.current),
          ]),
          keymap.of([
            {
              key: 'Mod-k',
              run: () => openGlobalPalette(),
            },
            {
              key: 'Mod-Shift-p',
              run: () => openGlobalPalette(),
            },
            {
              key: 'ArrowDown',
              run: () => movePaletteSelection(1),
            },
            {
              key: 'ArrowUp',
              run: () => movePaletteSelection(-1),
            },
            {
              key: 'Enter',
              run: () => applyPaletteCommand(),
            },
            {
              key: 'Enter',
              run: (view) => {
                const submitShortcut = onSubmitShortcutRef.current
                if (!submitShortcut || paletteStateRef.current || view.state.facet(EditorState.readOnly)) {
                  return false
                }
                flushQueuedOnChange()
                submitShortcut(view.state.doc.toString())
                return true
              },
            },
            {
              key: 'Escape',
              run: () => closePalette(),
            },
            ...markdownKeyBindings,
            ...markdownKeymap,
            ...defaultKeymap,
            ...historyKeymap,
            ...searchKeymap,
          ]),
          EditorView.domEventHandlers({
            dragover: (event) => {
              if (readDraggedNotePaths(event.dataTransfer).length === 0) {
                return false
              }
              event.preventDefault()
              if (event.dataTransfer) {
                event.dataTransfer.dropEffect = 'copy'
              }
              return true
            },
            keydown: (event, view) => {
              if (event.key === 'Escape' && tagSuggestionMenuRef.current) {
                closeSuggestionMenu()
                event.preventDefault(); event.stopPropagation(); return true
              }
              if (!isContextMenuKey(event)) return false
              const selection = view.state.selection.main
              if (openSuggestionMenu(view, selection.head, 'first')) {
                event.preventDefault(); event.stopPropagation(); return true
              }
              const coords = view.coordsAtPos(view.state.selection.main.head)
              if (!coords || !openSelectionMenu(view, coords.left, coords.bottom)) return false
              event.preventDefault(); event.stopPropagation(); return true
            },
            contextmenu: (event, view) => {
              if (event.target instanceof Element && event.target.closest('.cm-md-table-widget')) return false
              const selection = view.state.selection.main
              const pos = view.posAtCoords({x:event.clientX,y:event.clientY})
              if (pos !== null && openSuggestionMenu(view, pos, 'first', {x:event.clientX,y:event.clientY})) {
                event.preventDefault(); event.stopPropagation(); return true
              }
              if (pos === null || pos < selection.from || pos > selection.to) {setSelectionTagContextMenu(null); return false}
              if (!openSelectionMenu(view,event.clientX,event.clientY)) return false
              event.preventDefault(); event.stopPropagation(); return true
            },
            mousemove: (event, view) => {
              if (paletteStateRef.current || (document.querySelector('.nn-context-menu') && !tagSuggestionMenuRef.current)) return false
              if (tagSuggestionMenuRef.current?.initialFocus === 'first') return false
              const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
              if (pos === null || !openSuggestionMenu(view, pos, 'none')) {
                if (tagSuggestionMenuRef.current) delaySuggestionDismiss()
              }
              return false
            },
            paste: (event, view) => {
              if (view.state.facet(EditorState.readOnly)) {
                event.preventDefault()
                return true
              }
              const imageFiles = extractImageFiles(event.clipboardData?.files)
              if (imageFiles.length === 0) {
                return false
              }
              event.preventDefault()
              void insertImageMarkdown(view, imageFiles)
              return true
            },
            drop: (event, view) => {
              if (view.state.facet(EditorState.readOnly)) {
                event.preventDefault()
                return true
              }
              if (insertDraggedNoteLinks(view, event.dataTransfer)) {
                event.preventDefault()
                event.stopPropagation()
                return true
              }
              const imageFiles = extractImageFiles(event.dataTransfer?.files)
              if (imageFiles.length === 0) {
                return false
              }
              event.preventDefault()
              const coords = { x: event.clientX, y: event.clientY }
              const dropPos = view.posAtCoords(coords) ?? view.state.selection.main.from
              void insertImageMarkdown(view, imageFiles, dropPos)
              return true
            },
          }),
          themeCompartmentRef.current.of(buildCodeMirrorTheme(initialThemeRef.current)),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) setSelectionTagContextMenu(null)
            if (update.docChanged || update.selectionSet || update.startState.readOnly !== update.state.readOnly) closeSuggestionMenu()
            if (update.docChanged && !syncingRef.current) {
              scheduleOnChange(update.state.doc.toString())
            }

            if (update.docChanged || update.selectionSet || update.viewportChanged) {
              syncSlashPalette(update.view)
            }
          }),
        ],
      }),
    })

    editorRef.current = instance
    editorApiRef.current = {
      insertText: (text: string) => {
        const selection = instance.state.selection.main
        instance.dispatch({
          changes: { from: selection.from, to: selection.to, insert: text },
          selection: { anchor: selection.from + text.length },
          scrollIntoView: true,
          userEvent: 'input.type',
        })
      },
      getSelectedText: () => {
        const selection = instance.state.selection.main
        return instance.state.doc.sliceString(selection.from, selection.to)
      },
      getMarkdown: () => instance.state.doc.toString(),
      // A frame may already have emitted onChange without React committing it.
      // Explicit save/close must enqueue a fresh snapshot inside flushSync.
      flushChanges: () => flushQueuedOnChange(true),
      find: () => {instance.focus();openSearchPanel(instance)},
      edit: async action => {
        instance.focus()
        if(action==='selectAll'){selectAll(instance);return}
        const writable=!instance.state.readOnly
        if(action==='undo'){if(writable)undo(instance);return}
        if(action==='redo'){if(writable)redo(instance);return}
        const document=instance.state.doc
        const range=instance.state.selection.main
        if(action==='copy'||action==='cut'){
          if(range.empty)return
          await navigator.clipboard.writeText(document.sliceString(range.from,range.to))
          if(action==='cut'&&writable&&editorRef.current===instance&&instance.state.doc===document)instance.dispatch({changes:{from:range.from,to:range.to,insert:''},userEvent:'delete.cut'})
        } else if(action==='paste'&&writable){
          const text=await navigator.clipboard.readText()
          if(editorRef.current===instance)instance.dispatch({...instance.state.replaceSelection(text),userEvent:'input.paste'})
        }
      },
      focus: () => instance.focus(),
      openCommandPalette: () => {
        openGlobalPalette()
      },
      runCommand: (commandId: MarkdownCommandId) => runMarkdownCommand(instance, commandId),
    }

    return () => {
      flushQueuedOnChange()
      editorApiRef.current = null
      instance.destroy()
      editorRef.current = null
    }
  }, [editorApiRef, flushQueuedOnChange, scheduleOnChange, openPreviewWikiLink, openPreviewTag, cancelSuggestionDismiss, closeSuggestionMenu, delaySuggestionDismiss])

  useEffect(() => {
    const instance = editorRef.current
    if (!instance) {
      return
    }

    instance.dispatch({
      effects: themeCompartmentRef.current.reconfigure(buildCodeMirrorTheme(theme)),
    })
  }, [theme])

  useEffect(() => {
    const instance = editorRef.current
    if (!instance) {
      return
    }

    instance.dispatch({
      effects: tagLookupCompartmentRef.current.reconfigure(markdownTagLookupExtension(tagGroups)),
    })
  }, [tagGroups])

  useEffect(() => {
    const instance = editorRef.current
    if (!instance) {
      return
    }

    instance.dispatch({
      effects: searchHighlightCompartmentRef.current.reconfigure(buildExplorerSearchHighlightExtension(searchHighlightQuery)),
    })
  }, [searchHighlightQuery])

  useEffect(() => {
    const instance = editorRef.current
    if (!instance) {
      return
    }

    instance.dispatch({
      effects: tagSuggestionHighlightCompartmentRef.current.reconfigure(
        buildTagSuggestionHighlightExtension(tagSuggestions, selectedTagSuggestionKeys)
      ),
    })
  }, [tagSuggestions, selectedTagSuggestionKeys])

  useEffect(() => {
    const instance = editorRef.current
    if (!instance) {
      return
    }

    instance.dispatch({
      effects: previewCompartmentRef.current.reconfigure(
        liveMarkdownPreview({
          onTableContextMenu: setTableContextMenu,
          notePath,
          backendUrl,
          linkTargets,
          onOpenWikiLink: openPreviewWikiLink,
          onOpenTagReference: openPreviewTag,
        })
      ),
    })
  }, [notePath, backendUrl, linkTargets, openPreviewWikiLink, openPreviewTag])

  useEffect(() => {
    const instance = editorRef.current
    if (!instance) {
      return
    }

    instance.dispatch({
      effects: readOnlyCompartmentRef.current.reconfigure([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]),
    })
  }, [readOnly])

  useEffect(() => {
    const instance = editorRef.current
    if (!instance) {
      return
    }

    const currentValue = instance.state.doc.toString()
    const localEcho = acknowledgeLocalEchoValue(value)
    if (currentValue === value || localEcho) {
      return
    }
    localEchoValuesRef.current = []

    const selection = instance.state.selection.main
    const nextAnchor = Math.min(value.length, selection.anchor)
    const nextHead = Math.min(value.length, selection.head)

    syncingRef.current = true
    instance.dispatch({
      changes: { from: 0, to: currentValue.length, insert: value },
      selection: { anchor: nextAnchor, head: nextHead },
      scrollIntoView: false,
    })
    syncingRef.current = false
  }, [value, acknowledgeLocalEchoValue])

  const onPaletteInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (
      !paletteState ||
      (paletteState.mode !== 'palette' &&
        paletteState.mode !== 'tag-group' &&
        paletteState.mode !== 'tag-item' &&
        paletteState.mode !== 'link-browse' &&
        paletteState.mode !== 'table-size')
    ) {
      return
    }

    if (paletteState.mode === 'table-size') {
      if (event.key === 'Enter') {
        event.preventDefault()
        const view = editorRef.current
        if (view && !view.state.facet(EditorState.readOnly)) {
          insertSizedMarkdownTable(view, paletteState.context, paletteState.rows, paletteState.columns)
          setPaletteState(null)
          view.focus()
        }
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setPaletteState(null)
        editorRef.current?.focus()
      }
      return
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setPaletteState((current) => {
        if (!current) {
          return current
        }
        const available = paletteItems.length
        if (available === 0) {
          return current
        }
        return { ...current, selectedIndex: (current.selectedIndex + 1) % available }
      })
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setPaletteState((current) => {
        if (!current) {
          return current
        }
        const available = paletteItems.length
        if (available === 0) {
          return current
        }
        return { ...current, selectedIndex: (current.selectedIndex - 1 + available) % available }
      })
      return
    }

    if (event.key === 'Enter') {
      event.preventDefault()
      const activeIndex = clampIndex(paletteState.selectedIndex, paletteItems.length)
      applyPaletteItemByIndex(activeIndex)
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      if (paletteState.mode === 'tag-item') {
        setPaletteState({
          mode: 'tag-group',
          query: '',
          selectedIndex: 0,
          context: paletteState.context,
        })
        return
      }
      if (paletteState.mode === 'link-browse' && paletteState.pathParts.length > 0) {
        setPaletteState({
          ...paletteState,
          query: '',
          selectedIndex: 0,
          pathParts: paletteState.pathParts.slice(0, -1),
        })
        return
      }
      setPaletteState(null)
      editorRef.current?.focus()
      return
    }
  }

  const applyPaletteItemByIndex = (index: number) => {
    const view = editorRef.current
    if (!view) {
      return
    }
    if (view.state.facet(EditorState.readOnly)) {
      return
    }
    const current = paletteStateRef.current
    if (!current) {
      return
    }
    const item = paletteItems[index]
    if (!item) {
      return
    }
    if (item.kind === 'command') {
      if (item.command.id === 'table') {
        const selection = view.state.selection.main
        const context =
          current.mode === 'slash'
            ? {
                from: current.from,
                to: current.to,
                anchor: current.anchor,
              }
            : {
                from: selection.from,
                to: selection.to,
                anchor: resolveSelectionAnchor(view, shellRef.current),
              }
        setPaletteState({
          mode: 'table-size',
          rows: 3,
          columns: 3,
          selectedIndex: 0,
          context,
        })
        return
      }
      const context =
        current.mode === 'slash'
          ? {
              replaceFrom: current.from,
              replaceTo: current.to,
            }
          : undefined
      runMarkdownCommand(view, item.command.id, context)
      setPaletteState(null)
      view.focus()
      return
    }
    if (item.kind === 'tag-root') {
      if (current.mode !== 'slash') {
        return
      }
      setPaletteState({
        mode: 'tag-group',
        query: '',
        selectedIndex: 0,
        context: { from: current.from, to: current.to, anchor: current.anchor },
      })
      return
    }
    if (item.kind === 'link-root') {
      if (current.mode !== 'slash') {
        return
      }
      setPaletteState({
        mode: 'link-browse',
        query: '',
        selectedIndex: 0,
        pathParts: [],
        context: { from: current.from, to: current.to, anchor: current.anchor },
      })
      return
    }
    if (item.kind === 'link-folder') {
      if (current.mode !== 'link-browse') {
        return
      }
      setPaletteState({
        ...current,
        query: '',
        selectedIndex: 0,
        pathParts: item.pathParts,
      })
      return
    }
    if (item.kind === 'note-link') {
      if (current.mode !== 'link-browse' && current.mode !== 'slash') {
        return
      }
      const from = current.mode === 'slash' ? current.from : current.context.from
      const to = current.mode === 'slash' ? current.to : current.context.to
      const syntax = `[[${item.target.target}]]`
      const cursor = from + syntax.length
      view.dispatch({
        changes: { from, to, insert: syntax },
        selection: { anchor: cursor, head: cursor },
        scrollIntoView: true,
        userEvent: 'input.type',
      })
      setPaletteState(null)
      view.focus()
      return
    }
    if (item.kind === 'tag-group') {
      if (current.mode !== 'tag-group') {
        return
      }
      setPaletteState({
        mode: 'tag-item',
        query: '',
        selectedIndex: 0,
        group: item.group,
        context: current.context,
      })
      return
    }
    if (item.kind === 'tag-direct') {
      if (current.mode !== 'tag-group' && current.mode !== 'slash') {
        return
      }
      const from = current.mode === 'slash' ? current.from : current.context.from
      const to = current.mode === 'slash' ? current.to : current.context.to
      const syntax = `{tag:${item.group.id}/${item.tag.id}}`
      const cursor = from + syntax.length
      view.dispatch({
        changes: { from, to, insert: syntax },
        selection: { anchor: cursor, head: cursor },
        scrollIntoView: true,
        userEvent: 'input.type',
      })
      setPaletteState(null)
      view.focus()
      return
    }
    if (item.kind === 'tag') {
      if (current.mode !== 'tag-item') {
        return
      }
      const syntax = `{tag:${item.group.id}/${item.tag.id}}`
      const cursor = current.context.from + syntax.length
      view.dispatch({
        changes: { from: current.context.from, to: current.context.to, insert: syntax },
        selection: { anchor: cursor, head: cursor },
        scrollIntoView: true,
        userEvent: 'input.type',
      })
      setPaletteState(null)
      view.focus()
    }
  }

  const isAnchoredPalette =
    paletteState &&
    (paletteState.mode === 'slash' ||
      paletteState.mode === 'tag-group' ||
      paletteState.mode === 'tag-item' ||
      paletteState.mode === 'link-browse' ||
      paletteState.mode === 'table-size')
  const paletteLeft = isAnchoredPalette
    ? paletteState.mode === 'slash'
      ? paletteState.anchor.left
      : paletteState.context.anchor.left
    : undefined
  const paletteTop = isAnchoredPalette
    ? paletteState.mode === 'slash'
      ? paletteState.anchor.top
      : paletteState.context.anchor.top
    : undefined
  const activeCommandIndex = clampIndex(paletteState ? paletteState.selectedIndex : 0, paletteItems.length)
  const showSearchInput = paletteState ? paletteState.mode !== 'slash' : false

  useEffect(() => {
    if (!paletteMode || paletteMode === 'table-size' || paletteItems.length === 0) {
      return
    }
    window.requestAnimationFrame(() => {
      activePaletteItemRef.current?.scrollIntoView({
        block: 'nearest',
        inline: 'nearest',
      })
    })
  }, [activeCommandIndex, paletteItems.length, paletteMode])

  return (
    <div
      className={`code-editor-shell ${embeddedInScroll ? 'embedded-scroll' : ''} ${className}`.trim()}
      ref={shellRef}
      onMouseLeave={delaySuggestionDismiss}
    >
      <div className={`code-editor-host ${embeddedInScroll ? 'embedded-scroll' : ''}`.trim()} ref={hostRef} />

      {selectionTagContextMenu ? (
        <ContextMenu anchor={selectionTagContextMenu} label="Auswahlaktionen" onClose={() => setSelectionTagContextMenu(null)}>
          <ContextMenuItem onClick={() => {
            const menu = selectionTagContextMenu
            if (editorRef.current !== menu.view || menu.view.state.readOnly || menu.view.state.doc !== menu.document) return
            onCreateTagFromSelectionRef.current?.(menu.selectedText, tagSyntax => {
              const view = editorRef.current
              if (view !== menu.view || view.state.readOnly || view.state.doc !== menu.document) return false
              view.dispatch({changes:{from:menu.from,to:menu.to,insert:tagSyntax},
                selection:{anchor:menu.from+tagSyntax.length},scrollIntoView:true,userEvent:'input.type',annotations:isolateHistory.of('full')})
              view.focus()
              return true
            })
          }}>Neuen Tag erstellen</ContextMenuItem>
        </ContextMenu>
      ) : null}

      {tableContextMenu ? (
        <ContextMenu anchor={tableContextMenu.anchor} label="Tabellenaktionen" onClose={() => tableContextMenu.dismiss()}>
          {tableContextMenu.actions.map(action => <ContextMenuItem key={action.label} disabled={action.disabled} onClick={action.run}>{action.label}</ContextMenuItem>)}
        </ContextMenu>
      ) : null}

      {tagSuggestionMenu ? (
        <ContextMenu anchor={tagSuggestionMenu} label={`Tagvorschlag: ${tagSuggestionMenu.suggestion.displayName}`}
          heading={`${tagSuggestionMenu.suggestion.displayName} (${tagSuggestionMenu.suggestion.category})`}
          initialFocus={tagSuggestionMenu.initialFocus} onClose={closeSuggestionMenu}
          onPointerEnter={cancelSuggestionDismiss} onPointerLeave={delaySuggestionDismiss}>
          <ContextMenuItem disabled={readOnly} onClick={() => {
            const menu = tagSuggestionMenu
            const view = editorRef.current
            if (view !== menu.view || view.state.readOnly || view.state.doc !== menu.document || !tagSuggestionsRef.current.includes(menu.suggestion)) return
            const syntax = `{tag:${menu.suggestion.category}/${menu.suggestion.slug}}`
            view.dispatch({changes: {from: menu.from, to: menu.to, insert: syntax},
              selection: {anchor: menu.from + syntax.length}, scrollIntoView: true,
              userEvent: 'input.type', annotations: isolateHistory.of('full')})
            view.focus()
            onToggleTagSuggestionRef.current?.(menu.suggestion.key)
          }}>Übernehmen</ContextMenuItem>
          <ContextMenuItem disabled={readOnly} onClick={() => {
            const menu = tagSuggestionMenu
            const view = editorRef.current
            if (view !== menu.view || view.state.readOnly || view.state.doc !== menu.document || !tagSuggestionsRef.current.includes(menu.suggestion)) return
            onRejectTagSuggestionRef.current?.(menu.suggestion.key)
          }}>Verwerfen</ContextMenuItem>
        </ContextMenu>
      ) : null}

      {paletteState ? (
        <div
          className={`editor-command-palette ${isAnchoredPalette ? 'slash' : 'global'}`}
          style={isAnchoredPalette ? { left: `${paletteLeft}px`, top: `${paletteTop}px` } : undefined}
        >
          {paletteState.mode === 'table-size' ? (
            <div className="editor-table-size-panel">
              <div className="editor-command-slash-meta">Tabelle einfügen</div>
              <div className="editor-table-size-fields">
                <label>
                  Zeilen
                  <input
                    ref={paletteInputRef}
                    type="number"
                    min="1"
                    max="30"
                    value={paletteState.rows}
                    onChange={(event) => {
                      const rows = Number.parseInt(event.target.value, 10)
                      setPaletteState((current) =>
                        current && current.mode === 'table-size'
                          ? { ...current, rows: Number.isFinite(rows) ? Math.max(1, Math.min(30, rows)) : 1 }
                          : current
                      )
                    }}
                    onKeyDown={onPaletteInputKeyDown}
                  />
                </label>
                <label>
                  Spalten
                  <input
                    type="number"
                    min="1"
                    max="12"
                    value={paletteState.columns}
                    onChange={(event) => {
                      const columns = Number.parseInt(event.target.value, 10)
                      setPaletteState((current) =>
                        current && current.mode === 'table-size'
                          ? { ...current, columns: Number.isFinite(columns) ? Math.max(1, Math.min(12, columns)) : 1 }
                          : current
                      )
                    }}
                    onKeyDown={onPaletteInputKeyDown}
                  />
                </label>
              </div>
              <div className="editor-table-size-actions">
                <button
                  type="button"
                  onMouseDown={(event) => {
                    event.preventDefault()
                  }}
                  onClick={() => {
                    const view = editorRef.current
                    if (!view || paletteState.mode !== 'table-size') {
                      return
                    }
                    insertSizedMarkdownTable(view, paletteState.context, paletteState.rows, paletteState.columns)
                    setPaletteState(null)
                    view.focus()
                  }}
                >
                  Einfügen
                </button>
                <button
                  type="button"
                  className="muted"
                  onMouseDown={(event) => {
                    event.preventDefault()
                  }}
                  onClick={() => {
                    setPaletteState(null)
                    editorRef.current?.focus()
                  }}
                >
                  Abbrechen
                </button>
              </div>
            </div>
          ) : showSearchInput ? (
            <div className="editor-command-search-row">
              <input
                ref={paletteInputRef}
                value={paletteState.query}
                onChange={(event) => {
                  const nextQuery = event.target.value
                  setPaletteState((current) =>
                    current && current.mode !== 'slash'
                      ? {
                          ...current,
                          query: nextQuery,
                          selectedIndex: 0,
                        }
                      : current
                  )
                }}
                onKeyDown={onPaletteInputKeyDown}
                placeholder={
                  paletteState.mode === 'palette'
                    ? 'Befehl suchen (z. B. task, code, link)'
                    : paletteState.mode === 'tag-group'
                      ? 'Tag-Gruppe oder Tag suchen'
                      : paletteState.mode === 'link-browse'
                        ? 'Notiz, Task oder Datei suchen'
                        : 'Tag suchen'
                }
              />
            </div>
          ) : (
            <div className="editor-command-slash-meta">/{paletteState.query || ''}</div>
          )}

          {paletteState.mode === 'tag-item' ? (
            <div className="editor-command-slash-meta">
              Gruppe: {paletteState.group.displayName} ({paletteState.group.id})
            </div>
          ) : null}
          {paletteState.mode === 'link-browse' && paletteState.pathParts.length > 0 ? (
            <div className="editor-command-slash-meta">{paletteState.pathParts.join(' / ')}</div>
          ) : null}

          {paletteState.mode !== 'table-size' ? (
            <div ref={paletteListRef} className="editor-command-list" role="listbox" aria-label="Markdown-Befehle">
            {paletteItems.length === 0 ? <div className="editor-command-empty">Kein passender Eintrag.</div> : null}
            {paletteItems.map((item, index) => {
              const title =
                item.kind === 'command'
                  ? item.command.title
                  : item.kind === 'tag-root'
                    ? item.title
                    : item.kind === 'link-root'
                      ? item.title
                      : item.kind === 'link-folder'
                        ? item.name
                        : item.kind === 'note-link'
                          ? item.target.title
                          : item.kind === 'tag-group'
                            ? item.group.displayName
                            : `${item.tag.displayName}`
              const description =
                item.kind === 'command'
                  ? item.command.description
                  : item.kind === 'tag-root'
                    ? item.description
                    : item.kind === 'link-root'
                      ? item.description
                      : item.kind === 'link-folder'
                        ? `${item.count} Einträge`
                        : item.kind === 'note-link'
                          ? `${item.target.noteType === 'task' ? 'Task' : 'Notiz'} - [[${item.target.target}]]`
                          : item.kind === 'tag-group'
                            ? `${item.group.id} Ã¢â‚¬Â¢ ${item.group.tags.length} Tags`
                            : `${item.group.displayName} (${item.group.id}) Ã¢â‚¬Â¢ {tag:${item.group.id}/${item.tag.id}}`
              const key =
                item.kind === 'command'
                  ? item.command.id
                  : item.kind === 'tag-root'
                    ? 'tag-root'
                    : item.kind === 'link-root'
                      ? 'link-root'
                      : item.kind === 'link-folder'
                        ? `link-folder-${item.pathParts.join('/')}`
                        : item.kind === 'note-link'
                          ? `note-link-${item.target.path}`
                          : item.kind === 'tag-group'
                            ? `group-${item.group.id}`
                            : item.kind === 'tag-direct'
                              ? `tag-direct-${item.group.id}-${item.tag.id}`
                              : `tag-${item.group.id}-${item.tag.id}`

              return (
                <button
                  ref={index === activeCommandIndex ? activePaletteItemRef : null}
                  key={key}
                  type="button"
                  className={`editor-command-item ${index === activeCommandIndex ? 'active' : ''}`}
                  onMouseDown={(event) => {
                    event.preventDefault()
                  }}
                  onClick={() => applyPaletteItemByIndex(index)}
                >
                  <span className="editor-command-title">{title}</span>
                  <span className="editor-command-desc">{description}</span>
                </button>
              )
            })}
            </div>
          ) : null}

          {paletteState.mode !== 'table-size' ? (
            <div className="editor-command-footnote">
            {paletteState.mode === 'slash'
              ? 'Pfeiltasten wählen - Enter ausführen - Esc schließen'
              : paletteState.mode === 'link-browse'
                ? 'Pfeiltasten wählen - Enter öffnen/einfuegen - Esc zurück'
              : paletteState.mode === 'tag-item'
                ? 'Pfeiltasten wählen - Enter einfügen - Esc zurück'
                : 'Pfeiltasten wählen - Enter ausführen - Esc schließen'}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
