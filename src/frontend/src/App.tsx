import { useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent, KeyboardEvent, MutableRefObject } from 'react'
import ToastEditor from '@toast-ui/editor'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import '@toast-ui/editor/dist/toastui-editor.css'
import '@toast-ui/editor/dist/theme/toastui-editor-dark.css'
import { ExplorerSidebar } from './explorer/ExplorerSidebarFlatV3'
import { TagSidebar } from './explorer/TagSidebarV2'
import type { ExplorerOptions } from './explorer/types'
import './App.css'

type VaultCounts = {
  notes: number
  openTasks: number
  doneTasks: number
}

type Suggestion = {
  key: string
  category: string
  slug: string
  displayName: string
  confidence: number
  source: string
  autoApply: boolean
}

type ParsedTask = {
  title: string
  dueDate: string | null
  priority: string
  status: string
  projectTag: string | null
  tags: string[]
}

type TaskRow = {
  id: string
  title: string
  status: string
  priority: string
  due_date: string | null
  project_tag: string | null
  updated_at: string
  path: string | null
}

type SearchRow = {
  id: string
  title: string
  note_type: string
  updated_at: string
  path: string
}

type ReviewDaily = {
  date: string
  new_notes: number
  open_tasks: number
  done_today: number
}

type ReviewWeekly = {
  from: string
  to: string
  notes_total: number
  tasks_open: number
  tasks_done: number
}

type BackendState = {
  vaultLoaded: boolean
  vaultPath?: string
  noteBasePath?: string
  counts?: VaultCounts
}

type ThemeMode = 'light' | 'dark'
type SidebarView = 'vault' | 'notes' | 'tags' | 'tasks' | 'review'
type NoteTabKind = 'note' | 'settings'

type NoteTab = {
  kind: NoteTabKind
  path: string
  title: string
  content: string
  loading: boolean
  dirty: boolean
}

type EditorTabContextMenuState = {
  x: number
  y: number
  path: string
} | null

const THEME_STORAGE_KEY = 'nicknotes-theme'
const DISPLAY_NAME_STORAGE_KEY = 'nicknotes-display-name'
const LAST_NOTEBASE_STORAGE_KEY = 'nicknotes-last-notebase-path'
const SIDEBAR_OPEN_STORAGE_KEY = 'nicknotes-sidebar-open'
const STATUS_BAR_PREFS_STORAGE_KEY = 'nicknotes-statusbar-prefs'
const EXPLORER_OPTIONS_STORAGE_KEY = 'nicknotes-explorer-options'
const EXPLORER_WIDTH_STORAGE_KEY = 'nicknotes-explorer-width'
const EDITOR_PANEL_OPEN_STORAGE_KEY = 'nicknotes-editor-panel-open'
const CAPTURE_PANEL_OPEN_STORAGE_KEY = 'nicknotes-capture-panel-open'
const CAPTURE_PINNED_STORAGE_KEY = 'nicknotes-capture-pinned'
const SETTINGS_TAB_PATH = '__nicknotes_settings__'

type StatusBarPrefs = {
  showNoteBaseName: boolean
  showOpenTasks: boolean
  showDueToday: boolean
  showTotalNotes: boolean
  showStateMessage: boolean
}

const DEFAULT_STATUS_BAR_PREFS: StatusBarPrefs = {
  showNoteBaseName: true,
  showOpenTasks: true,
  showDueToday: false,
  showTotalNotes: false,
  showStateMessage: true,
}

const DEFAULT_EXPLORER_OPTIONS: ExplorerOptions = {
  showHiddenFiles: false,
  showFileExtensions: true,
  sortMode: 'name',
  foldersFirst: true,
  showIcons: false,
  compactMode: true,
}

type TagGroupsMap = Record<string, string[]>
type NoteGroup = {
  key: string
  label: string
  path: string
  favorite: boolean
  canCreateNotes: boolean
  canCreateGroups?: boolean
  canDelete?: boolean
}

type MarkdownPreviewProps = {
  content: string
  emptyText?: string
  className?: string
  currentPath?: string
  resolveWikiLink?: (target: string, currentPath?: string) => SearchRow | null
  onOpenWikiLink?: (row: SearchRow) => void
}

type WysiwygEditorApi = {
  insertText: (text: string) => void
  getSelectedText: () => string
  focus: () => void
}

type MarkdownShortcutAction =
  | { command: 'heading'; payload: { level: number; headingType: 'atx' } }
  | { command: 'bulletList' | 'orderedList' | 'blockQuote' | 'codeBlock' | 'taskList' }

type InlineMarkdownMark = 'strong' | 'emph' | 'strike' | 'code'

type InlineMarkdownShortcutMatch = {
  mark: InlineMarkdownMark
  text: string
  fromOffset: number
  toOffset: number
}

const WIKI_LINK_HREF_PREFIX = 'wikilink://'

function detectMarkdownShortcutFromParagraph(text: string): MarkdownShortcutAction | null {
  if (/^#{1,6}$/.test(text)) {
    return {
      command: 'heading',
      payload: {
        level: text.length,
        headingType: 'atx',
      },
    }
  }

  if (/^[-*+]$/.test(text)) {
    return { command: 'bulletList' }
  }

  if (/^\d+[.)]$/.test(text)) {
    return { command: 'orderedList' }
  }

  if (text === '>') {
    return { command: 'blockQuote' }
  }

  if (text === '```') {
    return { command: 'codeBlock' }
  }

  return null
}

function detectInlineMarkdownAtCursor(text: string, cursorOffset: number): InlineMarkdownShortcutMatch | null {
  if (cursorOffset <= 0) {
    return null
  }

  const source = text.slice(0, cursorOffset)
  const patterns: Array<{ mark: InlineMarkdownMark; regex: RegExp }> = [
    { mark: 'strong', regex: /(^|\s)\*\*([^*\n][^*\n]*?)\*\*$/ },
    { mark: 'strike', regex: /(^|\s)~~([^~\n][^~\n]*?)~~$/ },
    { mark: 'code', regex: /(^|\s)`([^`\n]+)`$/ },
    { mark: 'emph', regex: /(^|\s)_([^_\n][^_\n]*?)_$/ },
    { mark: 'emph', regex: /(^|\s)\*([^*\n][^*\n]*?)\*$/ },
  ]

  for (const pattern of patterns) {
    const match = source.match(pattern.regex)
    if (!match) {
      continue
    }

    const leading = match[1] ?? ''
    const inner = match[2] ?? ''
    if (!inner) {
      continue
    }

    const fromOffset = source.length - match[0].length + leading.length
    const toOffset = source.length
    if (fromOffset < 0 || toOffset <= fromOffset) {
      continue
    }

    return {
      mark: pattern.mark,
      text: inner,
      fromOffset,
      toOffset,
    }
  }

  return null
}

function parseWikiLinkInner(rawInner: string): { target: string; alias: string | null } | null {
  const inner = rawInner.trim()
  if (!inner) {
    return null
  }

  const pipeIndex = inner.indexOf('|')
  const targetRaw = (pipeIndex >= 0 ? inner.slice(0, pipeIndex) : inner).trim()
  const aliasRaw = pipeIndex >= 0 ? inner.slice(pipeIndex + 1).trim() : ''
  const target = targetRaw.replace(/\\/g, '/').replace(/\.md$/i, '')
  if (!target) {
    return null
  }

  return { target, alias: aliasRaw || null }
}

function extractWikiLinks(content: string): Array<{ raw: string; target: string; alias: string | null }> {
  const matches: Array<{ raw: string; target: string; alias: string | null }> = []
  const pattern = /\[\[([^[\]\n]+)\]\]/g
  let current: RegExpExecArray | null = pattern.exec(content)

  while (current) {
    const raw = current[0]
    const parsed = parseWikiLinkInner(current[1] ?? '')
    if (parsed) {
      matches.push({ raw, target: parsed.target, alias: parsed.alias })
    }
    current = pattern.exec(content)
  }

  return matches
}

function toMarkdownWithWikiHref(content: string): string {
  return content.replace(/\[\[([^[\]\n]+)\]\]/g, (full, innerRaw: string) => {
    const parsed = parseWikiLinkInner(innerRaw)
    if (!parsed) {
      return full
    }

    const label = (parsed.alias ?? parsed.target).replace(/\[|\]/g, '').trim()
    if (!label) {
      return full
    }
    return `[${label}](${WIKI_LINK_HREF_PREFIX}${encodeURIComponent(parsed.target)})`
  })
}

function normalizeWikiLookup(value: string): string {
  return value.trim().replace(/\\/g, '/').replace(/\.md$/i, '').replace(/\s+/g, ' ').toLowerCase()
}

function normalizeWikiPath(value: string): string {
  const normalized = value.replace(/\\/g, '/')
  const segments: string[] = []
  for (const part of normalized.split('/')) {
    const chunk = part.trim()
    if (!chunk || chunk === '.') {
      continue
    }
    if (chunk === '..') {
      segments.pop()
      continue
    }
    segments.push(chunk)
  }
  return segments.join('/').replace(/\.md$/i, '').toLowerCase()
}

function chooseShortestPathRow(rows: SearchRow[], noteBasePath: string): SearchRow | null {
  if (rows.length === 0) {
    return null
  }
  return [...rows].sort(
    (left, right) =>
      getRelativeVaultPath(left.path, noteBasePath).length - getRelativeVaultPath(right.path, noteBasePath).length
  )[0]
}

function resolveWikiLinkTarget(
  target: string,
  rows: SearchRow[],
  noteBasePath: string,
  currentPath?: string
): SearchRow | null {
  const cleanTarget = target.split('#')[0]?.trim() ?? ''
  if (!cleanTarget) {
    return null
  }

  const normalizedTarget = normalizeWikiLookup(cleanTarget)
  if (!normalizedTarget) {
    return null
  }

  let relativeTarget = ''
  if (currentPath) {
    const currentRelative = getRelativeVaultPath(currentPath, noteBasePath).replace(/\\/g, '/')
    const currentDir = currentRelative.includes('/') ? currentRelative.slice(0, currentRelative.lastIndexOf('/')) : ''
    relativeTarget = normalizeWikiPath(currentDir ? `${currentDir}/${cleanTarget}` : cleanTarget)
  }

  const exact: SearchRow[] = []
  const relative: SearchRow[] = []
  const fuzzy: SearchRow[] = []
  const seen = new Set<string>()

  for (const row of rows) {
    if (seen.has(row.path)) {
      continue
    }
    seen.add(row.path)

    const displayName = toNoteDisplayName(row.path)
    const normalizedName = normalizeWikiLookup(displayName)
    const normalizedTitle = normalizeWikiLookup(row.title || displayName)
    const relativeNoExt = getRelativeVaultPath(row.path, noteBasePath).replace(/\.md$/i, '')
    const normalizedRelative = normalizeWikiPath(relativeNoExt)

    if (relativeTarget && normalizedRelative === relativeTarget) {
      relative.push(row)
      continue
    }

    if (
      normalizedName === normalizedTarget ||
      normalizedTitle === normalizedTarget ||
      normalizedRelative === normalizedTarget ||
      normalizedRelative.endsWith(`/${normalizedTarget}`)
    ) {
      exact.push(row)
      continue
    }

    if (
      normalizedName.includes(normalizedTarget) ||
      normalizedTitle.includes(normalizedTarget) ||
      normalizedRelative.includes(normalizedTarget)
    ) {
      fuzzy.push(row)
    }
  }

  return (
    chooseShortestPathRow(relative, noteBasePath) ||
    chooseShortestPathRow(exact, noteBasePath) ||
    chooseShortestPathRow(fuzzy, noteBasePath)
  )
}

function MarkdownPreview({
  content,
  emptyText = 'Leere Notiz.',
  className,
  currentPath,
  resolveWikiLink,
  onOpenWikiLink,
}: MarkdownPreviewProps) {
  const classes = className ? `markdown-preview ${className}` : 'markdown-preview'
  const renderedContent = useMemo(() => toMarkdownWithWikiHref(content), [content])

  if (!content.trim()) {
    return (
      <div className={classes}>
        <p className="empty-copy">{emptyText}</p>
      </div>
    )
  }

  return (
    <div className={classes}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => {
            if (href?.startsWith(WIKI_LINK_HREF_PREFIX) && resolveWikiLink) {
              const target = decodeURIComponent(href.slice(WIKI_LINK_HREF_PREFIX.length))
              const resolved = resolveWikiLink(target, currentPath)
              if (resolved && onOpenWikiLink) {
                return (
                  <button
                    className="markdown-wikilink"
                    onClick={(event) => {
                      event.preventDefault()
                      onOpenWikiLink(resolved)
                    }}
                  >
                    {children}
                  </button>
                )
              }
              return <span className="markdown-wikilink unresolved">{children}</span>
            }

            return (
              <a href={href} target="_blank" rel="noreferrer">
                {children}
              </a>
            )
          },
        }}
      >
        {renderedContent}
      </ReactMarkdown>
    </div>
  )
}

type WysiwygMarkdownEditorProps = {
  value: string
  theme: ThemeMode
  onChange: (nextValue: string) => void
  onOpenLink?: (href: string) => void
  editorApiRef: MutableRefObject<WysiwygEditorApi | null>
}

function WysiwygMarkdownEditor({ value, theme, onChange, onOpenLink, editorApiRef }: WysiwygMarkdownEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const editorRef = useRef<ToastEditor | null>(null)
  const onChangeRef = useRef(onChange)
  const onOpenLinkRef = useRef(onOpenLink)
  const initialValueRef = useRef(value)
  const syncingRef = useRef(false)
  const pendingChangeTimeoutRef = useRef<number | null>(null)
  const latestEditorMarkdownRef = useRef(value)
  const lastDispatchedMarkdownRef = useRef(value)

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    onOpenLinkRef.current = onOpenLink
  }, [onOpenLink])

  useEffect(() => {
    const host = hostRef.current
    if (!host) {
      return
    }

    const flushPendingChange = () => {
      if (pendingChangeTimeoutRef.current !== null) {
        window.clearTimeout(pendingChangeTimeoutRef.current)
        pendingChangeTimeoutRef.current = null
      }

      if (!editorRef.current || syncingRef.current) {
        return
      }

      const nextValue = latestEditorMarkdownRef.current || editorRef.current.getMarkdown()
      if (nextValue === lastDispatchedMarkdownRef.current) {
        return
      }

      lastDispatchedMarkdownRef.current = nextValue
      onChangeRef.current(nextValue)
    }

    const schedulePendingChange = () => {
      if (pendingChangeTimeoutRef.current !== null) {
        window.clearTimeout(pendingChangeTimeoutRef.current)
      }
      pendingChangeTimeoutRef.current = window.setTimeout(() => {
        flushPendingChange()
      }, 90)
    }

    const instance = new ToastEditor({
      el: host,
      height: '100%',
      minHeight: '100%',
      initialValue: initialValueRef.current,
      initialEditType: 'wysiwyg',
      hideModeSwitch: true,
      usageStatistics: false,
      autofocus: false,
      theme: theme === 'dark' ? 'dark' : 'light',
      toolbarItems: [
        ['heading', 'bold', 'italic', 'strike'],
        ['hr', 'quote'],
        ['ul', 'ol', 'task'],
        ['table', 'link'],
        ['code', 'codeblock'],
      ],
      events: {
        change: () => {
          if (!editorRef.current || syncingRef.current) {
            return
          }
          latestEditorMarkdownRef.current = editorRef.current.getMarkdown()
          schedulePendingChange()
        },
        blur: () => {
          flushPendingChange()
        },
        keydown: (editorType: 'markdown' | 'wysiwyg', event: globalThis.KeyboardEvent) => {
          if (
            editorType !== 'wysiwyg' ||
            event.defaultPrevented ||
            event.ctrlKey ||
            event.altKey ||
            event.metaKey
          ) {
            return
          }

          const inlineTriggerKey = [' ', '.', ',', '!', '?', ';', ':', ')'].includes(event.key) ? event.key : null
          if (event.key !== 'Enter' && !inlineTriggerKey) {
            return
          }

          const internal = editorRef.current as
            | (ToastEditor & { wwEditor?: { view?: { state: any; dispatch: (transaction: any) => void } } })
            | null
          const view = internal?.wwEditor?.view
          if (!view) {
            return
          }

          const state = view.state
          const selection = state?.selection
          if (!selection?.empty) {
            return
          }

          const from = selection.from
          const resolved = selection.$from
          const paragraph = resolved?.parent
          if (!paragraph || paragraph.type?.name !== 'paragraph') {
            return
          }

          if (resolved.parentOffset !== paragraph.textContent.length) {
            return
          }

          let shortcut: MarkdownShortcutAction | null = null
          if (event.key === ' ') {
            if (/^[-*+]\s\[(?: |x|X)\]$/.test(paragraph.textContent)) {
              shortcut = { command: 'taskList' }
            } else {
              shortcut = detectMarkdownShortcutFromParagraph(paragraph.textContent)
            }
          }
          if (event.key === 'Enter' && paragraph.textContent === '```') {
            shortcut = { command: 'codeBlock' }
          }

          if (shortcut) {
            event.preventDefault()
            const paragraphStart = from - resolved.parentOffset
            view.dispatch(state.tr.delete(paragraphStart, from))

            if (shortcut.command === 'heading') {
              instance.exec('heading', shortcut.payload)
            } else {
              instance.exec(shortcut.command)
            }

            latestEditorMarkdownRef.current = instance.getMarkdown()
            schedulePendingChange()
            return
          }

          if (!inlineTriggerKey) {
            return
          }

          const inlineShortcut = detectInlineMarkdownAtCursor(paragraph.textContent, resolved.parentOffset)
          if (!inlineShortcut) {
            return
          }

          const markType = state.schema?.marks?.[inlineShortcut.mark]
          if (!markType) {
            return
          }

          event.preventDefault()
          const paragraphStart = from - resolved.parentOffset
          const replaceFrom = paragraphStart + inlineShortcut.fromOffset
          const replaceTo = paragraphStart + inlineShortcut.toOffset

          let nextTr = state.tr.insertText(inlineShortcut.text, replaceFrom, replaceTo)
          const markEnd = replaceFrom + inlineShortcut.text.length
          nextTr = nextTr.addMark(replaceFrom, markEnd, markType.create())
          nextTr = nextTr.insertText(inlineTriggerKey, markEnd)
          view.dispatch(nextTr)

          latestEditorMarkdownRef.current = instance.getMarkdown()
          schedulePendingChange()
        },
      },
    })

    editorRef.current = instance
    latestEditorMarkdownRef.current = initialValueRef.current
    lastDispatchedMarkdownRef.current = initialValueRef.current
    editorApiRef.current = {
      insertText: (text: string) => instance.insertText(text),
      getSelectedText: () => instance.getSelectedText(),
      focus: () => instance.focus(),
    }

    const onHostClick = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof HTMLElement)) {
        return
      }
      const link = target.closest('a')
      if (!(link instanceof HTMLAnchorElement)) {
        return
      }
      const href = link.getAttribute('href') || ''
      if (!href || !onOpenLinkRef.current) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      onOpenLinkRef.current(href)
    }
    host.addEventListener('click', onHostClick)

    return () => {
      flushPendingChange()
      editorApiRef.current = null
      if (pendingChangeTimeoutRef.current !== null) {
        window.clearTimeout(pendingChangeTimeoutRef.current)
        pendingChangeTimeoutRef.current = null
      }
      host.removeEventListener('click', onHostClick)
      instance.destroy()
      editorRef.current = null
    }
  }, [editorApiRef, theme])

  useEffect(() => {
    const instance = editorRef.current
    if (!instance) {
      return
    }

    const currentValue = instance.getMarkdown()
    if (currentValue === value) {
      latestEditorMarkdownRef.current = value
      lastDispatchedMarkdownRef.current = value
      return
    }

    if (currentValue === latestEditorMarkdownRef.current && value !== latestEditorMarkdownRef.current) {
      return
    }

    syncingRef.current = true
    instance.setMarkdown(value, false)
    syncingRef.current = false
    latestEditorMarkdownRef.current = value
    lastDispatchedMarkdownRef.current = value
  }, [value])

  return <div className="wysiwyg-editor-host" ref={hostRef} />
}

