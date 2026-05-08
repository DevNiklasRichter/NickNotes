import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, MutableRefObject } from 'react'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { javascript } from '@codemirror/lang-javascript'
import { markdown, markdownKeymap } from '@codemirror/lang-markdown'
import { bracketMatching, indentOnInput, LanguageDescription } from '@codemirror/language'
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search'
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
  filterMarkdownCommands,
  runMarkdownCommand,
  type MarkdownCommand,
  type MarkdownCommandId,
} from './editorCommands'
import { markdownKeyBindings } from './markdownCommands'
import { liveMarkdownPreview, markdownTagLookupExtension } from './markdownLivePreview'
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

export type MarkdownEditorApi = {
  insertText: (text: string) => void
  getSelectedText: () => string
  getMarkdown: () => string
  focus: () => void
  openCommandPalette: () => void
  runCommand: (commandId: MarkdownCommandId) => boolean
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

type SlashMatch = {
  from: number
  to: number
  query: string
}

type HoveredTagSuggestion = {
  key: string
  left: number
  top: number
}

const LOCAL_ECHO_TTL_MS = 2000
const LOCAL_ECHO_MAX_ITEMS = 12
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

const captureTagSuggestionDeco = Decoration.mark({
  class: 'cm-capture-tag-suggestion',
})

const captureTagSuggestionSelectedDeco = Decoration.mark({
  class: 'cm-capture-tag-suggestion selected',
})

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

function buildTagSuggestionHighlightExtension(
  suggestions: readonly MarkdownEditorTagSuggestion[],
  selectedKeys: readonly string[]
): Extension {
  const usableSuggestions = suggestions.filter((item) => item.source !== 'explicit')
  if (usableSuggestions.length === 0) {
    return []
  }

  const selected = new Set(selectedKeys)
  return ViewPlugin.fromClass(
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
        const ranges: ReturnType<typeof captureTagSuggestionDeco.range>[] = []
        const occupied = new Set<string>()
        for (const visibleRange of view.visibleRanges) {
          const end = Math.max(visibleRange.from, visibleRange.to - 1)
          let line = view.state.doc.lineAt(visibleRange.from)
          const endLine = view.state.doc.lineAt(end).number
          while (true) {
            for (const suggestion of usableSuggestions) {
              const decoration = selected.has(suggestion.key) ? captureTagSuggestionSelectedDeco : captureTagSuggestionDeco
              for (const term of buildTagSuggestionTerms(suggestion)) {
                const pattern = new RegExp(`\\b${escapeRegExp(term)}\\b`, 'gi')
                for (const match of line.text.matchAll(pattern)) {
                  if (typeof match.index !== 'number') {
                    continue
                  }
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
}

function findTagSuggestionAtPosition(
  view: EditorView,
  position: number,
  suggestions: readonly MarkdownEditorTagSuggestion[]
): MarkdownEditorTagSuggestion | null {
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
        if (offset >= match.index && offset <= match.index + match[0].length) {
          return suggestion
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
  const panelHeight = 340
  const left = Math.max(10, Math.min(coords.left - rect.left - 16, rect.width - panelWidth - 10))
  const preferredBelow = coords.bottom - rect.top + 8
  const maxTop = Math.max(10, rect.height - panelHeight - 10)
  const top =
    preferredBelow <= maxTop
      ? preferredBelow
      : Math.max(10, Math.min(maxTop, coords.top - rect.top - panelHeight - 8))
  return { left, top }
}

function clampIndex(index: number, itemCount: number): number {
  if (itemCount <= 0) {
    return 0
  }
  return Math.max(0, Math.min(index, itemCount - 1))
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
  tagSuggestions = [],
  selectedTagSuggestionKeys = [],
  onChange,
  onSubmitShortcut,
  onToggleTagSuggestion,
  onInsertImageAsset,
  onOpenWikiLink,
  onOpenTagReference,
  editorApiRef,
}: CodeMirrorMarkdownEditorProps) {
  const shellRef = useRef<HTMLDivElement | null>(null)
  const hostRef = useRef<HTMLDivElement | null>(null)
  const paletteInputRef = useRef<HTMLInputElement | null>(null)
  const editorRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  const onSubmitShortcutRef = useRef(onSubmitShortcut)
  const onToggleTagSuggestionRef = useRef(onToggleTagSuggestion)
  const onInsertImageAssetRef = useRef(onInsertImageAsset)
  const linkTargetsRef = useRef(linkTargets)
  const tagSuggestionsRef = useRef(tagSuggestions)
  const selectedTagSuggestionKeysRef = useRef(selectedTagSuggestionKeys)
  const syncingRef = useRef(false)
  const pendingDocRef = useRef<string | null>(null)
  const onChangeFrameRef = useRef<number | null>(null)
  const localEchoValuesRef = useRef<Array<{ value: string; at: number }>>([])
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
  const initialTagGroupsRef = useRef(tagGroups)
  const initialSearchHighlightQueryRef = useRef(searchHighlightQuery)
  const initialPlaceholderTextRef = useRef(placeholderText)
  const initialTagSuggestionsRef = useRef(tagSuggestions)
  const initialSelectedTagSuggestionKeysRef = useRef(selectedTagSuggestionKeys)
  const [paletteState, setPaletteState] = useState<PaletteState | null>(null)
  const [hoveredTagSuggestion, setHoveredTagSuggestion] = useState<HoveredTagSuggestion | null>(null)
  const paletteStateRef = useRef<PaletteState | null>(null)

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
        description: 'Fuegt ein hierarchisches Tag ({tag:gruppe/tag}) ein.',
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
    tagSuggestionsRef.current = tagSuggestions
  }, [tagSuggestions])

  useEffect(() => {
    selectedTagSuggestionKeysRef.current = selectedTagSuggestionKeys
  }, [selectedTagSuggestionKeys])

  const pruneLocalEchoValues = (now: number) => {
    localEchoValuesRef.current = localEchoValuesRef.current.filter((entry) => now - entry.at <= LOCAL_ECHO_TTL_MS)
    if (localEchoValuesRef.current.length > LOCAL_ECHO_MAX_ITEMS) {
      localEchoValuesRef.current = localEchoValuesRef.current.slice(-LOCAL_ECHO_MAX_ITEMS)
    }
  }

  const rememberLocalEchoValue = (nextValue: string) => {
    const now = Date.now()
    pruneLocalEchoValues(now)
    localEchoValuesRef.current.push({ value: nextValue, at: now })
    if (localEchoValuesRef.current.length > LOCAL_ECHO_MAX_ITEMS) {
      localEchoValuesRef.current = localEchoValuesRef.current.slice(-LOCAL_ECHO_MAX_ITEMS)
    }
  }

  const isRecentLocalEchoValue = (nextValue: string): boolean => {
    const now = Date.now()
    pruneLocalEchoValues(now)
    return localEchoValuesRef.current.some((entry) => entry.value === nextValue)
  }

  const flushQueuedOnChange = () => {
    if (onChangeFrameRef.current !== null) {
      window.cancelAnimationFrame(onChangeFrameRef.current)
      onChangeFrameRef.current = null
    }
    const queued = pendingDocRef.current
    pendingDocRef.current = null
    if (queued !== null) {
      rememberLocalEchoValue(queued)
      onChangeRef.current(queued)
    }
  }

  const scheduleOnChange = (nextValue: string) => {
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
  }

  useEffect(() => {
    onInsertImageAssetRef.current = onInsertImageAsset
  }, [onInsertImageAsset])

  useEffect(() => {
    linkTargetsRef.current = linkTargets
  }, [linkTargets])

  useEffect(() => {
    if (
      !paletteState ||
      (paletteState.mode !== 'palette' &&
        paletteState.mode !== 'tag-group' &&
        paletteState.mode !== 'tag-item' &&
        paletteState.mode !== 'link-browse')
    ) {
      return
    }
    window.requestAnimationFrame(() => {
      const input = paletteInputRef.current
      if (!input) {
        return
      }
      input.focus()
      const cursor = input.value.length
      input.setSelectionRange(cursor, cursor)
    })
  }, [paletteState?.mode])

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
              notePath: initialNotePathRef.current,
              backendUrl: initialBackendUrlRef.current,
              onOpenWikiLink,
              onOpenTagReference,
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
            mousemove: (event, view) => {
              const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
              const suggestion =
                typeof pos === 'number' ? findTagSuggestionAtPosition(view, pos, tagSuggestionsRef.current) : null
              if (!suggestion) {
                setHoveredTagSuggestion(null)
                return false
              }
              const shellRect = shellRef.current?.getBoundingClientRect()
              setHoveredTagSuggestion({
                key: suggestion.key,
                left: shellRect ? event.clientX - shellRect.left : event.clientX,
                top: shellRect ? event.clientY - shellRect.top + 12 : event.clientY + 12,
              })
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
  }, [editorApiRef])

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
          notePath,
          backendUrl,
          onOpenWikiLink,
          onOpenTagReference,
        })
      ),
    })
  }, [notePath, backendUrl, onOpenWikiLink, onOpenTagReference])

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
    if (currentValue === value) {
      return
    }
    if (isRecentLocalEchoValue(value)) {
      return
    }

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
  }, [value])

  const onPaletteInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (
      !paletteState ||
      (paletteState.mode !== 'palette' &&
        paletteState.mode !== 'tag-group' &&
        paletteState.mode !== 'tag-item' &&
        paletteState.mode !== 'link-browse')
    ) {
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
      paletteState.mode === 'link-browse')
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
  const hoveredSuggestion = hoveredTagSuggestion
    ? tagSuggestions.find((item) => item.key === hoveredTagSuggestion.key) ?? null
    : null
  const hoveredSuggestionSelected = hoveredSuggestion ? selectedTagSuggestionKeys.includes(hoveredSuggestion.key) : false

  return (
    <div
      className={`code-editor-shell ${embeddedInScroll ? 'embedded-scroll' : ''} ${className}`.trim()}
      ref={shellRef}
      onMouseLeave={() => {
        setHoveredTagSuggestion(null)
      }}
    >
      <div className={`code-editor-host ${embeddedInScroll ? 'embedded-scroll' : ''}`.trim()} ref={hostRef} />

      {hoveredSuggestion ? (
        <div
          className="editor-tag-suggestion-menu"
          style={{ left: `${hoveredTagSuggestion?.left ?? 0}px`, top: `${hoveredTagSuggestion?.top ?? 0}px` }}
          onMouseEnter={() => {
            setHoveredTagSuggestion((current) =>
              current && current.key === hoveredSuggestion.key ? current : hoveredTagSuggestion
            )
          }}
          onMouseLeave={() => {
            setHoveredTagSuggestion(null)
          }}
        >
          <span className="editor-tag-suggestion-title">
            {hoveredSuggestion.displayName} ({hoveredSuggestion.category})
          </span>
          <button
            type="button"
            onClick={() => {
              onToggleTagSuggestionRef.current?.(hoveredSuggestion.key)
              setHoveredTagSuggestion(null)
            }}
          >
            {hoveredSuggestionSelected ? 'Verwerfen' : 'Uebernehmen'}
          </button>
        </div>
      ) : null}

      {paletteState ? (
        <div
          className={`editor-command-palette ${isAnchoredPalette ? 'slash' : 'global'}`}
          style={isAnchoredPalette ? { left: `${paletteLeft}px`, top: `${paletteTop}px` } : undefined}
        >
          {showSearchInput ? (
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

          <div className="editor-command-list" role="listbox" aria-label="Markdown-Befehle">
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
                        ? `${item.count} Eintraege`
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

          <div className="editor-command-footnote">
            {paletteState.mode === 'slash'
              ? 'Pfeiltasten waehlen - Enter ausfuehren - Esc schliessen'
              : paletteState.mode === 'link-browse'
                ? 'Pfeiltasten waehlen - Enter oeffnen/einfuegen - Esc zurueck'
              : paletteState.mode === 'tag-item'
                ? 'Pfeiltasten waehlen - Enter einfuegen - Esc zurueck'
                : 'Pfeiltasten waehlen - Enter ausfuehren - Esc schliessen'}
          </div>
        </div>
      ) : null}
    </div>
  )
}