function getPreferredTheme(): ThemeMode {
  if (typeof window === 'undefined') {
    return 'light'
  }

  const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY)
  if (storedTheme === 'light' || storedTheme === 'dark') {
    return storedTheme
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

async function apiRequest<T>(baseUrl: string, endpoint: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl}${endpoint}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })

  if (!response.ok) {
    const payload = await response.text()
    throw new Error(payload || `HTTP ${response.status}`)
  }

  return (await response.json()) as T
}

function toGermanTimestamp(value: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return value
  }

  return parsed.toLocaleString('de-DE', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function getFileName(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const parts = normalized.split('/')
  return parts[parts.length - 1] || path
}

function getPathTail(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '')
  const parts = normalized.split('/')
  return parts[parts.length - 1] || path
}

function toNoteDisplayName(path: string): string {
  return getFileName(path).replace(/\.md$/i, '')
}

function normalizeLabel(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

function isPermanentPinnedRootGroupKey(groupKey: string): boolean {
  const clean = groupKey.replace(/\\/g, '/').trim().replace(/^\/+|\/+$/g, '')
  if (!clean || clean.includes('/')) {
    return false
  }
  const token = clean.toLowerCase().replace(/^\d+_/, '')
  return token === 'daily' || token === 'tags' || token === 'tasks'
}

function toStorageTagGroups(value: unknown): TagGroupsMap {
  if (!value || typeof value !== 'object') {
    return {}
  }

  const result: TagGroupsMap = {}
  const candidate = value as Record<string, unknown>
  for (const [groupName, maybeTags] of Object.entries(candidate)) {
    if (typeof groupName !== 'string' || !Array.isArray(maybeTags)) {
      continue
    }

    const cleanGroup = normalizeLabel(groupName)
    if (!cleanGroup) {
      continue
    }

    const cleanTags = maybeTags
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => normalizeLabel(entry))
      .filter(Boolean)

    result[cleanGroup] = Array.from(new Set(cleanTags)).sort((left, right) =>
      left.localeCompare(right, 'de')
    )
  }

  return result
}

function getStoredDisplayName(): string {
  if (typeof window === 'undefined') {
    return 'Max'
  }

  try {
    const raw = window.localStorage.getItem(DISPLAY_NAME_STORAGE_KEY)
    if (!raw) {
      return 'Max'
    }
    const parsed = normalizeLabel(raw)
    return parsed || 'Max'
  } catch {
    return 'Max'
  }
}

function getStoredLastNoteBasePath(): string {
  if (typeof window === 'undefined') {
    return ''
  }

  try {
    return normalizeLabel(window.localStorage.getItem(LAST_NOTEBASE_STORAGE_KEY) || '')
  } catch {
    return ''
  }
}

function storeLastNoteBasePath(path: string): void {
  if (typeof window === 'undefined') {
    return
  }
  const cleanPath = normalizeLabel(path)
  if (!cleanPath) {
    return
  }
  try {
    window.localStorage.setItem(LAST_NOTEBASE_STORAGE_KEY, cleanPath)
  } catch {
    // Best effort.
  }
}

function clearStoredLastNoteBasePath(): void {
  if (typeof window === 'undefined') {
    return
  }
  try {
    window.localStorage.removeItem(LAST_NOTEBASE_STORAGE_KEY)
  } catch {
    // Best effort.
  }
}

function getStoredSidebarOpen(): boolean {
  if (typeof window === 'undefined') {
    return true
  }

  try {
    const raw = window.localStorage.getItem(SIDEBAR_OPEN_STORAGE_KEY)
    if (raw === '0') {
      return false
    }
    if (raw === '1') {
      return true
    }
  } catch {
    // Best effort fallback.
  }
  return true
}

function getStoredExplorerWidth(): number {
  if (typeof window === 'undefined') {
    return 300
  }

  try {
    const raw = window.localStorage.getItem(EXPLORER_WIDTH_STORAGE_KEY)
    const parsed = Number(raw)
    if (!Number.isFinite(parsed)) {
      return 300
    }
    return Math.max(220, Math.min(520, Math.round(parsed)))
  } catch {
    return 300
  }
}

function getStoredPanelOpen(key: string, fallback: boolean): boolean {
  if (typeof window === 'undefined') {
    return fallback
  }
  try {
    const raw = window.localStorage.getItem(key)
    if (raw === '1') {
      return true
    }
    if (raw === '0') {
      return false
    }
  } catch {
    // Best effort.
  }
  return fallback
}

function getStoredStatusBarPrefs(): StatusBarPrefs {
  if (typeof window === 'undefined') {
    return { ...DEFAULT_STATUS_BAR_PREFS }
  }

  try {
    const raw = window.localStorage.getItem(STATUS_BAR_PREFS_STORAGE_KEY)
    if (!raw) {
      return { ...DEFAULT_STATUS_BAR_PREFS }
    }
    const parsed = JSON.parse(raw) as Partial<StatusBarPrefs>
    return {
      showNoteBaseName: parsed.showNoteBaseName ?? DEFAULT_STATUS_BAR_PREFS.showNoteBaseName,
      showOpenTasks: parsed.showOpenTasks ?? DEFAULT_STATUS_BAR_PREFS.showOpenTasks,
      showDueToday: parsed.showDueToday ?? DEFAULT_STATUS_BAR_PREFS.showDueToday,
      showTotalNotes: parsed.showTotalNotes ?? DEFAULT_STATUS_BAR_PREFS.showTotalNotes,
      showStateMessage: parsed.showStateMessage ?? DEFAULT_STATUS_BAR_PREFS.showStateMessage,
    }
  } catch {
    return { ...DEFAULT_STATUS_BAR_PREFS }
  }
}

function getStoredExplorerOptions(): ExplorerOptions {
  if (typeof window === 'undefined') {
    return { ...DEFAULT_EXPLORER_OPTIONS }
  }

  try {
    const raw = window.localStorage.getItem(EXPLORER_OPTIONS_STORAGE_KEY)
    if (!raw) {
      return { ...DEFAULT_EXPLORER_OPTIONS }
    }
    const parsed = JSON.parse(raw) as Partial<ExplorerOptions>
    return {
      showHiddenFiles: parsed.showHiddenFiles ?? DEFAULT_EXPLORER_OPTIONS.showHiddenFiles,
      showFileExtensions: parsed.showFileExtensions ?? DEFAULT_EXPLORER_OPTIONS.showFileExtensions,
      sortMode:
        parsed.sortMode === 'modified' || parsed.sortMode === 'type' || parsed.sortMode === 'name'
          ? parsed.sortMode
          : DEFAULT_EXPLORER_OPTIONS.sortMode,
      foldersFirst: parsed.foldersFirst ?? DEFAULT_EXPLORER_OPTIONS.foldersFirst,
      showIcons: parsed.showIcons ?? DEFAULT_EXPLORER_OPTIONS.showIcons,
      compactMode: parsed.compactMode ?? DEFAULT_EXPLORER_OPTIONS.compactMode,
    }
  } catch {
    return { ...DEFAULT_EXPLORER_OPTIONS }
  }
}

function areStatusBarPrefsEqual(left: StatusBarPrefs, right: StatusBarPrefs): boolean {
  return (
    left.showNoteBaseName === right.showNoteBaseName &&
    left.showOpenTasks === right.showOpenTasks &&
    left.showDueToday === right.showDueToday &&
    left.showTotalNotes === right.showTotalNotes &&
    left.showStateMessage === right.showStateMessage
  )
}

function areExplorerOptionsEqual(left: ExplorerOptions, right: ExplorerOptions): boolean {
  return (
    left.showHiddenFiles === right.showHiddenFiles &&
    left.showFileExtensions === right.showFileExtensions &&
    left.sortMode === right.sortMode &&
    left.foldersFirst === right.foldersFirst &&
    left.showIcons === right.showIcons &&
    left.compactMode === right.compactMode
  )
}

function toLocalIsoDate(): string {
  const now = new Date()
  const offsetMinutes = now.getTimezoneOffset()
  const local = new Date(now.getTime() - offsetMinutes * 60 * 1000)
  return local.toISOString().slice(0, 10)
}

function getRelativeVaultPath(path: string, noteBasePath: string): string {
  const normalizedPath = path.replace(/\\/g, '/')
  const normalizedBase = noteBasePath.replace(/\\/g, '/').replace(/\/+$/, '')
  if (!normalizedBase) {
    return normalizedPath
  }

  if (normalizedPath.toLowerCase().startsWith(`${normalizedBase.toLowerCase()}/`)) {
    return normalizedPath.slice(normalizedBase.length + 1)
  }
  return normalizedPath
}

function parseTagFromNote(row: SearchRow): { group: string; tag: string } | null {
  const title = normalizeLabel(row.title)
  if (title.includes(':')) {
    const separatorIndex = title.indexOf(':')
    const group = normalizeLabel(title.slice(0, separatorIndex))
    const tag = normalizeLabel(title.slice(separatorIndex + 1))
    if (group && tag) {
      return { group, tag }
    }
  }

  const normalizedPath = row.path.replace(/\\/g, '/')
  const tagOverviewMatch = normalizedPath.match(/\/(?:tags|02_tags)\/([^/]+)\/([^/]+)\/overview\.md$/i)
  if (tagOverviewMatch) {
    const group = normalizeLabel(tagOverviewMatch[1].replace(/_/g, ' '))
    const tag = normalizeLabel(tagOverviewMatch[2].replace(/_/g, ' '))
    if (group && tag) {
      return { group, tag }
    }
  }

  return null
}

function App() {
  const autoOpenTriedRef = useRef(false)
  const explorerRecoveryRef = useRef(false)
  const [backendUrl, setBackendUrl] = useState('http://127.0.0.1:8765')
  const [theme, setTheme] = useState<ThemeMode>(getPreferredTheme)

  const [vaultPath, setVaultPath] = useState(getStoredLastNoteBasePath)
  const [vaultLoaded, setVaultLoaded] = useState(false)
  const [counts, setCounts] = useState<VaultCounts>({ notes: 0, openTasks: 0, doneTasks: 0 })

  const [captureText, setCaptureText] = useState('')
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [selectedTagKeys, setSelectedTagKeys] = useState<string[]>([])
  const [parsedTasks, setParsedTasks] = useState<ParsedTask[]>([])

  const [tasks, setTasks] = useState<TaskRow[]>([])
  const [searchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchRow[]>([])
  const [allNotes, setAllNotes] = useState<SearchRow[]>([])
  const [explorerFiles, setExplorerFiles] = useState<SearchRow[]>([])

  const [daily, setDaily] = useState<ReviewDaily | null>(null)
  const [weekly, setWeekly] = useState<ReviewWeekly | null>(null)

  const [sidebarView, setSidebarView] = useState<SidebarView>('notes')
  const [sidebarOpen, setSidebarOpen] = useState(getStoredSidebarOpen)
  const [displayName, setDisplayName] = useState(getStoredDisplayName)
  const [statusBarPrefs, setStatusBarPrefs] = useState<StatusBarPrefs>(getStoredStatusBarPrefs)
  const [explorerOptions, setExplorerOptions] = useState<ExplorerOptions>(getStoredExplorerOptions)
  const [savedTheme, setSavedTheme] = useState<ThemeMode>(getPreferredTheme)
  const [savedDisplayName, setSavedDisplayName] = useState(getStoredDisplayName)
  const [savedSidebarOpen, setSavedSidebarOpen] = useState(getStoredSidebarOpen)
  const [savedStatusBarPrefs, setSavedStatusBarPrefs] = useState<StatusBarPrefs>(getStoredStatusBarPrefs)
  const [savedExplorerOptions, setSavedExplorerOptions] = useState<ExplorerOptions>(getStoredExplorerOptions)
  const [explorerWidth, setExplorerWidth] = useState(getStoredExplorerWidth)
  const [editorPanelOpen, setEditorPanelOpen] = useState(() =>
    getStoredPanelOpen(EDITOR_PANEL_OPEN_STORAGE_KEY, true)
  )
  const [capturePanelOpen, setCapturePanelOpen] = useState(() =>
    getStoredPanelOpen(CAPTURE_PANEL_OPEN_STORAGE_KEY, true)
  )
  const [capturePinned, setCapturePinned] = useState(() => getStoredPanelOpen(CAPTURE_PINNED_STORAGE_KEY, true))
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({
    daily: true,
    tags: true,
    other: true,
  })
  const [customTagGroups, setCustomTagGroups] = useState<TagGroupsMap>({})
  const [noteGroups, setNoteGroups] = useState<NoteGroup[]>([])
  const [viewerDropActive, setViewerDropActive] = useState(false)

  const [openTabs, setOpenTabs] = useState<NoteTab[]>([])
  const [activeNotePath, setActiveNotePath] = useState('')
  const [splitView, setSplitView] = useState(false)
  const [compareNotePath, setCompareNotePath] = useState('')
  const [tabContextMenu, setTabContextMenu] = useState<EditorTabContextMenuState>(null)
  const [linkPickerOpen, setLinkPickerOpen] = useState(false)
  const [linkPickerQuery, setLinkPickerQuery] = useState('')
  const activeEditorRef = useRef<WysiwygEditorApi | null>(null)

  const [message, setMessage] = useState('Backend wird vorbereitet ...')
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true

    const init = async () => {
      try {
        if (window.nicknotes?.getBackendUrl) {
          const url = await window.nicknotes.getBackendUrl()
          if (active && url) {
            setBackendUrl(url)
          }
        }
      } catch {
        // Fallback to default URL.
      }
    }

    void init()

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    if (window.nicknotes?.setWindowTheme) {
      void window.nicknotes.setWindowTheme(theme).catch(() => {
        // Best effort bridge for desktop titlebar.
      })
    }
  }, [theme])

  useEffect(() => {
    try {
      window.localStorage.setItem(EXPLORER_WIDTH_STORAGE_KEY, String(explorerWidth))
    } catch {
      // Best effort.
    }
  }, [explorerWidth])

  useEffect(() => {
    try {
      window.localStorage.setItem(EDITOR_PANEL_OPEN_STORAGE_KEY, editorPanelOpen ? '1' : '0')
    } catch {
      // Best effort.
    }
  }, [editorPanelOpen])

  useEffect(() => {
    try {
      window.localStorage.setItem(CAPTURE_PANEL_OPEN_STORAGE_KEY, capturePanelOpen ? '1' : '0')
    } catch {
      // Best effort.
    }
  }, [capturePanelOpen])

  useEffect(() => {
    try {
      window.localStorage.setItem(CAPTURE_PINNED_STORAGE_KEY, capturePinned ? '1' : '0')
    } catch {
      // Best effort.
    }
  }, [capturePinned])

  const settingsDirty = useMemo(
    () =>
      theme !== savedTheme ||
      displayName !== savedDisplayName ||
      sidebarOpen !== savedSidebarOpen ||
      !areStatusBarPrefsEqual(statusBarPrefs, savedStatusBarPrefs) ||
      !areExplorerOptionsEqual(explorerOptions, savedExplorerOptions),
    [
      displayName,
      explorerOptions,
      savedDisplayName,
      savedExplorerOptions,
      savedSidebarOpen,
      savedStatusBarPrefs,
      savedTheme,
      sidebarOpen,
      statusBarPrefs,
      theme,
    ]
  )

  const refreshTasks = async (force = false) => {
    if (!vaultLoaded && !force) {
      return
    }

    const response = await apiRequest<{ items: TaskRow[] }>(backendUrl, '/tasks?include_done=false')
    setTasks(response.items)
  }

  const refreshExplorerFiles = async (force = false) => {
    if (!vaultLoaded && !force) {
      return
    }

    try {
      const response = await apiRequest<{ items: SearchRow[] }>(backendUrl, '/explorer/files')
      setExplorerFiles(response.items)
    } catch {
      // Fallback: Explorer can still render indexed rows.
    }
  }

  const runSearch = async (query: string, force = false) => {
    if (!vaultLoaded && !force) {
      return
    }

    const cleanQuery = query.trim()
    try {
      const response = await apiRequest<{ items: SearchRow[] }>(
        backendUrl,
        `/search?query=${encodeURIComponent(query)}`
      )
      setSearchResults(response.items)
      if (!cleanQuery) {
        setAllNotes(response.items)
        return
      }

      void apiRequest<{ items: SearchRow[] }>(backendUrl, '/search?query=')
        .then((allResponse) => {
          setAllNotes(allResponse.items)
        })
        .catch(() => {
          // Best effort refresh for wikilinks.
        })
    } catch (caught) {
      setError(String(caught))
      if (!cleanQuery) {
        setSearchResults([])
        setAllNotes([])
      }
    } finally {
      if (!cleanQuery) {
        await refreshExplorerFiles(force)
      }
    }
  }

  const refreshAllNotes = async (force = false) => {
    if (!vaultLoaded && !force) {
      return
    }

    try {
      const response = await apiRequest<{ items: SearchRow[] }>(backendUrl, '/search?query=')
      setAllNotes(response.items)
    } catch (caught) {
      setError(String(caught))
      setAllNotes([])
    }
  }

  const refreshReview = async (force = false) => {
    if (!vaultLoaded && !force) {
      return
    }

    const response = await apiRequest<{ daily: ReviewDaily; weekly: ReviewWeekly }>(backendUrl, '/review')
    setDaily(response.daily)
    setWeekly(response.weekly)
  }

  const refreshTagGroups = async (force = false) => {
    if (!vaultLoaded && !force) {
      return
    }

    const response = await apiRequest<{ groups: TagGroupsMap }>(backendUrl, '/tag-groups')
    setCustomTagGroups(toStorageTagGroups(response.groups))
  }

  const refreshNoteGroups = async (force = false) => {
    if (!vaultLoaded && !force) {
      return
    }

    try {
      const response = await apiRequest<{ groups: NoteGroup[] }>(backendUrl, '/note-groups')
      setNoteGroups(response.groups)
    } catch (caught) {
      setError(String(caught))
      setNoteGroups([])
    }
  }

  const refreshExplorerSidebarData = async (force = false) => {
    if (!vaultLoaded && !force) {
      return
    }
    await Promise.allSettled([refreshNoteGroups(force), refreshAllNotes(force), refreshExplorerFiles(force)])
  }

  const refreshWorkspaceData = async (force = false) => {
    if (!vaultLoaded && !force) {
      return
    }
    await Promise.allSettled([
      refreshTasks(force),
      runSearch(searchQuery, force),
      refreshReview(force),
      refreshTagGroups(force),
      refreshExplorerSidebarData(force),
    ])
  }

  const openVaultAtPath = async (rawPath: string, successMessage: string): Promise<boolean> => {
    const path = normalizeLabel(rawPath)
    if (!path) {
      throw new Error('Bitte zuerst einen NoteBase-Pfad angeben.')
    }

    const response = await apiRequest<{
      counts: VaultCounts
      noteBasePath?: string
      tagGroups?: TagGroupsMap
    }>(backendUrl, '/notebase/open', {
      method: 'POST',
      body: JSON.stringify({ path }),
    })
    const loadedPath = response.noteBasePath ?? path
    setVaultPath(loadedPath)
    setVaultLoaded(true)
    setCounts(response.counts)
    if (response.tagGroups) {
      setCustomTagGroups(toStorageTagGroups(response.tagGroups))
    }
    storeLastNoteBasePath(loadedPath)
    setMessage(successMessage)
    setError('')

    await refreshWorkspaceData(true)
    return true
  }

  const loadState = async () => {
    try {
      const state = await apiRequest<BackendState>(backendUrl, '/state')
      if (!state.vaultLoaded) {
        setVaultLoaded(false)
        const rememberedPath = getStoredLastNoteBasePath()
        if (rememberedPath && !autoOpenTriedRef.current) {
          autoOpenTriedRef.current = true
          setVaultPath(rememberedPath)
          try {
            await openVaultAtPath(rememberedPath, 'Letzte NoteBase automatisch geladen.')
            return
          } catch (autoOpenError) {
            setError(String(autoOpenError))
          }
        }
        setMessage('Keine NoteBase geladen.')
        return
      }

      setVaultLoaded(true)
      const loadedPath = state.noteBasePath ?? state.vaultPath ?? ''
      setVaultPath(loadedPath)
      storeLastNoteBasePath(loadedPath)
      if (state.counts) {
        setCounts(state.counts)
      }
      setMessage('NoteBase geladen.')
      setError('')

      await refreshWorkspaceData(true)
    } catch (caught) {
      setError(`Backend nicht erreichbar: ${String(caught)}`)
    }
  }

  useEffect(() => {
    void loadState()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backendUrl])

  useEffect(() => {
    if (!vaultLoaded) {
      setAllNotes([])
      setExplorerFiles([])
      setLinkPickerOpen(false)
      setLinkPickerQuery('')
      setTabContextMenu(null)
    }
  }, [vaultLoaded])

  useEffect(() => {
    if (!tabContextMenu) {
      return
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof HTMLElement && target.closest('.editor-tab-context-menu')) {
        return
      }
      setTabContextMenu(null)
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
    }
  }, [tabContextMenu])

  useEffect(() => {
    if (!vaultLoaded) {
      return
    }

    if (!captureText.trim()) {
      setSuggestions([])
      setSelectedTagKeys([])
      setParsedTasks([])
      return
    }

    const timeout = window.setTimeout(() => {
      void previewCapture(captureText)
    }, 260)

    return () => {
      window.clearTimeout(timeout)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [captureText, vaultLoaded])

  useEffect(() => {
    if (openTabs.length === 0) {
      setActiveNotePath('')
      setCompareNotePath('')
      setSplitView(false)
      return
    }

    if (!openTabs.some((tab) => tab.path === activeNotePath)) {
      setActiveNotePath(openTabs[openTabs.length - 1].path)
    }

    if (compareNotePath && !openTabs.some((tab) => tab.kind === 'note' && tab.path === compareNotePath)) {
      setCompareNotePath('')
    }

    if (openTabs.filter((tab) => tab.kind === 'note').length < 2 && splitView) {
      setSplitView(false)
    }
  }, [activeNotePath, compareNotePath, openTabs, splitView])

  useEffect(() => {
    setOpenTabs((prev) =>
      prev.map((tab) => {
        if (tab.path !== SETTINGS_TAB_PATH || tab.dirty === settingsDirty) {
          return tab
        }
        return { ...tab, dirty: settingsDirty }
      })
    )
  }, [settingsDirty])

  const chosenTags = useMemo(() => new Set(selectedTagKeys), [selectedTagKeys])

  const sortedNotes = useMemo(() => {
    return [...searchResults].sort((left, right) => {
      const leftTime = new Date(left.updated_at).getTime()
      const rightTime = new Date(right.updated_at).getTime()
      return rightTime - leftTime
    })
  }, [searchResults])

  const linkIndexRows = useMemo(() => {
    const source = allNotes.length > 0 ? allNotes : sortedNotes
    const deduped = new Map<string, SearchRow>()
    for (const row of source) {
      deduped.set(row.path, row)
    }
    return Array.from(deduped.values())
  }, [allNotes, sortedNotes])

  const explorerRows = useMemo(() => {
    const deduped = new Map<string, SearchRow>()
    for (const row of linkIndexRows) {
      deduped.set(row.path, row)
    }
    for (const row of explorerFiles) {
      if (!deduped.has(row.path)) {
        deduped.set(row.path, row)
      }
    }
    return Array.from(deduped.values())
  }, [explorerFiles, linkIndexRows])

  useEffect(() => {
    if (!vaultLoaded) {
      explorerRecoveryRef.current = false
      return
    }
    if (noteGroups.length > 0 || explorerRows.length > 0) {
      explorerRecoveryRef.current = false
      return
    }
    if (explorerRecoveryRef.current) {
      return
    }

    explorerRecoveryRef.current = true
    void (async () => {
      try {
        await apiRequest(backendUrl, '/notebase/reindex', { method: 'POST' })
      } catch {
        // Best effort reindex.
      }
      await refreshExplorerSidebarData(true)
      explorerRecoveryRef.current = false
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backendUrl, vaultLoaded, noteGroups.length, explorerRows.length])

  const wikiTitleCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const row of linkIndexRows) {
      const key = normalizeWikiLookup(toNoteDisplayName(row.path))
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return counts
  }, [linkIndexRows])

  const noteGroupsByKey = useMemo(() => {
    const byKey = new Map<string, NoteGroup>()
    for (const group of noteGroups) {
      byKey.set(group.key, group)
    }
    return byKey
  }, [noteGroups])

  const discoveredTagGroups = useMemo(() => {
    const result: TagGroupsMap = {}
    for (const row of sortedNotes) {
      const parsed = parseTagFromNote(row)
      if (!parsed) {
        continue
      }

      if (!result[parsed.group]) {
        result[parsed.group] = []
      }
      result[parsed.group].push(parsed.tag)
    }

    for (const [group, tags] of Object.entries(result)) {
      result[group] = Array.from(new Set(tags)).sort((left, right) => left.localeCompare(right, 'de'))
    }

    return result
  }, [sortedNotes])

  const mergedTagGroups = useMemo(() => {
    const merged: TagGroupsMap = {}
    const allGroups = new Set([...Object.keys(discoveredTagGroups), ...Object.keys(customTagGroups)])

    for (const group of allGroups) {
      const combined = [...(discoveredTagGroups[group] ?? []), ...(customTagGroups[group] ?? [])]
      merged[group] = Array.from(new Set(combined)).sort((left, right) => left.localeCompare(right, 'de'))
    }

    return merged
  }, [customTagGroups, discoveredTagGroups])

  const sortedTagGroupNames = useMemo(
    () => Object.keys(mergedTagGroups).sort((left, right) => left.localeCompare(right, 'de')),
    [mergedTagGroups]
  )

  const activeTab = openTabs.find((tab) => tab.path === activeNotePath) ?? openTabs[0] ?? null
  const openNoteTabs = openTabs.filter((tab) => tab.kind === 'note')
  const dirtyFilePaths = useMemo(
    () => new Set(openNoteTabs.filter((tab) => tab.dirty).map((tab) => tab.path)),
    [openNoteTabs]
  )
  const compareCandidates = openNoteTabs.filter((tab) => tab.path !== activeTab?.path)
  const compareTab =
    splitView && activeTab?.kind === 'note'
      ? openNoteTabs.find((tab) => tab.path === compareNotePath) ?? compareCandidates[0] ?? null
      : null
  const noteBaseName = useMemo(() => (vaultPath ? getPathTail(vaultPath) : 'Keine NoteBase'), [vaultPath])
  const settingsTabOpen = openTabs.some((tab) => tab.path === SETTINGS_TAB_PATH)
  const tabContextTarget = tabContextMenu ? openTabs.find((tab) => tab.path === tabContextMenu.path) ?? null : null
  const dueTodayCount = useMemo(() => {
    const today = toLocalIsoDate()
    return tasks.filter((task) => task.status !== 'done' && task.due_date === today).length
  }, [tasks])
  const resolveWikiLink = (target: string, currentPath?: string): SearchRow | null =>
    resolveWikiLinkTarget(target, linkIndexRows, vaultPath, currentPath)

  const toWikiTargetForRow = (row: SearchRow): string => {
    const noteName = toNoteDisplayName(row.path)
    const duplicateCount = wikiTitleCounts.get(normalizeWikiLookup(noteName)) ?? 0
    if (duplicateCount <= 1) {
      return noteName
    }
    return getRelativeVaultPath(row.path, vaultPath).replace(/\.md$/i, '')
  }

  const activeWikiLinks = useMemo(() => {
    if (!activeTab || activeTab.kind !== 'note') {
      return [] as Array<{
        raw: string
        target: string
        alias: string | null
        resolved: SearchRow | null
      }>
    }

    const unique = new Map<string, { raw: string; target: string; alias: string | null; resolved: SearchRow | null }>()
    for (const link of extractWikiLinks(activeTab.content)) {
      const key = normalizeWikiLookup(link.target)
      if (unique.has(key)) {
        continue
      }
      unique.set(key, {
        ...link,
        resolved: resolveWikiLinkTarget(link.target, linkIndexRows, vaultPath, activeTab.path),
      })
    }
    return Array.from(unique.values())
  }, [activeTab, linkIndexRows, vaultPath])

  const linkPickerCandidates = useMemo(() => {
    const query = normalizeWikiLookup(linkPickerQuery)
    const rows = linkIndexRows.filter((row) => (activeTab?.kind === 'note' ? row.path !== activeTab.path : true))
    if (!query) {
      return rows.slice(0, 60)
    }

    return rows
      .filter((row) => {
        const noteName = normalizeWikiLookup(toNoteDisplayName(row.path))
        const relative = normalizeWikiLookup(getRelativeVaultPath(row.path, vaultPath))
        return noteName.includes(query) || relative.includes(query)
      })
      .slice(0, 60)
  }, [activeTab, linkIndexRows, linkPickerQuery, vaultPath])
  const normalizedLinkPickerQuery = normalizeWikiLookup(linkPickerQuery)
  const linkPickerHasExactMatch = linkPickerCandidates.some(
    (row) => normalizeWikiLookup(toWikiTargetForRow(row)) === normalizedLinkPickerQuery
  )

  const pickDirectory = async (): Promise<string | null> => {
    if (!window.nicknotes?.selectDirectory) {
      return window.prompt('Bitte absoluten Pfad eingeben:') || null
    }
    return window.nicknotes.selectDirectory()
  }

  const createVault = async () => {
    try {
      setError('')
      const parentPath = await pickDirectory()
      if (!parentPath) {
        return
      }

      const preferredName = window.prompt('Wie sollen wir dich nennen?', displayName)?.trim()
      const effectiveName = normalizeLabel(preferredName || '') || displayName
      if (preferredName) {
        setDisplayName(effectiveName)
      }

      const name = window.prompt('Name der neuen NoteBase:', `${effectiveName}NoteBase`)?.trim()
      if (!name) {
        return
      }

      const response = await apiRequest<{
        vaultPath: string
        noteBasePath?: string
        counts: VaultCounts
        tagGroups?: TagGroupsMap
      }>(
        backendUrl,
        '/notebase/create',
        {
          method: 'POST',
          body: JSON.stringify({ parentPath, name }),
        }
      )

      setVaultPath(response.noteBasePath ?? response.vaultPath)
      setVaultLoaded(true)
      setCounts(response.counts)
      storeLastNoteBasePath(response.noteBasePath ?? response.vaultPath)
      if (response.tagGroups) {
        setCustomTagGroups(toStorageTagGroups(response.tagGroups))
      }
      setMessage(`Neue NoteBase erstellt: ${response.noteBasePath ?? response.vaultPath}`)
      await refreshWorkspaceData(true)
    } catch (caught) {
      setError(String(caught))
    }
  }

  const pickAndOpenVault = async () => {
    try {
      setError('')
      const path = await pickDirectory()
      if (!path) {
        return
      }
      setVaultPath(path)
      await openVaultAtPath(path, 'NoteBase automatisch geladen.')
    } catch (caught) {
      setError(String(caught))
    }
  }

  const saveSettings = (): boolean => {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme)
      window.localStorage.setItem(DISPLAY_NAME_STORAGE_KEY, displayName)
      window.localStorage.setItem(SIDEBAR_OPEN_STORAGE_KEY, sidebarOpen ? '1' : '0')
      window.localStorage.setItem(STATUS_BAR_PREFS_STORAGE_KEY, JSON.stringify(statusBarPrefs))
      window.localStorage.setItem(EXPLORER_OPTIONS_STORAGE_KEY, JSON.stringify(explorerOptions))
      setSavedTheme(theme)
      setSavedDisplayName(displayName)
      setSavedSidebarOpen(sidebarOpen)
      setSavedStatusBarPrefs({ ...statusBarPrefs })
      setSavedExplorerOptions({ ...explorerOptions })
      setMessage('Einstellungen gespeichert.')
      setError('')
      return true
    } catch (caught) {
      setError(String(caught))
      return false
    }
  }

  const discardSettings = () => {
    setTheme(savedTheme)
    setDisplayName(savedDisplayName)
    setSidebarOpen(savedSidebarOpen)
    setStatusBarPrefs({ ...savedStatusBarPrefs })
    setExplorerOptions({ ...savedExplorerOptions })
    setMessage('Nicht gespeicherte Einstellungen verworfen.')
  }

  const openSettingsTab = () => {
    const existing = openTabs.find((tab) => tab.path === SETTINGS_TAB_PATH)
    if (existing) {
      setEditorPanelOpen(true)
      setActiveNotePath(SETTINGS_TAB_PATH)
      return
    }

    setOpenTabs((prev) => [
      ...prev,
      {
        kind: 'settings',
        path: SETTINGS_TAB_PATH,
        title: 'Einstellungen',
        content: '',
        loading: false,
        dirty: settingsDirty,
      },
    ])
    setEditorPanelOpen(true)
    setActiveNotePath(SETTINGS_TAB_PATH)
  }

  const saveNoteTab = async (path: string): Promise<boolean> => {
    const targetTab = openTabs.find((tab) => tab.path === path)
    if (!targetTab || targetTab.kind !== 'note' || targetTab.loading || !targetTab.dirty) {
      return true
    }

    try {
      setError('')
      const response = await apiRequest<{ counts: VaultCounts; tagGroups?: TagGroupsMap }>(
        backendUrl,
        '/notes/save',
        {
          method: 'POST',
          body: JSON.stringify({ path: targetTab.path, content: targetTab.content }),
        }
      )
      setCounts(response.counts)
      if (response.tagGroups) {
        setCustomTagGroups(toStorageTagGroups(response.tagGroups))
      }
      setOpenTabs((prev) =>
        prev.map((tab) => {
          if (tab.path !== path) {
            return tab
          }
          return { ...tab, dirty: false }
        })
      )
      setMessage(`Notiz gespeichert: ${targetTab.title}`)
      await Promise.all([runSearch(searchQuery), refreshTasks(), refreshReview(), refreshNoteGroups()])
      return true
    } catch (caught) {
      setError(String(caught))
      return false
    }
  }

  const saveTab = async (path: string): Promise<boolean> => {
    const targetTab = openTabs.find((tab) => tab.path === path)
    if (!targetTab) {
      return true
    }
    if (targetTab.kind === 'settings') {
      return saveSettings()
    }
    return saveNoteTab(path)
  }

  const renameNoteBase = async () => {
    const newName = normalizeLabel(window.prompt('Neuer Name fuer die NoteBase', noteBaseName) ?? '')
    if (!newName || newName === noteBaseName) {
      return
    }

    try {
      setError('')
      const previousName = noteBaseName
      const response = await apiRequest<{
        counts: VaultCounts
        vaultPath: string
        noteBasePath?: string
        tagGroups?: TagGroupsMap
      }>(backendUrl, '/notebase/rename', {
        method: 'POST',
        body: JSON.stringify({ newName }),
      })
      const loadedPath = response.noteBasePath ?? response.vaultPath
      setVaultPath(loadedPath)
      setVaultLoaded(true)
      setCounts(response.counts)
      setOpenTabs([])
      setActiveNotePath('')
      setSplitView(false)
      setCompareNotePath('')
      storeLastNoteBasePath(loadedPath)
      if (response.tagGroups) {
        setCustomTagGroups(toStorageTagGroups(response.tagGroups))
      }
      setMessage(`NoteBase umbenannt: ${previousName} -> ${getPathTail(loadedPath)}`)
      await Promise.all([refreshTasks(true), runSearch(searchQuery, true), refreshReview(true), refreshNoteGroups(true)])
    } catch (caught) {
      setError(String(caught))
    }
  }

  const deleteNoteBase = async () => {
    if (!window.confirm(`Soll die NoteBase "${noteBaseName}" wirklich mit allen Dateien geloescht werden?`)) {
      return
    }
    const secondCheck = normalizeLabel(
      window.prompt('Bitte "LOESCHEN" eingeben, um das vollstaendige Loeschen zu bestaetigen.', '') ?? ''
    )
    if (secondCheck.toUpperCase() !== 'LOESCHEN') {
      setMessage('Loeschen abgebrochen.')
      return
    }

    try {
      setError('')
      const response = await apiRequest<{ deleted: boolean; deletedPath: string }>(backendUrl, '/notebase/delete', {
        method: 'POST',
        body: JSON.stringify({ confirmDelete: true }),
      })
      setVaultLoaded(false)
      setVaultPath('')
      setCounts({ notes: 0, openTasks: 0, doneTasks: 0 })
      setTasks([])
      setSearchResults([])
      setSuggestions([])
      setSelectedTagKeys([])
      setParsedTasks([])
      setOpenTabs([])
      setActiveNotePath('')
      setSplitView(false)
      setCompareNotePath('')
      setCustomTagGroups({})
      setNoteGroups([])
      clearStoredLastNoteBasePath()
      setMessage(`NoteBase geloescht: ${response.deletedPath}`)
    } catch (caught) {
      setError(String(caught))
    }
  }

  const previewCapture = async (text: string) => {
    if (!vaultLoaded) {
      return
    }

    try {
      const response = await apiRequest<{
        suggestions: Suggestion[]
        tasks: ParsedTask[]
      }>(backendUrl, '/capture/preview', {
        method: 'POST',
        body: JSON.stringify({ text }),
      })

      setSuggestions(response.suggestions)
      setParsedTasks(response.tasks)

      setSelectedTagKeys((prev) => {
        const previous = new Set(prev)
        const next: string[] = []
        for (const item of response.suggestions) {
          if (previous.has(item.key) || item.autoApply || item.source === 'explicit') {
            next.push(item.key)
          }
        }
        return next
      })
    } catch (caught) {
      setError(String(caught))
    }
  }

  const saveCapture = async () => {
    try {
      const text = captureText.trim()
      if (!text) {
        return
      }

      const response = await apiRequest<{ counts: VaultCounts; noteId: string }>(
        backendUrl,
        '/capture/save',
        {
          method: 'POST',
          body: JSON.stringify({
            text,
            selectedTagKeys,
          }),
        }
      )

      setCounts(response.counts)
      setCaptureText('')
      setSuggestions([])
      setSelectedTagKeys([])
      setParsedTasks([])
      setMessage(`Capture gespeichert (${response.noteId}).`)
      await Promise.all([refreshTasks(), runSearch(searchQuery), refreshReview(), refreshNoteGroups()])
    } catch (caught) {
      setError(String(caught))
    }
  }

  const markTaskDone = async (taskId: string) => {
    try {
      await apiRequest(backendUrl, `/tasks/${encodeURIComponent(taskId)}/done`, {
        method: 'POST',
      })
      setMessage(`Task ${taskId} als erledigt markiert.`)
      await Promise.all([refreshTasks(), refreshReview(), runSearch(searchQuery)])
    } catch (caught) {
      setError(String(caught))
    }
  }

  const fetchNoteContent = async (path: string): Promise<string> => {
    const response = await apiRequest<{ content: string }>(
      backendUrl,
      `/notes/content?path=${encodeURIComponent(path)}`
    )
    return response.content
  }

  const openNoteInTab = async (path: string, suggestedTitle?: string) => {
    const fallbackTitle = suggestedTitle?.trim() || getFileName(path)
    const existing = openTabs.find((tab) => tab.path === path)
    if (existing) {
      setEditorPanelOpen(true)
      setActiveNotePath(path)
      return
    }

    setOpenTabs((prev) => [
      ...prev,
      {
        kind: 'note',
        path,
        title: fallbackTitle,
        content: '',
        loading: true,
        dirty: false,
      },
    ])
    setEditorPanelOpen(true)
    setActiveNotePath(path)

    try {
      const content = await fetchNoteContent(path)
      setOpenTabs((prev) =>
        prev.map((tab) =>
          tab.path === path
            ? {
                ...tab,
                title: fallbackTitle,
                content,
                loading: false,
                dirty: false,
              }
            : tab
        )
      )
    } catch (caught) {
      setOpenTabs((prev) => prev.filter((tab) => tab.path !== path))
      setError(String(caught))
    }
  }

  const confirmCloseTab = async (path: string): Promise<boolean> => {
    const tab = openTabs.find((candidate) => candidate.path === path)
    if (!tab) {
      return true
    }
    if (tab.kind !== 'note' || !tab.dirty) {
      return true
    }

    const decision = (window.prompt(
      `Die Notiz "${tab.title}" hat ungespeicherte Aenderungen.\n1 = Speichern\n2 = Verwerfen\n3 = Abbrechen`,
      '1'
    ) || '')
      .trim()
      .toLowerCase()

    if (decision === '1' || decision === 's' || decision === 'speichern') {
      return await saveTab(path)
    }
    if (decision === '2' || decision === 'v' || decision === 'verwerfen') {
      return true
    }
    return false
  }

  const closeEditorTab = async (path: string) => {
    const canClose = await confirmCloseTab(path)
    if (!canClose) {
      return
    }
    setOpenTabs((prev) => prev.filter((tab) => tab.path !== path))
    if (compareNotePath === path) {
      setCompareNotePath('')
    }
    setTabContextMenu(null)
  }

  const openNoteInCurrentEditor = async (path: string, suggestedTitle?: string) => {
    const currentPath = activeTab?.kind === 'note' ? activeTab.path : ''
    if (currentPath && currentPath !== path) {
      const canCloseCurrent = await confirmCloseTab(currentPath)
      if (!canCloseCurrent) {
        return
      }
    }
    await openNoteInTab(path, suggestedTitle)
    if (currentPath && currentPath !== path) {
      setOpenTabs((prev) => prev.filter((tab) => tab.path !== currentPath))
    }
    setSplitView(false)
    setCompareNotePath('')
  }

  const showNoteInSplitView = (path: string) => {
    if (openNoteTabs.length < 2) {
      return
    }
    const targetPath = path === activeNotePath ? openNoteTabs.find((tab) => tab.path !== path)?.path ?? '' : path
    if (!targetPath) {
      return
    }
    setCompareNotePath(targetPath)
    setSplitView(true)
    setTabContextMenu(null)
  }

  const updateActiveNoteContent = (nextContent: string) => {
    if (!activeTab || activeTab.kind !== 'note') {
      return
    }
    const tabPath = activeTab.path
    setOpenTabs((prev) =>
      prev.map((tab) => {
        if (tab.path !== tabPath || tab.kind !== 'note') {
          return tab
        }
        return { ...tab, content: nextContent, dirty: true }
      })
    )
  }

  const openWikiLinkPicker = () => {
    if (!activeTab || activeTab.kind !== 'note') {
      return
    }
    setLinkPickerQuery('')
    setLinkPickerOpen(true)
  }

  const insertWikiLink = (target: string) => {
    const editor = activeEditorRef.current
    const cleanTarget = normalizeLabel(target)
    if (!editor || !cleanTarget) {
      return
    }

    editor.insertText(`[[${cleanTarget}]]`)
    editor.focus()
    setMessage(`Wikilink eingefuegt: [[${cleanTarget}]]`)
    setLinkPickerOpen(false)
    setLinkPickerQuery('')
  }

  const insertWikiLinkForRow = (row: SearchRow) => {
    insertWikiLink(toWikiTargetForRow(row))
  }

  const followSelectedWikiLink = () => {
    if (!activeTab || activeTab.kind !== 'note') {
      return
    }

    const selected = normalizeLabel(activeEditorRef.current?.getSelectedText() || '')
    if (!selected) {
      setMessage('Bitte erst einen Wikilink oder Notiznamen markieren.')
      return
    }

    const bracketMatch = selected.match(/^\[\[([^[\]]+)\]\]$/)
    const selectedTarget = bracketMatch ? bracketMatch[1] : selected
    const parsed = parseWikiLinkInner(selectedTarget)
    const resolved = resolveWikiLink(parsed?.target ?? selectedTarget, activeTab.path)
    if (!resolved) {
      setMessage(`Kein Ziel fuer "${selectedTarget}" gefunden.`)
      return
    }

    void openNoteInTab(resolved.path, toNoteDisplayName(resolved.path))
  }

  const handleEditorLinkOpen = (href: string) => {
    if (!activeTab || activeTab.kind !== 'note') {
      return
    }

    const cleanHref = href.trim()
    if (!cleanHref || cleanHref.startsWith('#')) {
      return
    }

    if (/^https?:\/\//i.test(cleanHref)) {
      window.open(cleanHref, '_blank', 'noopener,noreferrer')
      return
    }

    const decoded = decodeURIComponent(cleanHref)
    const target = decoded.startsWith(WIKI_LINK_HREF_PREFIX)
      ? decodeURIComponent(decoded.slice(WIKI_LINK_HREF_PREFIX.length))
      : decoded

    const resolved = resolveWikiLink(target.replace(/\.md$/i, ''), activeTab.path)
    if (resolved) {
      void openNoteInTab(resolved.path, toNoteDisplayName(resolved.path))
      return
    }

    if (/^file:\/\//i.test(decoded)) {
      window.open(decoded, '_blank', 'noopener,noreferrer')
    }
  }

  const toggleFolder = (folderKey: string) => {
    setExpandedFolders((prev) => ({ ...prev, [folderKey]: !prev[folderKey] }))
  }

  const setFolderOpen = (folderKey: string) => {
    setExpandedFolders((prev) => ({ ...prev, [folderKey]: true }))
  }

  const getDraggedNoteData = (event: DragEvent<HTMLElement>) => {
    const notePath =
      event.dataTransfer.getData('application/x-note-path') ||
      event.dataTransfer.getData('application/x-open-tab-path') ||
      event.dataTransfer.getData('text/plain')
    const noteTitle =
      event.dataTransfer.getData('application/x-note-title') ||
      event.dataTransfer.getData('application/x-open-tab-title')

    const cleanPath = normalizeLabel(notePath)
    if (!cleanPath) {
      return null
    }

    return {
      path: cleanPath,
      title: normalizeLabel(noteTitle) || undefined,
    }
  }

  const normalizePath = (value: string): string => value.replace(/\\/g, '/').replace(/\/+$/g, '')

  const remapOpenNotePaths = (fromPrefix: string, toPrefix: string) => {
    const cleanFrom = normalizePath(fromPrefix)
    const cleanTo = normalizePath(toPrefix)
    if (!cleanFrom || !cleanTo || cleanFrom === cleanTo) {
      return
    }

    const rewritePath = (path: string): string => {
      if (!path || path === SETTINGS_TAB_PATH) {
        return path
      }
      const normalized = normalizePath(path)
      const lower = normalized.toLowerCase()
      const fromLower = cleanFrom.toLowerCase()
      if (lower !== fromLower && !lower.startsWith(`${fromLower}/`)) {
        return path
      }
      return `${cleanTo}${normalized.slice(cleanFrom.length)}`
    }

    setOpenTabs((prev) =>
      prev.map((tab) => {
        if (tab.kind !== 'note') {
          return tab
        }
        const nextPath = rewritePath(tab.path)
        if (nextPath === tab.path) {
          return tab
        }
        return {
          ...tab,
          path: nextPath,
          title: toNoteDisplayName(nextPath),
        }
      })
    )
    setActiveNotePath((prev) => rewritePath(prev))
    setCompareNotePath((prev) => rewritePath(prev))
  }

  const createExplorerFolder = async (parentGroupKey: string, groupName: string) => {
    const cleanGroupName = normalizeLabel(groupName)
    if (!cleanGroupName) {
      return
    }

    const effectiveParentKey = parentGroupKey && noteGroupsByKey.has(parentGroupKey) ? parentGroupKey : ''
    const targetGroup = noteGroupsByKey.get(effectiveParentKey)
    if (targetGroup?.canCreateGroups === false) {
      setMessage('In diesem Ordner koennen keine neuen Unterordner angelegt werden.')
      return
    }

    try {
      setError('')
      const response = await apiRequest<{ group: NoteGroup; groups: NoteGroup[] }>(backendUrl, '/note-groups/add-group', {
        method: 'POST',
        body: JSON.stringify({ groupName: cleanGroupName, parentKey: effectiveParentKey }),
      })
      setNoteGroups(response.groups)
      setMessage(`Ordner angelegt: ${response.group.label}`)
    } catch (caught) {
      setError(String(caught))
    }
  }

  const createExplorerFile = async (groupKey: string, title: string) => {
    const cleanTitle = normalizeLabel(title)
    if (!cleanTitle) {
      return
    }

    const effectiveGroupKey = groupKey && noteGroupsByKey.has(groupKey) ? groupKey : ''
    const targetGroup = noteGroupsByKey.get(effectiveGroupKey)
    if (targetGroup?.canCreateNotes === false) {
      setMessage('In diesem Ordner koennen keine neuen Notizen angelegt werden.')
      return
    }

    try {
      setError('')
      const response = await apiRequest<{ noteId: string; notePath: string; groups: NoteGroup[]; counts: VaultCounts }>(
        backendUrl,
        '/note-groups/add-note',
        {
          method: 'POST',
          body: JSON.stringify({ groupKey: effectiveGroupKey, title: cleanTitle }),
        }
      )
      setCounts(response.counts)
      setNoteGroups(response.groups)
      setMessage(`Notiz erstellt (${response.noteId}).`)
      await Promise.all([runSearch(searchQuery), refreshReview()])
      await openNoteInTab(response.notePath, cleanTitle)
    } catch (caught) {
      setError(String(caught))
    }
  }

  const renameExplorerFolder = async (groupKey: string, newName: string) => {
    const cleanName = normalizeLabel(newName)
    const group = noteGroupsByKey.get(groupKey)
    if (!group || !cleanName || cleanName === group.label || group.canDelete === false) {
      return
    }

    try {
      setError('')
      const response = await apiRequest<{ group: NoteGroup; groups: NoteGroup[]; counts: VaultCounts }>(
        backendUrl,
        '/note-groups/rename',
        {
          method: 'POST',
          body: JSON.stringify({ groupKey, newName: cleanName }),
        }
      )
      setNoteGroups(response.groups)
      setCounts(response.counts)
      remapOpenNotePaths(group.path, response.group.path)
      setMessage(`Ordner umbenannt: ${response.group.label}`)
      await Promise.all([runSearch(searchQuery), refreshTasks(), refreshReview()])
    } catch (caught) {
      setError(String(caught))
    }
  }

  const moveExplorerFolder = async (groupKey: string, targetParentKey: string) => {
    const sourceGroup = noteGroupsByKey.get(groupKey)
    if (!sourceGroup || sourceGroup.canDelete === false) {
      return
    }

    const targetParent = noteGroupsByKey.get(targetParentKey)
    if (targetParent?.canCreateGroups === false) {
      setMessage('In diesen Zielordner kann nicht verschoben werden.')
      return
    }

    try {
      setError('')
      const response = await apiRequest<{ group: NoteGroup; groups: NoteGroup[]; counts: VaultCounts }>(
        backendUrl,
        '/note-groups/move',
        {
          method: 'POST',
          body: JSON.stringify({ groupKey, targetParentKey }),
        }
      )
      setNoteGroups(response.groups)
      setCounts(response.counts)
      remapOpenNotePaths(sourceGroup.path, response.group.path)
      setMessage(`Ordner verschoben: ${response.group.label}`)
      await Promise.all([runSearch(searchQuery), refreshTasks(), refreshReview()])
    } catch (caught) {
      setError(String(caught))
    }
  }

  const deleteExplorerFolder = async (groupKey: string) => {
    const group = noteGroupsByKey.get(groupKey)
    if (!group || group.canDelete === false) {
      return
    }

    try {
      setError('')
      const response = await apiRequest<{ deleted: boolean; groups: NoteGroup[]; counts: VaultCounts }>(
        backendUrl,
        '/note-groups/delete',
        {
          method: 'POST',
          body: JSON.stringify({ groupKey }),
        }
      )
      setNoteGroups(response.groups)
      setCounts(response.counts)
      const groupPath = normalizePath(group.path)
      const groupPathLower = groupPath.toLowerCase()
      setOpenTabs((prev) =>
        prev.filter((tab) => {
          if (tab.kind !== 'note') {
            return true
          }
          const tabPath = normalizePath(tab.path).toLowerCase()
          return tabPath !== groupPathLower && !tabPath.startsWith(`${groupPathLower}/`)
        })
      )
      setMessage(`Ordner geloescht: ${group.label}`)
      await Promise.all([runSearch(searchQuery), refreshTasks(), refreshReview()])
    } catch (caught) {
      setError(String(caught))
    }
  }

  const toggleFavoriteFolder = async (groupKey: string) => {
    const group = noteGroupsByKey.get(groupKey)
    if (!group) {
      return
    }
    if (group.favorite && isPermanentPinnedRootGroupKey(group.key)) {
      setMessage('Die Ordner daily, tags und tasks sind immer fixiert.')
      return
    }

    try {
      setError('')
      const endpoint = group.favorite ? '/note-groups/unfavorite' : '/note-groups/favorite'
      const response = await apiRequest<{ groups: NoteGroup[] }>(backendUrl, endpoint, {
        method: 'POST',
        body: JSON.stringify({ groupKey }),
      })
      setNoteGroups(response.groups)
      setMessage(group.favorite ? 'Fixierung aufgehoben.' : 'Ordner fixiert.')
    } catch (caught) {
      setError(String(caught))
    }
  }

  const renameExplorerFile = async (path: string, newName: string) => {
    const cleanName = normalizeLabel(newName)
    if (!cleanName) {
      return
    }

    try {
      setError('')
      const response = await apiRequest<{ renamedPath: string; counts: VaultCounts }>(backendUrl, '/notes/rename', {
        method: 'POST',
        body: JSON.stringify({ path, newName: cleanName }),
      })
      setCounts(response.counts)
      remapOpenNotePaths(path, response.renamedPath)
      setMessage(`Datei umbenannt: ${toNoteDisplayName(response.renamedPath)}`)
      await Promise.all([runSearch(searchQuery), refreshTasks(), refreshReview()])
    } catch (caught) {
      setError(String(caught))
    }
  }

  const moveExplorerFile = async (path: string, targetGroupKey: string) => {
    try {
      setError('')
      const response = await apiRequest<{ movedPath: string; counts: VaultCounts }>(backendUrl, '/notes/move', {
        method: 'POST',
        body: JSON.stringify({ path, targetGroupKey }),
      })
      setCounts(response.counts)
      remapOpenNotePaths(path, response.movedPath)
      setMessage(`Datei verschoben: ${toNoteDisplayName(response.movedPath)}`)
      await Promise.all([runSearch(searchQuery), refreshTasks(), refreshReview()])
    } catch (caught) {
      setError(String(caught))
    }
  }

  const deleteExplorerFile = async (path: string) => {
    try {
      setError('')
      const response = await apiRequest<{ deleted: boolean; counts: VaultCounts }>(backendUrl, '/notes/delete', {
        method: 'POST',
        body: JSON.stringify({ path }),
      })
      setCounts(response.counts)
      setOpenTabs((prev) => prev.filter((tab) => tab.path !== path))
      setMessage(`Datei geloescht: ${toNoteDisplayName(path)}`)
      await Promise.all([runSearch(searchQuery), refreshTasks(), refreshReview()])
    } catch (caught) {
      setError(String(caught))
    }
  }

  const createTagGroup = async () => {
    const nextGroupName = normalizeLabel(window.prompt('Name der neuen Tag-Gruppe', 'Neue Gruppe') ?? '')
    if (!nextGroupName) {
      return
    }

    const duplicate = sortedTagGroupNames.find((name) => name.toLowerCase() === nextGroupName.toLowerCase())
    if (duplicate) {
      setMessage(`Die Tag-Gruppe "${duplicate}" existiert bereits.`)
      return
    }

    try {
      setError('')
      const response = await apiRequest<{ groups: TagGroupsMap }>(backendUrl, '/tag-groups/add-group', {
        method: 'POST',
        body: JSON.stringify({ groupName: nextGroupName }),
      })
      setCustomTagGroups(toStorageTagGroups(response.groups))
      setFolderOpen(`tag-group-${nextGroupName}`)
      setMessage(`Tag-Gruppe angelegt: ${nextGroupName}`)
    } catch (caught) {
      setError(String(caught))
    }
  }

  const createTagInExistingGroup = async (preferredGroup: string | null) => {
    if (sortedTagGroupNames.length === 0) {
      setMessage('Lege zuerst eine Tag-Gruppe an.')
      return
    }

    const requestedGroup = normalizeLabel(
      window.prompt('Tag in welcher bestehenden Gruppe anlegen?', preferredGroup ?? sortedTagGroupNames[0] ?? '') ?? ''
    )
    if (!requestedGroup) {
      return
    }
    const groupName = sortedTagGroupNames.find((name) => name.toLowerCase() === requestedGroup.toLowerCase())
    if (!groupName) {
      setMessage(`Tag-Gruppe "${requestedGroup}" wurde nicht gefunden.`)
      return
    }

    const tagName = normalizeLabel(window.prompt(`Neuer Tag in "${groupName}"`, 'Neuer Tag') ?? '')
    if (!tagName) {
      return
    }
    const duplicateTag = (mergedTagGroups[groupName] ?? []).find((name) => name.toLowerCase() === tagName.toLowerCase())
    if (duplicateTag) {
      setMessage(`Der Tag "${duplicateTag}" existiert in "${groupName}" bereits.`)
      return
    }

    try {
      setError('')
      const response = await apiRequest<{ groups: TagGroupsMap }>(backendUrl, '/tag-groups/add-tag', {
        method: 'POST',
        body: JSON.stringify({ groupName, tagName }),
      })
      setCustomTagGroups(toStorageTagGroups(response.groups))
      setFolderOpen(`tag-group-${groupName}`)
      setMessage(`Tag hinzugefuegt: ${groupName}:${tagName}`)
    } catch (caught) {
      setError(String(caught))
    }
  }

  const renameTagGroup = async (groupName: string) => {
    const newGroupName = normalizeLabel(window.prompt(`Tag-Gruppe umbenennen (${groupName})`, groupName) ?? '')
    if (!newGroupName || newGroupName.toLowerCase() === groupName.toLowerCase()) {
      return
    }
    const duplicateGroup = sortedTagGroupNames.find(
      (name) => name.toLowerCase() === newGroupName.toLowerCase() && name.toLowerCase() !== groupName.toLowerCase()
    )
    if (duplicateGroup) {
      setMessage(`Die Tag-Gruppe "${duplicateGroup}" existiert bereits.`)
      return
    }

    const applyToNotes = window.confirm(
      `Sollen bestehende Notiz-Tags von "${groupName}:*" automatisch auf "${newGroupName}:*" umgestellt werden?`
    )

    try {
      setError('')
      const response = await apiRequest<{ groups: TagGroupsMap; notesUpdated: number; counts: VaultCounts }>(
        backendUrl,
        '/tag-groups/rename-group',
        {
          method: 'POST',
          body: JSON.stringify({ groupName, newGroupName, applyToNotes }),
        }
      )
      setCustomTagGroups(toStorageTagGroups(response.groups))
      setCounts(response.counts)
      setFolderOpen(`tag-group-${newGroupName}`)
      setMessage(
        applyToNotes
          ? `Tag-Gruppe umbenannt und ${response.notesUpdated} Notizen aktualisiert.`
          : 'Tag-Gruppe umbenannt. Historische Notiz-Tags wurden beibehalten.'
      )
      await Promise.all([runSearch(searchQuery), refreshReview()])
    } catch (caught) {
      setError(String(caught))
    }
  }

  const deleteTagGroup = async (groupName: string) => {
    const option = window.prompt(
      `Tag-Gruppe "${groupName}" loeschen:\n1 = Tags auch aus bestehenden Notizen entfernen\n2 = nur aus der Tag-Verwaltung loeschen`,
      '2'
    )
    if (!option || !['1', '2'].includes(option.trim())) {
      return
    }
    const removeFromNotes = option.trim() === '1'

    try {
      setError('')
      const response = await apiRequest<{ groups: TagGroupsMap; notesUpdated: number; counts: VaultCounts }>(
        backendUrl,
        '/tag-groups/delete-group',
        {
          method: 'POST',
          body: JSON.stringify({ groupName, removeFromNotes }),
        }
      )
      setCustomTagGroups(toStorageTagGroups(response.groups))
      setCounts(response.counts)
      setMessage(
        removeFromNotes
          ? `Tag-Gruppe geloescht und Tags aus ${response.notesUpdated} Notizen entfernt.`
          : 'Tag-Gruppe aus der Tag-Verwaltung entfernt. Historische Notiz-Tags wurden beibehalten.'
      )
      await Promise.all([runSearch(searchQuery), refreshReview()])
    } catch (caught) {
      setError(String(caught))
    }
  }

  const renameTag = async (groupName: string, tagName: string) => {
    const newTagName = window.prompt(`Tag umbenennen (${groupName}:${tagName})`, tagName)?.trim()
    if (!newTagName || newTagName === tagName) {
      return
    }
    const applyToNotes = window.confirm(
      `Soll "${groupName}:${tagName}" in allen Notizen automatisch in "${groupName}:${newTagName}" umbenannt werden?`
    )

    try {
      setError('')
      const response = await apiRequest<{ groups: TagGroupsMap; notesUpdated: number; counts: VaultCounts }>(
        backendUrl,
        '/tag-groups/rename-tag',
        {
          method: 'POST',
          body: JSON.stringify({ groupName, tagName, newTagName, applyToNotes }),
        }
      )
      setCustomTagGroups(toStorageTagGroups(response.groups))
      setCounts(response.counts)
      setMessage(
        applyToNotes
          ? `Tag umbenannt und ${response.notesUpdated} Notizen aktualisiert.`
          : 'Tag umbenannt. Historische Notiz-Tags wurden beibehalten.'
      )
      await Promise.all([runSearch(searchQuery), refreshReview()])
    } catch (caught) {
      setError(String(caught))
    }
  }

  const deleteTag = async (groupName: string, tagName: string) => {
    const option = window.prompt(
      `Tag "${groupName}:${tagName}" loeschen:\n1 = auch aus bestehenden Notizen entfernen\n2 = nur aus der Tag-Verwaltung loeschen`,
      '2'
    )
    if (!option || !['1', '2'].includes(option.trim())) {
      return
    }
    const removeFromNotes = option.trim() === '1'

    try {
      setError('')
      const response = await apiRequest<{ groups: TagGroupsMap; notesUpdated: number; counts: VaultCounts }>(
        backendUrl,
        '/tag-groups/delete-tag',
        {
          method: 'POST',
          body: JSON.stringify({ groupName, tagName, removeFromNotes }),
        }
      )
      setCustomTagGroups(toStorageTagGroups(response.groups))
      setCounts(response.counts)
      setMessage(
        removeFromNotes
          ? `Tag geloescht und aus ${response.notesUpdated} Notizen entfernt.`
          : 'Tag aus der Tag-Verwaltung entfernt. Historische Notiz-Tags wurden beibehalten.'
      )
      await Promise.all([runSearch(searchQuery), refreshReview()])
    } catch (caught) {
      setError(String(caught))
    }
  }

  const handleViewerDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault()
    setViewerDropActive(false)
    const payload = getDraggedNoteData(event)
    if (!payload) {
      return
    }
    void openNoteInTab(payload.path, payload.title)
  }

  const toggleSplitView = () => {
    if (activeTab?.kind !== 'note' || openNoteTabs.length < 2) {
      return
    }

    setSplitView((previous) => {
      if (!previous && !compareNotePath) {
        const candidate = openNoteTabs.find((tab) => tab.path !== activeNotePath)
        if (candidate) {
          setCompareNotePath(candidate.path)
        }
      }
      return !previous
    })
  }

  const toggleEditorPanel = () => {
    setEditorPanelOpen((previous) => !previous)
  }

  const closeCapturePanel = () => {
    setCapturePanelOpen(false)
  }

  const toggleCapturePinned = () => {
    setCapturePinned((previous) => {
      if (previous) {
        setCapturePanelOpen(false)
        return false
      }
      setCapturePanelOpen(true)
      return true
    })
  }

  const openCaptureFromDock = () => {
    setCapturePinned(true)
    setCapturePanelOpen(true)
  }

  const setThemeMode = (nextMode: ThemeMode) => {
    setTheme(nextMode)
  }

  const openSidebarView = (view: SidebarView) => {
    if (sidebarView === view) {
      setSidebarOpen((prev) => !prev)
      return
    }

    setSidebarView(view)
    setSidebarOpen(true)
  }

  const onQuickCaptureKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void saveCapture()
    }
  }

  useEffect(() => {
    const onGlobalKeyDown = (event: globalThis.KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        if (!activeTab) {
          return
        }
        void saveTab(activeTab.path)
        return
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        if (activeTab?.kind !== 'note') {
          return
        }
        event.preventDefault()
        openWikiLinkPicker()
        return
      }

      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        if (activeTab?.kind !== 'note') {
          return
        }
        event.preventDefault()
        followSelectedWikiLink()
      }
    }

    window.addEventListener('keydown', onGlobalKeyDown)
    return () => {
      window.removeEventListener('keydown', onGlobalKeyDown)
    }
  }, [activeTab, followSelectedWikiLink, openWikiLinkPicker, saveTab])

  const renderSidebarContent = () => {
    if (sidebarView === 'vault') {
      return (
        <div className="sidebar-content">
          <h3>Board</h3>
          <p className="muted-label">Aktive NoteBase</p>
          <div className="active-notebase-row">
            <strong>{noteBaseName || 'Keine NoteBase'}</strong>
            <div className="hover-menu-anchor">
              <button className="icon-button compact muted" title="NoteBase-Menue">
                ...
              </button>
              <div className="hover-menu">
                <button onClick={() => void renameNoteBase()}>NoteBase umbenennen</button>
                <button className="danger" onClick={() => void deleteNoteBase()}>
                  NoteBase loeschen
                </button>
              </div>
            </div>
          </div>

          <div className="stacked-actions">
            <button onClick={() => void pickAndOpenVault()}>NoteBase laden</button>
            <button onClick={() => void createVault()}>NoteBase anlegen</button>
          </div>
        </div>
      )
    }

    if (sidebarView === 'tasks') {
      return (
        <div className="sidebar-content">
          <div className="sidebar-header-row">
            <h3>Tasks</h3>
            <button onClick={() => void refreshTasks()} disabled={!vaultLoaded}>
              Aktualisieren
            </button>
          </div>

          <div className="task-list">
            {tasks.length === 0 ? <p className="empty-copy">Keine offenen Tasks.</p> : null}
            {tasks.map((task) => (
              <article key={task.id} className="task-item">
                <header>
                  <strong>{task.title}</strong>
                  <span>{task.priority}</span>
                </header>
                <p>
                  {task.status}
                  {task.due_date ? ` | due ${task.due_date}` : ''}
                </p>
                <p className="muted-copy">{toGermanTimestamp(task.updated_at)}</p>
                <button onClick={() => void markTaskDone(task.id)} disabled={task.status === 'done'}>
                  Done
                </button>
              </article>
            ))}
          </div>
        </div>
      )
    }

    if (sidebarView === 'review') {
      return (
        <div className="sidebar-content">
          <div className="sidebar-header-row">
            <h3>Review</h3>
            <button onClick={() => void refreshReview()} disabled={!vaultLoaded}>
              Aktualisieren
            </button>
          </div>

          <section className="review-card">
            <h4>Daily</h4>
            {daily ? (
              <>
                <p>Datum: {daily.date}</p>
                <p>Neue Notizen: {daily.new_notes}</p>
                <p>Offene Tasks: {daily.open_tasks}</p>
                <p>Heute erledigt: {daily.done_today}</p>
              </>
            ) : (
              <p className="empty-copy">Keine Daily-Daten.</p>
            )}
          </section>

          <section className="review-card">
            <h4>Weekly</h4>
            {weekly ? (
              <>
                <p>
                  Zeitraum: {weekly.from} bis {weekly.to}
                </p>
                <p>Notizen gesamt: {weekly.notes_total}</p>
                <p>Tasks offen: {weekly.tasks_open}</p>
                <p>Tasks erledigt: {weekly.tasks_done}</p>
              </>
            ) : (
              <p className="empty-copy">Keine Weekly-Daten.</p>
            )}
          </section>
        </div>
      )
    }

    if (sidebarView === 'tags') {
      return (
        <TagSidebar
          vaultLoaded={vaultLoaded}
          width={explorerWidth}
          onWidthChange={setExplorerWidth}
          sortedGroupNames={sortedTagGroupNames}
          tagGroups={mergedTagGroups}
          expandedGroups={expandedFolders}
          onToggleGroup={toggleFolder}
          onCreateGroup={() => {
            void createTagGroup()
          }}
          onCreateTag={(groupName) => {
            void createTagInExistingGroup(groupName)
          }}
          onRenameGroup={(groupName) => {
            void renameTagGroup(groupName)
          }}
          onDeleteGroup={(groupName) => {
            void deleteTagGroup(groupName)
          }}
          onRenameTag={(groupName, tagName) => {
            void renameTag(groupName, tagName)
          }}
          onDeleteTag={(groupName, tagName) => {
            void deleteTag(groupName, tagName)
          }}
        />
      )
    }

    return (
      <ExplorerSidebar
        vaultLoaded={vaultLoaded}
        vaultPath={vaultPath}
        groups={noteGroups}
        files={explorerRows}
        activeFilePath={activeTab?.kind === 'note' ? activeTab.path : ''}
        dirtyFilePaths={dirtyFilePaths}
        width={explorerWidth}
        onWidthChange={setExplorerWidth}
        onOpenFile={openNoteInTab}
        onPreviewFile={openNoteInCurrentEditor}
        onCreateFile={createExplorerFile}
        onCreateFolder={createExplorerFolder}
        onRenameFile={renameExplorerFile}
        onRenameFolder={renameExplorerFolder}
        onDeleteFile={deleteExplorerFile}
        onDeleteFolder={deleteExplorerFolder}
        onMoveFile={moveExplorerFile}
        onMoveFolder={moveExplorerFolder}
        onToggleFavoriteFolder={toggleFavoriteFolder}
        options={explorerOptions}
        onRefresh={() => {
          void refreshExplorerSidebarData()
        }}
      />
    )
  }

  const showCaptureInline = capturePanelOpen && capturePinned

  if (!vaultLoaded) {
    return (
      <div className="launch-shell">
        <div className="launch-card">
          <h1>Hallo {displayName}</h1>
          <p>Waehle eine NoteBase aus und wir laden sie direkt automatisch.</p>

          <label htmlFor="launch-display-name" className="field-label">
            Anrede
          </label>
          <input
            id="launch-display-name"
            value={displayName}
            onChange={(event) => setDisplayName(normalizeLabel(event.target.value) || 'Max')}
            placeholder="Dein Name"
          />

          <div className="launch-actions">
            <button onClick={() => void pickAndOpenVault()}>NoteBase laden</button>
            <button onClick={() => void createVault()}>NoteBase anlegen</button>
            <button onClick={() => setThemeMode(theme === 'light' ? 'dark' : 'light')}>
              {theme === 'light' ? 'Dark Mode' : 'Light Mode'}
            </button>
          </div>

          {message ? <p className="launch-message">{message}</p> : null}
          {error ? <p className="launch-error">{error}</p> : null}
        </div>
      </div>
    )
  }

  return (
    <div className="workbench-shell">
      <aside className="activity-rail">
        <div className="rail-brand">
          <span className="rail-logo">NN</span>
          <div className="rail-brand-copy">
            <strong>NickNotes</strong>
            <span>Workspace</span>
          </div>
        </div>

        <div className="rail-menu">
          <button
            className={sidebarView === 'vault' ? 'active' : ''}
            onClick={() => openSidebarView('vault')}
            title="Board"
          >
            <span className="rail-glyph">▦</span>
            <span className="rail-label">Board</span>
          </button>
          <button
            className={sidebarView === 'notes' ? 'active' : ''}
            onClick={() => openSidebarView('notes')}
            title="Notizen"
          >
            <span className="rail-glyph">◉</span>
            <span className="rail-label">Notizen</span>
          </button>
          <button
            className={sidebarView === 'tasks' ? 'active' : ''}
            onClick={() => openSidebarView('tasks')}
            title="Tasks"
          >
            <span className="rail-glyph">✓</span>
            <span className="rail-label">Tasks</span>
          </button>
          <button
            className={sidebarView === 'tags' ? 'active' : ''}
            onClick={() => openSidebarView('tags')}
            title="Tagging"
          >
            <span className="rail-glyph">#</span>
            <span className="rail-label">Tags</span>
          </button>
          <button
            className={sidebarView === 'review' ? 'active' : ''}
            onClick={() => openSidebarView('review')}
            title="Review"
          >
            <span className="rail-glyph">◌</span>
            <span className="rail-label">Review</span>
          </button>
        </div>

        <div className="rail-spacer" />

        <button
          className={settingsTabOpen ? 'active' : ''}
          onClick={openSettingsTab}
          title="Einstellungen"
        >
          <span className="rail-glyph">⚙</span>
          <span className="rail-label">Einstellungen</span>
        </button>
      </aside>

      {sidebarOpen ? (
        <aside className="left-sidebar" style={{ width: `${explorerWidth}px` }}>
          {renderSidebarContent()}
        </aside>
      ) : null}

      <section className="main-region">
        <div
          className={`workspace-grid ${showCaptureInline ? 'with-capture-row' : ''}`}
        >
          {editorPanelOpen ? (
            <article className="workspace-panel editor-workspace-panel">
              <div className="panel-header-row">
                <h3>{activeTab?.title || 'Editor'}</h3>
                <div className="panel-inline-actions">
                  <button
                    className="icon-button compact muted"
                    onClick={() => (activeTab ? void saveTab(activeTab.path) : undefined)}
                    disabled={!activeTab || !activeTab.dirty}
                    title="Speichern"
                  >
                    S
                  </button>
                  <button
                    className="icon-button compact muted"
                    onClick={toggleSplitView}
                    disabled={activeTab?.kind !== 'note' || openNoteTabs.length < 2}
                    title={splitView ? 'Split aus' : 'Split an'}
                  >
                    |
                  </button>
                  <button className="icon-button compact muted" onClick={toggleEditorPanel} title="Editor schliessen">
                    x
                  </button>
                </div>
              </div>

              <div className="editor-tabs">
                {openTabs.map((tab) => (
                  <div
                    key={`editor-tab-${tab.path}`}
                    className={`editor-tab ${activeTab?.path === tab.path ? 'active' : ''}`}
                    onContextMenu={(event) => {
                      event.preventDefault()
                      setTabContextMenu({ x: event.clientX, y: event.clientY, path: tab.path })
                    }}
                  >
                    <button
                      className="tab-open"
                      onClick={() => {
                        setActiveNotePath(tab.path)
                        setEditorPanelOpen(true)
                      }}
                      title={tab.title}
                    >
                      <span>{tab.title}</span>
                      {tab.dirty ? <span className="tab-dirty-dot">●</span> : null}
                    </button>
                    <button className="tab-close" onClick={() => void closeEditorTab(tab.path)} title="Tab schliessen">
                      x
                    </button>
                  </div>
                ))}
              </div>

              {splitView && activeTab?.kind === 'note' && compareCandidates.length > 0 ? (
                <div className="compare-selector">
                  <label htmlFor="compare-note-select">Vergleichs-Tab</label>
                  <select
                    id="compare-note-select"
                    value={compareTab?.path || ''}
                    onChange={(event) => setCompareNotePath(event.target.value)}
                  >
                    {compareCandidates.map((candidate) => (
                      <option key={candidate.path} value={candidate.path}>
                        {candidate.title}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              <div
                className={`editor-grid ${splitView && compareTab ? 'split' : ''} ${
                  viewerDropActive ? 'drop-active' : ''
                }`}
                onDragOver={(event) => {
                  event.preventDefault()
                  setViewerDropActive(true)
                }}
                onDragLeave={() => setViewerDropActive(false)}
                onDrop={handleViewerDrop}
              >
                <article className="editor-pane">
                  {activeTab ? (
                    activeTab.loading ? (
                      <p className="empty-copy">Lade Notiz ...</p>
                    ) : activeTab.kind === 'settings' ? (
                      <div className="settings-editor">
                        <h3>Einstellungen</h3>

                        <section className="settings-block">
                          <h4>Profil</h4>
                          <label htmlFor="settings-display-name">Anrede</label>
                          <input
                            id="settings-display-name"
                            value={displayName}
                            onChange={(event) => setDisplayName(normalizeLabel(event.target.value) || 'Max')}
                            placeholder="Dein Name"
                          />
                        </section>

                        <section className="settings-block">
                          <h4>Theme</h4>
                          <div className="theme-actions">
                            <button className={theme === 'light' ? 'active' : ''} onClick={() => setThemeMode('light')}>
                              Light
                            </button>
                            <button className={theme === 'dark' ? 'active' : ''} onClick={() => setThemeMode('dark')}>
                              Dark
                            </button>
                          </div>
                        </section>

                        <section className="settings-block">
                          <h4>Layout</h4>
                          <label className="checkbox-row" htmlFor="settings-sidebar-open">
                            <input
                              id="settings-sidebar-open"
                              type="checkbox"
                              checked={sidebarOpen}
                              onChange={(event) => setSidebarOpen(event.target.checked)}
                            />
                            Sidebar anzeigen
                          </label>
                        </section>

                        <section className="settings-block">
                          <h4>Note Explorer</h4>
                          <label className="checkbox-row" htmlFor="settings-explorer-show-hidden">
                            <input
                              id="settings-explorer-show-hidden"
                              type="checkbox"
                              checked={explorerOptions.showHiddenFiles}
                              onChange={(event) =>
                                setExplorerOptions((prev) => ({ ...prev, showHiddenFiles: event.target.checked }))
                              }
                            />
                            Nicht-Markdown-Dateien anzeigen
                          </label>
                          <label className="checkbox-row" htmlFor="settings-explorer-folders-first">
                            <input
                              id="settings-explorer-folders-first"
                              type="checkbox"
                              checked={explorerOptions.foldersFirst}
                              onChange={(event) =>
                                setExplorerOptions((prev) => ({ ...prev, foldersFirst: event.target.checked }))
                              }
                            />
                            Ordner zuerst anzeigen
                          </label>
                          <label className="checkbox-row" htmlFor="settings-explorer-show-icons">
                            <input
                              id="settings-explorer-show-icons"
                              type="checkbox"
                              checked={explorerOptions.showIcons}
                              onChange={(event) =>
                                setExplorerOptions((prev) => ({ ...prev, showIcons: event.target.checked }))
                              }
                            />
                            Dateisymbole anzeigen
                          </label>
                          <label className="checkbox-row" htmlFor="settings-explorer-compact">
                            <input
                              id="settings-explorer-compact"
                              type="checkbox"
                              checked={explorerOptions.compactMode}
                              onChange={(event) =>
                                setExplorerOptions((prev) => ({ ...prev, compactMode: event.target.checked }))
                              }
                            />
                            Kompakte Zeilen
                          </label>
                        </section>

                        <section className="settings-block">
                          <h4>Statusleiste</h4>
                          <label className="checkbox-row" htmlFor="settings-status-notebase">
                            <input
                              id="settings-status-notebase"
                              type="checkbox"
                              checked={statusBarPrefs.showNoteBaseName}
                              onChange={(event) =>
                                setStatusBarPrefs((prev) => ({ ...prev, showNoteBaseName: event.target.checked }))
                              }
                            />
                            NoteBase-Name anzeigen
                          </label>
                          <label className="checkbox-row" htmlFor="settings-status-open-tasks">
                            <input
                              id="settings-status-open-tasks"
                              type="checkbox"
                              checked={statusBarPrefs.showOpenTasks}
                              onChange={(event) =>
                                setStatusBarPrefs((prev) => ({ ...prev, showOpenTasks: event.target.checked }))
                              }
                            />
                            Offene Tasks anzeigen
                          </label>
                          <label className="checkbox-row" htmlFor="settings-status-due-today">
                            <input
                              id="settings-status-due-today"
                              type="checkbox"
                              checked={statusBarPrefs.showDueToday}
                              onChange={(event) =>
                                setStatusBarPrefs((prev) => ({ ...prev, showDueToday: event.target.checked }))
                              }
                            />
                            Heute faellige Tasks anzeigen
                          </label>
                          <label className="checkbox-row" htmlFor="settings-status-total-notes">
                            <input
                              id="settings-status-total-notes"
                              type="checkbox"
                              checked={statusBarPrefs.showTotalNotes}
                              onChange={(event) =>
                                setStatusBarPrefs((prev) => ({ ...prev, showTotalNotes: event.target.checked }))
                              }
                            />
                            Anzahl Notizen anzeigen
                          </label>
                          <label className="checkbox-row" htmlFor="settings-status-message">
                            <input
                              id="settings-status-message"
                              type="checkbox"
                              checked={statusBarPrefs.showStateMessage}
                              onChange={(event) =>
                                setStatusBarPrefs((prev) => ({ ...prev, showStateMessage: event.target.checked }))
                              }
                            />
                            Statusmeldung anzeigen
                          </label>
                        </section>

                        <div className="settings-editor-actions">
                          <button onClick={saveSettings} disabled={!settingsDirty}>
                            Speichern
                          </button>
                          <button onClick={discardSettings} disabled={!settingsDirty}>
                            Verwerfen
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="note-editor-shell">
                          <WysiwygMarkdownEditor
                            key={`${activeTab.path}-${theme}`}
                            value={activeTab.content}
                            theme={theme}
                            onChange={updateActiveNoteContent}
                            onOpenLink={handleEditorLinkOpen}
                            editorApiRef={activeEditorRef}
                          />
                        </div>
                        <div className="wiki-links-strip">
                          <span className="muted-label">Wikilinks</span>
                          {activeWikiLinks.length === 0 ? <span className="empty-copy">Keine Links in dieser Notiz.</span> : null}
                          {activeWikiLinks.map((link) => {
                            if (link.resolved) {
                              const resolvedPath = link.resolved.path
                              return (
                                <button
                                  key={`wiki-link-${link.target}`}
                                  className="wiki-link-pill"
                                  onClick={() => void openNoteInTab(resolvedPath, toNoteDisplayName(resolvedPath))}
                                >
                                  {link.alias || toNoteDisplayName(resolvedPath)}
                                </button>
                              )
                            }

                            return (
                              <span key={`wiki-link-${link.target}`} className="wiki-link-pill unresolved">
                                {link.alias || link.target}
                              </span>
                            )
                          })}
                          <button className="wiki-link-pill" onClick={openWikiLinkPicker}>
                            + Link
                          </button>
                        </div>
                      </>
                    )
                  ) : (
                    <div className="main-empty-state">
                      <p className="main-empty-glyph">◌</p>
                      <p className="empty-copy">Noch keine Notiz geoeffnet.</p>
                    </div>
                  )}
                </article>

                {splitView && compareTab ? (
                  <article className="editor-pane">
                    {compareTab.loading ? (
                      <p className="empty-copy">Lade Vergleich ...</p>
                    ) : (
                      <MarkdownPreview
                        content={compareTab.content}
                        currentPath={compareTab.path}
                        resolveWikiLink={resolveWikiLink}
                        onOpenWikiLink={(row) => {
                          void openNoteInTab(row.path, toNoteDisplayName(row.path))
                        }}
                      />
                    )}
                  </article>
                ) : null}
              </div>
            </article>
          ) : null}

          {showCaptureInline ? (
            <section className="workspace-panel capture-workspace-panel">
              <div className="panel-header-row">
                <h3>Quick Capture</h3>
                <div className="panel-inline-actions">
                  <button className="icon-button compact muted" onClick={toggleCapturePinned} title="In Dock verschieben">
                    P
                  </button>
                  <button className="icon-button compact muted" onClick={closeCapturePanel} title="Quick Capture schliessen">
                    x
                  </button>
                </div>
              </div>
              <div className="capture-panel-body">
                <p className="capture-meta">Vorschlaege {suggestions.length} | Tags {chosenTags.size} | Tasks erkannt {parsedTasks.length}</p>
                <div className="capture-input-wrap">
                  <span className="capture-prompt">&gt;</span>
                  <input
                    value={captureText}
                    onChange={(event) => setCaptureText(event.target.value)}
                    onKeyDown={onQuickCaptureKeyDown}
                    placeholder="Gedanke eingeben und Enter druecken"
                  />
                  <button onClick={() => void saveCapture()} disabled={!captureText.trim()}>
                    Senden
                  </button>
                </div>
                <div className="capture-result">{error ? <span className="state-error">{error}</span> : <span>{message}</span>}</div>
              </div>
            </section>
          ) : null}
        </div>
        <div className="bottom-dock">
          {!showCaptureInline ? (
            <button className="dock-tab" onClick={openCaptureFromDock}>
              Quick Capture
            </button>
          ) : (
            <span className="dock-placeholder">Dock bereit</span>
          )}
        </div>
      </section>

      {tabContextMenu && tabContextTarget?.kind === 'note' ? (
        <div
          className="editor-tab-context-menu"
          style={{ left: `${tabContextMenu.x}px`, top: `${tabContextMenu.y}px` }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            onClick={() => {
              showNoteInSplitView(tabContextTarget.path)
            }}
            disabled={openNoteTabs.length < 2}
          >
            In separater Registerkarte anzeigen
          </button>
          <button
            className="muted"
            onClick={() => {
              void closeEditorTab(tabContextTarget.path)
            }}
          >
            Registerkarte schliessen
          </button>
        </div>
      ) : null}

      <footer className="status-bar">
        <div className="status-bar-left">
          {statusBarPrefs.showStateMessage ? (
            <span className={`status-item ${error ? 'error' : ''}`}>{error || message}</span>
          ) : (
            <span className="status-item">&nbsp;</span>
          )}
        </div>
        <div className="status-bar-right">
          {statusBarPrefs.showTotalNotes ? <span className="status-item">Notizen: {counts.notes}</span> : null}
          {statusBarPrefs.showOpenTasks ? <span className="status-item">Tasks offen: {counts.openTasks}</span> : null}
          {statusBarPrefs.showDueToday ? <span className="status-item">Heute faellig: {dueTodayCount}</span> : null}
          {statusBarPrefs.showNoteBaseName ? <span className="status-item">NoteBase: {noteBaseName}</span> : null}
        </div>
      </footer>

      {linkPickerOpen ? (
        <div
          className="modal-overlay"
          onClick={() => {
            setLinkPickerOpen(false)
          }}
        >
          <aside
            className="link-picker-modal"
            onClick={(event) => {
              event.stopPropagation()
            }}
          >
            <header className="sidebar-header-row">
              <h3>Wikilink einfuegen</h3>
              <button onClick={() => setLinkPickerOpen(false)}>Schliessen</button>
            </header>

            <label className="field-label" htmlFor="wikilink-search">
              Notiz suchen
            </label>
            <input
              id="wikilink-search"
              value={linkPickerQuery}
              onChange={(event) => setLinkPickerQuery(event.target.value)}
              placeholder="Titel oder Pfad, z. B. Daily/Projekt X"
              autoFocus
            />

            <section className="tree-scroll">
              {linkPickerCandidates.length === 0 ? <p className="empty-copy">Keine passenden Notizen gefunden.</p> : null}
              {linkPickerCandidates.map((row) => {
                const target = toWikiTargetForRow(row)
                return (
                  <button
                    key={`link-candidate-${row.path}`}
                    className="tree-item wikilink-candidate"
                    onClick={() => insertWikiLinkForRow(row)}
                  >
                    <strong>{target}</strong>
                    <span>{getRelativeVaultPath(row.path, vaultPath)}</span>
                  </button>
                )
              })}
            </section>

            {normalizedLinkPickerQuery && !linkPickerHasExactMatch ? (
              <button onClick={() => insertWikiLink(linkPickerQuery)}>Neuen Wikilink [[{linkPickerQuery.trim()}]] einfuegen</button>
            ) : null}
          </aside>
        </div>
      ) : null}

    </div>
  )
}

export default App

