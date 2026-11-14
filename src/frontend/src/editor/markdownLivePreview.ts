import { authenticatedFetch } from '../app/apiClient'
import { syntaxTree } from '@codemirror/language'
import { Facet, type EditorState, type Extension, StateField } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from '@codemirror/view'
import { DEFAULT_TAG_GROUP_COLOR } from '../tags/tagColorPalette'
import { buildTagLookup, findTagDefinition, type TagGroupDefinition, type TagLookup } from '../tags/tagTypes'
import {contextMenuAnchor, isContextMenuKey} from '../ui/contextMenuAnchor'
import {isolateHistory} from '@codemirror/commands'
import type {ContextMenuAnchor} from '../ui/contextMenuAnchor'

export type MarkdownTableMenuRequest = {
  anchor: ContextMenuAnchor
  actions: Array<{label: string; run: () => void; disabled: boolean}>
  dismiss: () => void
}

const tableWidgetLifecycle = new WeakMap<HTMLElement, {
  widget: MarkdownTableWidget
  close: () => void
  flush: () => void
  refreshContext: (context: MarkdownTableRenderContext) => void
}>()

export function flushMarkdownTableDrafts(view: EditorView): void {
  view.dom.querySelectorAll<HTMLElement>('.cm-md-table-widget').forEach(dom => tableWidgetLifecycle.get(dom)?.flush())
}

type SelectionRange = {
  from: number
  to: number
}

type SyntaxLikeNode = {
  name: string
  from: number
  to: number
  parent: SyntaxLikeNode | null
  firstChild: SyntaxLikeNode | null
  nextSibling: SyntaxLikeNode | null
}

type DecorationEntry = {
  from: number
  to: number
  decoration: Decoration
  line?: boolean
}

type LivePreviewOptions = {
  onTableContextMenu?: (request: MarkdownTableMenuRequest | null) => void
  notePath?: string
  backendUrl?: string
  linkTargets?: readonly MarkdownPreviewLinkTarget[]
  onOpenWikiLink?: (target: string) => void
  onOpenTagReference?: (groupId: string, tagId: string) => void
}

type MarkdownPreviewLinkTarget = {
  title: string
  target: string
  relativePath: string
}

const HEADING_OWNER_NAMES = new Set(['ATXHeading1', 'ATXHeading2', 'ATXHeading3', 'ATXHeading4', 'ATXHeading5', 'ATXHeading6'])
const EMPHASIS_OWNER_NAMES = new Set(['StrongEmphasis', 'Emphasis'])
const CODE_OWNER_NAMES = new Set(['InlineCode', 'FencedCode'])
const BLOCKQUOTE_OWNER_NAMES = new Set(['Blockquote'])
const LINK_OWNER_NAMES = new Set(['Link'])

const strongDeco = Decoration.mark({ class: 'cm-md-strong' })
const emphasisDeco = Decoration.mark({ class: 'cm-md-emphasis' })
const inlineCodeDeco = Decoration.mark({ class: 'cm-md-inline-code' })
const codeBlockDeco = Decoration.mark({ class: 'cm-md-code-block' })
const linkTextDeco = Decoration.mark({ class: 'cm-md-link-text' })
const linkUrlDeco = Decoration.mark({ class: 'cm-md-link-url' })
const wikiLinkDeco = Decoration.mark({ class: 'cm-md-wikilink' })
const syntaxVisibleDeco = Decoration.mark({ class: 'cm-md-syntax-token cm-md-syntax-visible' })
const syntaxMutedDeco = Decoration.mark({ class: 'cm-md-syntax-token cm-md-syntax-muted' })
const listMarkVisibleDeco = Decoration.mark({ class: 'cm-md-list-mark cm-md-syntax-token cm-md-syntax-visible' })
const listMarkMutedDeco = Decoration.mark({ class: 'cm-md-list-mark cm-md-syntax-token cm-md-syntax-muted' })
const quoteMarkVisibleDeco = Decoration.mark({ class: 'cm-md-quote-mark cm-md-syntax-token cm-md-syntax-visible' })
const quoteMarkMutedDeco = Decoration.mark({ class: 'cm-md-quote-mark cm-md-syntax-token cm-md-syntax-muted' })
const taskMarkerVisibleDeco = Decoration.mark({ class: 'cm-md-task-marker cm-md-syntax-token cm-md-syntax-visible' })
const inlineTagSourceDeco = Decoration.mark({ class: 'cm-md-inline-tag-source' })

const INLINE_TAG_PATTERN = /\{tag:([A-Za-z0-9][A-Za-z0-9_-]*)\/([A-Za-z0-9][A-Za-z0-9_-]*)\}/g
const INLINE_IMAGE_PATTERN = /!\[([^\]\n]*)\]\(([^)\n]+)\)((?:\s*\{[^}\n]*\})*)/g
const INLINE_MARKDOWN_LINK_PATTERN = /(^|[^!])\[([^\]\n]+)\]\(([^)\n]+)\)/g
const WIKILINK_PATTERN = /\[\[([^[\]\n]+)\]\]/g
const MARKDOWN_TABLE_WIDTHS_COMMENT_PATTERN = /^\s*<!--\s*nicknotes-table-widths:\s*([^>]+?)\s*-->\s*$/i
const EMPTY_TAG_LOOKUP = buildTagLookup([])
const EMPTY_LINK_TARGETS: readonly MarkdownPreviewLinkTarget[] = []
const FALLBACK_MARKDOWN_TABLE_MIN_COLUMN_WIDTH_PX = 52

export const markdownTagLookupFacet = Facet.define<TagLookup, TagLookup>({
  combine(values) {
    return values.length > 0 ? values[values.length - 1] : EMPTY_TAG_LOOKUP
  },
})

const DEFAULT_MARKDOWN_TABLE_OPTIONS: MarkdownTableOptions = {
  linkTargets: EMPTY_LINK_TARGETS,
}

const markdownTableOptionsFacet = Facet.define<MarkdownTableOptions, MarkdownTableOptions>({
  combine(values) {
    return values.length > 0 ? values[values.length - 1] : DEFAULT_MARKDOWN_TABLE_OPTIONS
  },
})

class TaskCheckboxWidget extends WidgetType {
  readonly checked: boolean
  readonly from: number
  readonly to: number

  constructor(checked: boolean, from: number, to: number) {
    super()
    this.checked = checked
    this.from = from
    this.to = to
  }

  eq(other: TaskCheckboxWidget): boolean {
    return other.checked === this.checked && other.from === this.from && other.to === this.to
  }

  toDOM(): HTMLElement {
    const element = document.createElement('span')
    element.className = 'cm-md-task-checkbox'
    element.dataset.markerFrom = String(this.from)
    element.dataset.markerTo = String(this.to)
    element.setAttribute('role', 'checkbox')
    element.setAttribute('aria-checked', this.checked ? 'true' : 'false')
    element.textContent = this.checked ? '☑' : '☐'
    return element
  }

  ignoreEvent(): boolean {
    return false
  }
}

class InlineTagWidget extends WidgetType {
  readonly groupId: string
  readonly tagId: string
  readonly groupDisplayName: string
  readonly tagDisplayName: string
  readonly groupColor: string
  readonly syntax: string

  constructor(groupId: string, tagId: string, groupDisplayName: string, tagDisplayName: string, groupColor: string, syntax: string) {
    super()
    this.groupId = groupId
    this.tagId = tagId
    this.groupDisplayName = groupDisplayName
    this.tagDisplayName = tagDisplayName
    this.groupColor = groupColor
    this.syntax = syntax
  }

  eq(other: InlineTagWidget): boolean {
    return (
      other.groupId === this.groupId &&
      other.tagId === this.tagId &&
      other.groupDisplayName === this.groupDisplayName &&
      other.tagDisplayName === this.tagDisplayName &&
      other.groupColor === this.groupColor &&
      other.syntax === this.syntax
    )
  }

  toDOM(): HTMLElement {
    const element = document.createElement('span')
    element.className = 'cm-md-inline-tag-chip'
    element.style.setProperty('--cm-md-tag-color', this.groupColor)
    element.dataset.tagGroupId = this.groupId
    element.dataset.tagId = this.tagId
    element.textContent = this.tagDisplayName
    element.title = `${this.groupDisplayName} / ${this.tagDisplayName}`
    element.setAttribute('aria-label', `Tag ${this.tagDisplayName}`)
    return element
  }

  ignoreEvent(): boolean {
    return false
  }
}

class InlineImageWidget extends WidgetType {
  readonly alt: string
  readonly source: string
  readonly notePath: string
  readonly backendUrl: string
  readonly width: number | null
  readonly height: number | null
  readonly from: number
  readonly to: number

  constructor(
    alt: string,
    source: string,
    notePath: string,
    backendUrl: string,
    width: number | null,
    height: number | null,
    from: number,
    to: number
  ) {
    super()
    this.alt = alt
    this.source = source
    this.notePath = notePath
    this.backendUrl = backendUrl
    this.width = width
    this.height = height
    this.from = from
    this.to = to
  }

  eq(other: InlineImageWidget): boolean {
    return (
      other.alt === this.alt &&
      other.source === this.source &&
      other.notePath === this.notePath &&
      other.backendUrl === this.backendUrl &&
      other.width === this.width &&
      other.height === this.height &&
      other.from === this.from &&
      other.to === this.to
    )
  }

  toDOM(): HTMLElement {
    const wrapper = document.createElement('span')
    wrapper.className = 'cm-md-image-widget'
    wrapper.dataset.imageFrom = String(this.from)
    wrapper.dataset.imageTo = String(this.to)
    wrapper.dataset.imageAlt = this.alt
    wrapper.dataset.imageSource = this.source
    if (this.width) {
      wrapper.dataset.imageWidth = String(this.width)
    }
    if (this.height) {
      wrapper.dataset.imageHeight = String(this.height)
    }

    const image = document.createElement('img')
    image.className = 'cm-md-image'
    image.loading = 'lazy'
    image.alt = this.alt || 'Image'
    const params = new URLSearchParams({
      path: this.notePath,
      source: this.source,
    })
    const cleanBackendUrl = this.backendUrl.replace(/\/+$/, '')
    void authenticatedFetch(`${cleanBackendUrl}/notes/media/content?${params.toString()}`).then(response => response.blob()).then(blob => {
      if (!image.isConnected) return
      const objectUrl = URL.createObjectURL(blob)
      const release = () => URL.revokeObjectURL(objectUrl)
      image.addEventListener('load', release, {once: true})
      image.addEventListener('error', release, {once: true})
      image.src = objectUrl
    }).catch(() => { image.alt = 'Bild konnte nicht geladen werden.' })
    if (this.width) {
      image.style.width = `${this.width}px`
    }
    if (this.height) {
      image.style.height = `${this.height}px`
    }
    wrapper.appendChild(image)

    const handles = document.createElement('span')
    handles.className = 'cm-md-image-handles'
    for (const direction of ['nw', 'ne', 'sw', 'se']) {
      const handle = document.createElement('button')
      handle.type = 'button'
      handle.className = `cm-md-image-handle cm-md-image-handle-${direction}`
      handle.dataset.resizeDirection = direction
      handle.setAttribute('aria-label', `Bild ${direction} skalieren`)
      handles.appendChild(handle)
    }
    wrapper.appendChild(handles)

    return wrapper
  }

  ignoreEvent(): boolean {
    return false
  }
}

class MarkdownLinkWidget extends WidgetType {
  readonly text: string
  readonly url: string

  constructor(text: string, url: string) {
    super()
    this.text = text
    this.url = url
  }

  eq(other: MarkdownLinkWidget): boolean {
    return other.text === this.text && other.url === this.url
  }

  toDOM(): HTMLElement {
    const element = document.createElement('span')
    element.className = 'cm-md-markdown-link-widget'
    element.dataset.url = this.url
    element.textContent = this.text
    element.title = this.url
    element.setAttribute('role', 'link')
    return element
  }

  ignoreEvent(): boolean {
    return false
  }
}

class WikiLinkWidget extends WidgetType {
  readonly text: string
  readonly target: string
  readonly tooltip: string

  constructor(text: string, target: string, tooltip: string) {
    super()
    this.text = text
    this.target = target
    this.tooltip = tooltip
  }

  eq(other: WikiLinkWidget): boolean {
    return other.text === this.text && other.target === this.target && other.tooltip === this.tooltip
  }

  toDOM(): HTMLElement {
    const element = document.createElement('span')
    element.className = 'cm-md-wikilink cm-md-wikilink-widget'
    element.dataset.wikiTarget = this.target
    element.textContent = this.text
    element.title = this.tooltip
    element.setAttribute('role', 'link')
    return element
  }

  ignoreEvent(): boolean {
    return false
  }
}

type ParsedInlineTag = {
  from: number
  to: number
  groupId: string
  tagId: string
  syntax: string
}

type ParsedInlineImage = {
  from: number
  to: number
  alt: string
  source: string
  width: number | null
  height: number | null
}

type ParsedMarkdownLink = {
  from: number
  to: number
  text: string
  url: string
}

type ParsedWikiLink = {
  from: number
  to: number
  target: string
  displayText: string
}

type ParsedMarkdownTable = {
  from: number
  to: number
  headers: string[]
  rows: string[][]
  columnWidths: number[]
  hasColumnWidths: boolean
}

function splitMarkdownTableRow(lineText: string): string[] {
  let text = lineText.trim()
  if (text.startsWith('|')) {
    text = text.slice(1)
  }
  if (text.endsWith('|')) {
    text = text.slice(0, -1)
  }

  const cells: string[] = []
  let current = ''
  let escaped = false
  for (const char of text) {
    if (escaped) {
      current += char
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (char === '|') {
      cells.push(current.trim())
      current = ''
      continue
    }
    current += char
  }
  cells.push(current.trim())
  return cells
}

function isMarkdownTableSeparator(lineText: string, expectedColumns: number): boolean {
  const cells = splitMarkdownTableRow(lineText)
  return (
    cells.length === expectedColumns &&
    cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s+/g, '')))
  )
}

function isPotentialMarkdownTableRow(lineText: string): boolean {
  return lineText.includes('|') && splitMarkdownTableRow(lineText).length >= 1
}

function decodeMarkdownTableCell(value: string): string {
  return value.replace(/<br\s*\/?>/gi, '\n').trim()
}

function escapeMarkdownTableCell(value: string): string {
  return value
    .replace(/\r?\n/g, '<br>')
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .trim()
}

function normalizeMarkdownTableRows(headers: readonly string[], rows: readonly (readonly string[])[]): string[][] {
  const columnCount = Math.max(1, headers.length)
  return rows.map((row) => Array.from({ length: columnCount }, (_, index) => decodeMarkdownTableCell(row[index] ?? '')))
}

function createEqualMarkdownTableColumnWidths(columnCount: number): number[] {
  const safeColumnCount = Math.max(1, columnCount)
  return Array.from({ length: safeColumnCount }, () => 100 / safeColumnCount)
}

function normalizeMarkdownTableColumnWidths(widths: readonly number[], columnCount: number): number[] {
  const safeColumnCount = Math.max(1, columnCount)
  if (widths.length !== safeColumnCount || widths.some((width) => !Number.isFinite(width) || width <= 0)) {
    return createEqualMarkdownTableColumnWidths(safeColumnCount)
  }

  const total = widths.reduce((sum, width) => sum + width, 0)
  if (!Number.isFinite(total) || total <= 0) {
    return createEqualMarkdownTableColumnWidths(safeColumnCount)
  }

  return widths.map((width) => (width / total) * 100)
}

function formatMarkdownTableColumnWidths(widths: readonly number[], columnCount: number): string {
  const normalized = normalizeMarkdownTableColumnWidths(widths, columnCount)
  const rounded = normalized.map((width) => Number(width.toFixed(1)))
  const roundedTotal = rounded.reduce((sum, width) => sum + width, 0)
  rounded[rounded.length - 1] = Number((rounded[rounded.length - 1] + (100 - roundedTotal)).toFixed(1))
  return rounded.map((width) => `${width.toFixed(1)}%`).join(', ')
}

function parseMarkdownTableWidthComment(lineText: string): number[] | null {
  const match = MARKDOWN_TABLE_WIDTHS_COMMENT_PATTERN.exec(lineText)
  if (!match) {
    return null
  }
  const rawWidths = match[1] ?? ''
  const widths = rawWidths
    .split(',')
    .map((part) => Number.parseFloat(part.trim().replace(/%$/g, '')))
    .filter((width) => Number.isFinite(width) && width > 0)
  return widths.length > 0 ? widths : null
}

function serializeMarkdownTable(
  headers: readonly string[],
  rows: readonly (readonly string[])[],
  columnWidths: readonly number[] = [],
  includeColumnWidths = false
): string {
  const cleanHeaders = headers.map(decodeMarkdownTableCell)
  const normalizedRows = normalizeMarkdownTableRows(cleanHeaders, rows)
  const renderRow = (cells: readonly string[]) => `| ${cells.map(escapeMarkdownTableCell).join(' | ')} |`
  const tableLines = [
    renderRow(cleanHeaders.map((header, index) => header || `Spalte ${index + 1}`)),
    renderRow(cleanHeaders.map(() => '---')),
    ...normalizedRows.map(renderRow),
  ]
  if (!includeColumnWidths) {
    return tableLines.join('\n')
  }
  return [`<!-- nicknotes-table-widths: ${formatMarkdownTableColumnWidths(columnWidths, cleanHeaders.length)} -->`, ...tableLines].join('\n')
}

type MarkdownTableRenderContext = {
  readOnly: boolean
  onTableContextMenu?: (request: MarkdownTableMenuRequest | null) => void
  tagLookup: TagLookup
  linkTargets: readonly MarkdownPreviewLinkTarget[]
  onOpenWikiLink?: (target: string) => void
  onOpenTagReference?: (groupId: string, tagId: string) => void
}

type MarkdownTableOptions = Omit<MarkdownTableRenderContext, 'tagLookup' | 'readOnly'>

type MarkdownTableInlineToken = {
  from: number
  to: number
  priority: number
  createElement: () => HTMLElement
}

function createRenderedMarkdownLinkElement(text: string, url: string): HTMLElement {
  const element = document.createElement('span')
  element.className = 'cm-md-markdown-link-widget'
  element.dataset.url = url
  element.textContent = text
  element.title = url
  element.setAttribute('role', 'link')

  if (normalizeExternalUrl(url)) {
    element.dataset.tableInlineAction = 'true'
    element.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      void openExternalUrl(url)
    })
  }

  return element
}

function createRenderedWikiLinkElement(text: string, target: string, context: MarkdownTableRenderContext): HTMLElement {
  const element = document.createElement('span')
  element.className = 'cm-md-wikilink cm-md-wikilink-widget'
  element.dataset.wikiTarget = target
  element.textContent = text
  element.title = resolveWikiLinkTooltip(target, context.linkTargets)
  element.setAttribute('role', 'link')

  if (context.onOpenWikiLink) {
    element.dataset.tableInlineAction = 'true'
    element.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      context.onOpenWikiLink?.(target)
    })
  }

  return element
}

function createRenderedInlineTagElement(tag: ParsedInlineTag, context: MarkdownTableRenderContext): HTMLElement {
  const resolved = findTagDefinition(context.tagLookup, tag.groupId, tag.tagId)
  const groupDisplayName = resolved?.group.displayName ?? tag.groupId
  const tagDisplayName = resolved?.tag.displayName ?? tag.tagId
  const groupColor = resolved?.group.color ?? DEFAULT_TAG_GROUP_COLOR
  const element = document.createElement('span')
  element.className = 'cm-md-inline-tag-chip'
  element.style.setProperty('--cm-md-tag-color', groupColor)
  element.dataset.tagGroupId = tag.groupId
  element.dataset.tagId = tag.tagId
  element.textContent = tagDisplayName
  element.title = `${groupDisplayName} / ${tagDisplayName}`
  element.setAttribute('aria-label', `Tag ${tagDisplayName}`)

  if (context.onOpenTagReference) {
    element.dataset.tableInlineAction = 'true'
    element.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      context.onOpenTagReference?.(tag.groupId, tag.tagId)
    })
  }

  return element
}

function collectMarkdownTableInlineTokens(lineText: string, context: MarkdownTableRenderContext): MarkdownTableInlineToken[] {
  const tokens: MarkdownTableInlineToken[] = []
  for (const link of parseMarkdownLinksInLine(lineText, 0)) {
    tokens.push({
      from: link.from,
      to: link.to,
      priority: 0,
      createElement: () => createRenderedMarkdownLinkElement(link.text, link.url),
    })
  }
  for (const wikiLink of parseWikiLinksInLine(lineText, 0)) {
    tokens.push({
      from: wikiLink.from,
      to: wikiLink.to,
      priority: 1,
      createElement: () => createRenderedWikiLinkElement(wikiLink.displayText, wikiLink.target, context),
    })
  }
  for (const tag of parseInlineTagsInLine(lineText, 0)) {
    tokens.push({
      from: tag.from,
      to: tag.to,
      priority: 1,
      createElement: () => createRenderedInlineTagElement(tag, context),
    })
  }

  return tokens.sort((left, right) => left.from - right.from || left.priority - right.priority || right.to - left.to)
}

function appendRenderedMarkdownTableLine(parent: HTMLElement, lineText: string, context: MarkdownTableRenderContext): void {
  const tokens = collectMarkdownTableInlineTokens(lineText, context)
  let cursor = 0
  for (const token of tokens) {
    if (token.from < cursor || token.from < 0 || token.to > lineText.length) {
      continue
    }
    if (token.from > cursor) {
      parent.appendChild(document.createTextNode(lineText.slice(cursor, token.from)))
    }
    parent.appendChild(token.createElement())
    cursor = token.to
  }
  if (cursor < lineText.length) {
    parent.appendChild(document.createTextNode(lineText.slice(cursor)))
  }
}

function renderMarkdownTableCellContent(element: HTMLElement, value: string, context: MarkdownTableRenderContext): void {
  element.replaceChildren()

  if (!value) {
    const empty = document.createElement('span')
    empty.className = 'cm-md-table-cell-empty'
    empty.setAttribute('aria-hidden', 'true')
    empty.textContent = '\u00a0'
    element.appendChild(empty)
    return
  }

  const lines = value.split('\n')
  lines.forEach((line, index) => {
    if (index > 0) {
      element.appendChild(document.createElement('br'))
    }
    appendRenderedMarkdownTableLine(element, line, context)
  })
}

class MarkdownTableWidget extends WidgetType {
  readonly headers: string[]
  readonly rows: string[][]
  readonly columnWidths: number[]
  readonly hasColumnWidths: boolean
  readonly from: number
  readonly to: number
  readonly context: MarkdownTableRenderContext

  constructor(
    headers: string[],
    rows: string[][],
    columnWidths: number[],
    hasColumnWidths: boolean,
    from: number,
    to: number,
    context: MarkdownTableRenderContext
  ) {
    super()
    this.headers = headers
    this.rows = rows
    this.columnWidths = columnWidths
    this.hasColumnWidths = hasColumnWidths
    this.from = from
    this.to = to
    this.context = context
  }

  eq(other: MarkdownTableWidget): boolean {
    return (
      other.from === this.from &&
      other.to === this.to &&
      other.context.tagLookup === this.context.tagLookup &&
      other.context.readOnly === this.context.readOnly &&
      other.context.linkTargets === this.context.linkTargets &&
      other.context.onOpenWikiLink === this.context.onOpenWikiLink &&
      other.context.onOpenTagReference === this.context.onOpenTagReference &&
      other.context.onTableContextMenu === this.context.onTableContextMenu &&
      JSON.stringify(other.headers) === JSON.stringify(this.headers) &&
      JSON.stringify(other.rows) === JSON.stringify(this.rows) &&
      JSON.stringify(other.columnWidths) === JSON.stringify(this.columnWidths) &&
      other.hasColumnWidths === this.hasColumnWidths
    )
  }

  updateDOM(dom: HTMLElement): boolean {
    const lifecycle = tableWidgetLifecycle.get(dom)
    const previous = lifecycle?.widget
    if (!lifecycle || !previous || previous.from !== this.from || previous.to !== this.to ||
        previous.context.readOnly !== this.context.readOnly ||
        previous.hasColumnWidths !== this.hasColumnWidths ||
        JSON.stringify(previous.headers) !== JSON.stringify(this.headers) ||
        JSON.stringify(previous.rows) !== JSON.stringify(this.rows) ||
        JSON.stringify(previous.columnWidths) !== JSON.stringify(this.columnWidths)) return false
    lifecycle.widget = this
    lifecycle.refreshContext(this.context)
    return true
  }

  toDOM(view: EditorView): HTMLElement {
    const wrapper = document.createElement('span')
    wrapper.className = 'cm-md-table-widget'
    let renderContext = this.context
    wrapper.dataset.tableFrom = String(this.from)
    wrapper.dataset.tableTo = String(this.to)

    const table = document.createElement('table')
    const thead = document.createElement('thead')
    const headerRow = document.createElement('tr')
    let menuOpen = false
    const columnCount = Math.max(1, this.headers.length)
    const draftHeaders = Array.from({ length: columnCount }, (_, index) => decodeMarkdownTableCell(this.headers[index] ?? ''))
    const draftRows = normalizeMarkdownTableRows(draftHeaders, this.rows)
    const draftColumnWidths = normalizeMarkdownTableColumnWidths(this.columnWidths, columnCount)
    let persistColumnWidths = this.hasColumnWidths
    let suppressBlurCommit = false

    const colgroup = document.createElement('colgroup')
    const colElements: HTMLTableColElement[] = []
    for (let index = 0; index < columnCount; index += 1) {
      const col = document.createElement('col')
      colElements.push(col)
      colgroup.appendChild(col)
    }
    table.appendChild(colgroup)

    const normalizeDraftColumnWidths = () => {
      const normalized = normalizeMarkdownTableColumnWidths(draftColumnWidths, draftHeaders.length)
      draftColumnWidths.splice(0, draftColumnWidths.length, ...normalized)
    }

    const applyColumnWidths = () => {
      normalizeDraftColumnWidths()
      colElements.forEach((col, index) => {
        col.style.width = `${draftColumnWidths[index] ?? 0}%`
      })
    }

    applyColumnWidths()

    const commit = (selectionAnchor?: number, isolate = false) => {
      if (view.state.readOnly || !wrapper.isConnected) return
      const nextMarkdown = serializeMarkdownTable(draftHeaders, draftRows, draftColumnWidths, persistColumnWidths)
      const currentMarkdown = view.state.doc.sliceString(this.from, this.to)
      const requestedAnchor = typeof selectionAnchor === 'number' ? Math.max(0, Math.min(selectionAnchor, view.state.doc.length)) : null
      if (nextMarkdown === currentMarkdown) {
        if (requestedAnchor !== null) {
          view.dispatch({
            selection: { anchor: requestedAnchor, head: requestedAnchor },
            scrollIntoView: true,
          })
          view.focus()
        }
        return
      }
      const nextDocLength = view.state.doc.length - (this.to - this.from) + nextMarkdown.length
      const mappedAnchor =
        requestedAnchor === null
          ? null
          : requestedAnchor <= this.from
            ? requestedAnchor
            : requestedAnchor >= this.to
              ? this.from + nextMarkdown.length + (requestedAnchor - this.to)
              : this.from + nextMarkdown.length
      const safeAnchor = mappedAnchor === null ? null : Math.max(0, Math.min(mappedAnchor, nextDocLength))
      suppressBlurCommit = true
      view.dispatch({
        changes: { from: this.from, to: this.to, insert: nextMarkdown },
        selection: safeAnchor !== null ? { anchor: safeAnchor, head: safeAnchor } : { anchor: this.from + nextMarkdown.length },
        scrollIntoView: safeAnchor !== null,
        userEvent: 'input.type',
        annotations: isolate ? isolateHistory.of('full') : undefined,
      })
      if (safeAnchor !== null) {
        view.focus()
      }
    }

    const closeContextMenu = () => {
      if (!menuOpen) return
      menuOpen = false
      renderContext.onTableContextMenu?.(null)
    }
    tableWidgetLifecycle.set(wrapper, {widget: this, close: closeContextMenu, refreshContext: context => {
      renderContext = context
      tableControls.forEach(input => {
        const display = displayByInput.get(input)
        if (input.hidden && display) renderMarkdownTableCellContent(display, input.value, renderContext)
      })
    }, flush: () => {
      const focused = wrapper.contains(document.activeElement)
      closeContextMenu()
      commit()
      if (focused && !wrapper.isConnected && view.dom.isConnected) view.focus()
    }})

    const commitStructureChange = () => {
      closeContextMenu()
      commit(undefined, true)
    }

    const insertRowAt = (index: number) => {
      const targetIndex = Math.max(0, Math.min(index, draftRows.length))
      draftRows.splice(targetIndex, 0, Array.from({ length: draftHeaders.length }, () => ''))
      commitStructureChange()
    }

    const deleteRowAt = (index: number) => {
      if (index < 0 || draftRows.length <= 1) {
        return
      }
      draftRows.splice(index, 1)
      commitStructureChange()
    }

    const insertColumnAt = (index: number) => {
      const targetIndex = Math.max(0, Math.min(index, draftHeaders.length))
      const splitIndex = Math.max(0, Math.min(targetIndex, draftColumnWidths.length - 1))
      const splitWidth = (draftColumnWidths[splitIndex] ?? 100 / draftHeaders.length) / 2
      draftColumnWidths[splitIndex] = splitWidth
      draftColumnWidths.splice(targetIndex, 0, splitWidth)
      draftHeaders.splice(targetIndex, 0, `Spalte ${targetIndex + 1}`)
      normalizeDraftColumnWidths()
      for (const row of draftRows) {
        row.splice(targetIndex, 0, '')
      }
      commitStructureChange()
    }

    const deleteColumnAt = (index: number) => {
      if (index < 0 || draftHeaders.length <= 1) {
        return
      }
      draftHeaders.splice(index, 1)
      const removedWidth = draftColumnWidths.splice(index, 1)[0] ?? 0
      if (draftColumnWidths.length > 0) {
        const recipientIndex = Math.max(0, Math.min(index, draftColumnWidths.length - 1))
        draftColumnWidths[recipientIndex] = (draftColumnWidths[recipientIndex] ?? 0) + removedWidth
        normalizeDraftColumnWidths()
      }
      for (const row of draftRows) {
        row.splice(index, 1)
      }
      commitStructureChange()
    }

    const showCellContextMenu = (event: MouseEvent | KeyboardEvent, rowIndex: number | null, columnIndex: number) => {
      const handler = renderContext.onTableContextMenu
      if (!handler || !(event.currentTarget instanceof HTMLElement)) return
      event.preventDefault(); event.stopPropagation()
      closeContextMenu()
      const trigger = event.currentTarget
      const anchor = contextMenuAnchor(trigger, view.contentDOM)
      const rowTarget = rowIndex ?? 0
      const action = (label: string, run: () => void, disabled = false) => ({
        label, disabled: disabled || view.state.readOnly,
        run: () => {if (!view.state.readOnly && wrapper.isConnected) run()},
      })
      menuOpen = true
      handler({
        anchor: event instanceof MouseEvent ? {...anchor, x: event.clientX, y: event.clientY} : anchor,
        actions: [
          action('Zeile darüber einfügen', () => insertRowAt(rowTarget)),
          action('Zeile darunter einfügen', () => insertRowAt(rowTarget + 1)),
          action('Spalte links einfügen', () => insertColumnAt(columnIndex)),
          action('Spalte rechts einfügen', () => insertColumnAt(columnIndex + 1)),
          action('Zeile löschen', () => rowIndex !== null && deleteRowAt(rowIndex), rowIndex === null || draftRows.length <= 1),
          action('Spalte löschen', () => deleteColumnAt(columnIndex), draftHeaders.length <= 1),
        ],
        dismiss: () => {
          closeContextMenu()
          // Escape/action activation restores the cell first. Outside dismissal commits its draft.
          const input = tableControls.find(control => !control.hidden)
          if (input && !wrapper.contains(document.activeElement) && wrapper.isConnected) {
            deactivateTableControl(input)
            commit()
          }
        },
      })
    }

    const tableControls: HTMLTextAreaElement[] = []
    const tableDisplays: HTMLElement[] = []
    const displayByInput = new Map<HTMLTextAreaElement, HTMLElement>()
    let navigatingInsideTable = false
    let skipNextBlurCommit = false

    const resizeTableInput = (input: HTMLTextAreaElement) => {
      input.rows = Math.max(1, input.value.split('\n').length)
      input.style.height = 'auto'
      input.style.height = `${Math.max(input.scrollHeight, 34)}px`
    }

    const deactivateTableControl = (input: HTMLTextAreaElement) => {
      const display = displayByInput.get(input)
      if (!display) {
        return
      }
      renderMarkdownTableCellContent(display, input.value, renderContext)
      input.hidden = true
      display.hidden = false
    }

    const activateTableControl = (index: number, selectContents = false) => {
      const target = tableControls[index]
      if (!target) {
        return
      }
      const display = tableDisplays[index]
      if (!display) {
        return
      }
      closeContextMenu()
      for (const control of tableControls) {
        if (control !== target && !control.hidden) {
          deactivateTableControl(control)
        }
      }
      navigatingInsideTable = true
      display.hidden = true
      target.hidden = false
      resizeTableInput(target)
      target.focus()
      if (selectContents) {
        target.select()
      } else {
        const end = target.value.length
        target.selectionStart = end
        target.selectionEnd = end
      }
      window.setTimeout(() => {
        navigatingInsideTable = false
      }, 0)
    }

    const focusTableControl = (index: number) => {
      activateTableControl(index, true)
    }

    const resolvePositionAfterTable = (): number => {
      const nextChar = view.state.doc.sliceString(this.to, this.to + 1)
      return nextChar === '\n' ? this.to + 1 : this.to
    }

    const finishEditingTableControl = (input: HTMLTextAreaElement, selectionAnchor?: number) => {
      skipNextBlurCommit = true
      deactivateTableControl(input)
      input.blur()
      commit(selectionAnchor)
      window.setTimeout(() => {
        skipNextBlurCommit = false
      }, 0)
    }

    const handleCellKeyDown = (event: KeyboardEvent) => {
      const input = event.currentTarget as HTMLTextAreaElement
      if (isContextMenuKey(event)) {
        const rowIndex = input.dataset.tableRow === 'header' ? null : Number(input.dataset.tableRow)
        showCellContextMenu(event, rowIndex, Number(input.dataset.tableColumn))
        return
      }
      const controlIndex = tableControls.indexOf(input)
      if (event.key === 'Tab') {
        event.preventDefault()
        if (event.shiftKey) {
          if (controlIndex > 0) {
            deactivateTableControl(input)
            focusTableControl(controlIndex - 1)
            return
          }
          finishEditingTableControl(input, this.from)
          return
        }
        if (controlIndex >= 0 && controlIndex < tableControls.length - 1) {
          deactivateTableControl(input)
          focusTableControl(controlIndex + 1)
          return
        }
        finishEditingTableControl(input, resolvePositionAfterTable())
        return
      }

      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault()
        finishEditingTableControl(input)
        return
      }

      if (event.key === 'Escape') {
        event.preventDefault()
        finishEditingTableControl(input)
        view.focus()
        return
      }

      if (event.key === 'Enter') {
        event.stopPropagation()
      }
    }

    const commitOnBlur = (event: FocusEvent) => {
      if (menuOpen || navigatingInsideTable || suppressBlurCommit || skipNextBlurCommit) {
        return
      }
      const input = event.currentTarget as HTMLTextAreaElement
      deactivateTableControl(input)
      commit()
    }

    const measureMinimumColumnWidth = (): number => {
      const probe = document.createElement('span')
      probe.textContent = 'MMMM'
      probe.style.position = 'absolute'
      probe.style.visibility = 'hidden'
      probe.style.pointerEvents = 'none'
      probe.style.fontSize = '0.92rem'
      probe.style.fontFamily = 'inherit'
      wrapper.appendChild(probe)
      const width = Math.ceil(probe.getBoundingClientRect().width + 18)
      probe.remove()
      return Math.max(FALLBACK_MARKDOWN_TABLE_MIN_COLUMN_WIDTH_PX, width)
    }

    const getColumnPixelWidths = (): number[] => {
      const tableWidth = Math.max(1, table.getBoundingClientRect().width)
      const normalized = normalizeMarkdownTableColumnWidths(draftColumnWidths, draftHeaders.length)
      return normalized.map((width) => (tableWidth * width) / 100)
    }

    const setColumnPixelWidths = (pixelWidths: readonly number[]) => {
      const total = pixelWidths.reduce((sum, width) => sum + width, 0)
      if (!Number.isFinite(total) || total <= 0) {
        return
      }
      draftColumnWidths.splice(0, draftColumnWidths.length, ...pixelWidths.map((width) => (width / total) * 100))
      applyColumnWidths()
    }

    const resizeColumnBoundary = (columnIndex: number, deltaX: number): boolean => {
      if (columnIndex < 0 || columnIndex >= draftHeaders.length - 1) {
        return false
      }
      const pixelWidths = getColumnPixelWidths()
      const leftWidth = pixelWidths[columnIndex] ?? 0
      const rightWidth = pixelWidths[columnIndex + 1] ?? 0
      const pairWidth = leftWidth + rightWidth
      if (!Number.isFinite(pairWidth) || pairWidth <= 0) {
        return false
      }
      const minimumWidth = Math.min(measureMinimumColumnWidth(), pairWidth / 2)
      const nextLeftWidth = Math.max(minimumWidth, Math.min(pairWidth - minimumWidth, leftWidth + deltaX))
      const nextRightWidth = pairWidth - nextLeftWidth
      pixelWidths[columnIndex] = nextLeftWidth
      pixelWidths[columnIndex + 1] = nextRightWidth
      setColumnPixelWidths(pixelWidths)
      return true
    }

    const startColumnResize = (event: PointerEvent, columnIndex: number) => {
      if (event.button !== 0 || view.state.readOnly) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      closeContextMenu()

      const startX = event.clientX
      const startPixelWidths = getColumnPixelWidths()
      const pointerId = event.pointerId
      const target = event.currentTarget instanceof HTMLElement ? event.currentTarget : null
      try {
        target?.setPointerCapture(pointerId)
      } catch {
        // Pointer capture can fail when the handle is already detached during a rerender.
      }

      const applyResize = (clientX: number) => {
        setColumnPixelWidths(startPixelWidths)
        resizeColumnBoundary(columnIndex, clientX - startX)
      }

      const finishResize = (clientX: number) => {
        window.removeEventListener('pointermove', onPointerMove)
        window.removeEventListener('pointerup', onPointerUp)
        window.removeEventListener('pointercancel', onPointerCancel)
        try {
          target?.releasePointerCapture(pointerId)
        } catch {
          // Safe no-op if capture was never acquired.
        }
        applyResize(clientX)
        persistColumnWidths = true
        commit(view.state.selection.main.head)
      }

      const onPointerMove = (moveEvent: PointerEvent) => {
        if (moveEvent.pointerId !== pointerId) {
          return
        }
        moveEvent.preventDefault()
        applyResize(moveEvent.clientX)
      }

      const onPointerUp = (upEvent: PointerEvent) => {
        if (upEvent.pointerId !== pointerId) {
          return
        }
        finishResize(upEvent.clientX)
      }

      const onPointerCancel = (cancelEvent: PointerEvent) => {
        if (cancelEvent.pointerId !== pointerId) {
          return
        }
        finishResize(cancelEvent.clientX)
      }

      window.addEventListener('pointermove', onPointerMove, { passive: false })
      window.addEventListener('pointerup', onPointerUp)
      window.addEventListener('pointercancel', onPointerCancel)
    }

    const createCellControl = (
      cell: HTMLTableCellElement,
      value: string,
      ariaLabel: string,
      onValueChange: (nextValue: string) => void,
      rowIndex: number | null,
      columnIndex: number
    ) => {
      cell.className = 'cm-md-table-cell'
      const display = document.createElement('div')
      display.className = 'cm-md-table-cell-value'
      display.tabIndex = 0
      display.setAttribute('role', 'textbox')
      display.setAttribute('aria-readonly', String(view.state.readOnly))
      display.setAttribute('aria-label', ariaLabel)
      renderMarkdownTableCellContent(display, value, renderContext)

      const input = document.createElement('textarea')
      input.hidden = true
      input.value = value
      input.readOnly = view.state.readOnly
      input.dataset.tableRow = rowIndex === null ? 'header' : String(rowIndex)
      input.dataset.tableColumn = String(columnIndex)
      input.ariaLabel = ariaLabel
      resizeTableInput(input)

      display.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) {
          return
        }
        const target = event.target
        if (target instanceof HTMLElement && target.closest('[data-table-inline-action="true"]')) {
          return
        }
        event.preventDefault()
        event.stopPropagation()
        activateTableControl(tableControls.indexOf(input))
      })
      display.addEventListener('keydown', (event) => {
        if (isContextMenuKey(event)) {showCellContextMenu(event,rowIndex,columnIndex); return}
        if (event.key !== 'Enter' && event.key !== 'F2') {
          return
        }
        event.preventDefault()
        activateTableControl(tableControls.indexOf(input), event.key === 'Enter')
      })
      display.addEventListener('contextmenu', (event) => showCellContextMenu(event, rowIndex, columnIndex))
      input.addEventListener('input', () => {
        onValueChange(input.value)
        resizeTableInput(input)
      })
      input.addEventListener('keydown', handleCellKeyDown)
      input.addEventListener('contextmenu', (event) => showCellContextMenu(event, rowIndex, columnIndex))
      input.addEventListener('blur', commitOnBlur)
      tableControls.push(input)
      tableDisplays.push(display)
      displayByInput.set(input, display)
      cell.appendChild(display)
      cell.appendChild(input)
    }

    draftHeaders.forEach((header, columnIndex) => {
      const cell = document.createElement('th')
      createCellControl(
        cell,
        header,
        `Tabellenkopf ${columnIndex + 1}`,
        (nextValue) => {
          draftHeaders[columnIndex] = nextValue
        },
        null,
        columnIndex
      )
      if (columnIndex < columnCount - 1) {
        const resizeHandle = document.createElement('span')
        resizeHandle.className = 'cm-md-table-column-resize-handle'
        resizeHandle.tabIndex = 0
        resizeHandle.title = 'Spaltenbreite anpassen'
        resizeHandle.setAttribute('role', 'separator')
        resizeHandle.setAttribute('aria-label', `Breite zwischen Spalte ${columnIndex + 1} und ${columnIndex + 2} anpassen`)
        resizeHandle.setAttribute('aria-orientation', 'vertical')
        resizeHandle.addEventListener('pointerdown', (event) => startColumnResize(event, columnIndex))
        resizeHandle.addEventListener('keydown', (event) => {
          if (view.state.readOnly) return
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
            return
          }
          event.preventDefault()
          event.stopPropagation()
          const direction = event.key === 'ArrowLeft' ? -1 : 1
          const step = event.shiftKey ? 24 : 12
          if (resizeColumnBoundary(columnIndex, direction * step)) {
            persistColumnWidths = true
            commit(view.state.selection.main.head)
          }
        })
        cell.appendChild(resizeHandle)
      }
      headerRow.appendChild(cell)
    })
    thead.appendChild(headerRow)
    table.appendChild(thead)

    const tbody = document.createElement('tbody')
    draftRows.forEach((row, rowIndex) => {
      const tr = document.createElement('tr')
      row.forEach((value, columnIndex) => {
        const cell = document.createElement('td')
        createCellControl(
          cell,
          value,
          `Tabellenzelle ${rowIndex + 1}, ${columnIndex + 1}`,
          (nextValue) => {
            draftRows[rowIndex][columnIndex] = nextValue
          },
          rowIndex,
          columnIndex
        )
        tr.appendChild(cell)
      })
      tbody.appendChild(tr)
    })
    table.appendChild(tbody)
    wrapper.appendChild(table)
    return wrapper
  }

  destroy(dom: HTMLElement): void {
    tableWidgetLifecycle.get(dom)?.close()
    tableWidgetLifecycle.delete(dom)
  }

  ignoreEvent(): boolean {
    return true
  }
}

function parseInlineTagsInLine(lineText: string, lineFrom: number): ParsedInlineTag[] {
  const matches: ParsedInlineTag[] = []
  INLINE_TAG_PATTERN.lastIndex = 0
  let result = INLINE_TAG_PATTERN.exec(lineText)

  while (result) {
    const full = result[0] ?? ''
    const groupId = (result[1] ?? '').toLowerCase()
    const tagId = (result[2] ?? '').toLowerCase()
    if (full && groupId && tagId) {
      matches.push({
        from: lineFrom + result.index,
        to: lineFrom + result.index + full.length,
        groupId,
        tagId,
        syntax: full,
      })
    }
    result = INLINE_TAG_PATTERN.exec(lineText)
  }

  return matches
}

function extractMarkdownTarget(rawTarget: string): string {
  const clean = rawTarget.trim()
  if (!clean) {
    return ''
  }
  if (clean.startsWith('<')) {
    const end = clean.indexOf('>')
    if (end > 1) {
      return clean.slice(1, end).trim()
    }
  }
  if (clean.includes(' "')) {
    return clean.split(' "', 1)[0]?.trim() ?? ''
  }
  if (clean.includes(" '")) {
    return clean.split(" '", 1)[0]?.trim() ?? ''
  }
  return clean
}

function clampImageDimension(value: number): number {
  if (!Number.isFinite(value)) {
    return 320
  }
  return Math.max(80, Math.min(2400, Math.round(value)))
}

function parseImageSizeAttributes(rawAttributes: string | undefined): { width: number | null; height: number | null } {
  const input = (rawAttributes ?? '').trim()
  if (!input) {
    return { width: null, height: null }
  }

  const widthMatches = Array.from(input.matchAll(/\b(?:w|width)\s*=\s*(\d{1,5})\b/gi))
  const heightMatches = Array.from(input.matchAll(/\b(?:h|height)\s*=\s*(\d{1,5})\b/gi))
  const widthMatch = widthMatches.length > 0 ? widthMatches[widthMatches.length - 1] : null
  const heightMatch = heightMatches.length > 0 ? heightMatches[heightMatches.length - 1] : null

  const width = widthMatch && widthMatch[1] ? clampImageDimension(Number.parseInt(widthMatch[1], 10)) : null
  const height = heightMatch && heightMatch[1] ? clampImageDimension(Number.parseInt(heightMatch[1], 10)) : null
  return { width, height }
}

function sanitizeAltForMarkdown(value: string): string {
  return value.replace(/[\r\n]/g, ' ').replace(/]/g, '\\]').trim()
}

function buildImageMarkdown(alt: string, source: string, width: number, height: number): string {
  const safeAlt = sanitizeAltForMarkdown(alt)
  const safeWidth = clampImageDimension(width)
  const safeHeight = clampImageDimension(height)
  return `![${safeAlt}](${source}){width=${safeWidth} height=${safeHeight}}`
}

function parseInlineImagesInLine(lineText: string, lineFrom: number): ParsedInlineImage[] {
  const matches: ParsedInlineImage[] = []
  INLINE_IMAGE_PATTERN.lastIndex = 0
  let result = INLINE_IMAGE_PATTERN.exec(lineText)

  while (result) {
    const full = result[0] ?? ''
    const alt = (result[1] ?? '').trim()
    const source = extractMarkdownTarget(result[2] ?? '')
    const size = parseImageSizeAttributes(result[3])
    if (full && source) {
      matches.push({
        from: lineFrom + result.index,
        to: lineFrom + result.index + full.length,
        alt,
        source,
        width: size.width,
        height: size.height,
      })
    }
    result = INLINE_IMAGE_PATTERN.exec(lineText)
  }

  return matches
}

function parseMarkdownLinksInLine(lineText: string, lineFrom: number): ParsedMarkdownLink[] {
  const matches: ParsedMarkdownLink[] = []
  INLINE_MARKDOWN_LINK_PATTERN.lastIndex = 0
  let result = INLINE_MARKDOWN_LINK_PATTERN.exec(lineText)

  while (result) {
    const full = result[0] ?? ''
    const prefixLength = result[1]?.length ?? 0
    const text = (result[2] ?? '').trim()
    const url = extractMarkdownTarget(result[3] ?? '')
    if (full && text && url) {
      const from = lineFrom + result.index + prefixLength
      matches.push({
        from,
        to: lineFrom + result.index + full.length,
        text,
        url,
      })
    }
    result = INLINE_MARKDOWN_LINK_PATTERN.exec(lineText)
  }

  return matches
}

function parseWikiLinksInLine(lineText: string, lineFrom: number): ParsedWikiLink[] {
  const matches: ParsedWikiLink[] = []
  WIKILINK_PATTERN.lastIndex = 0
  let result = WIKILINK_PATTERN.exec(lineText)

  while (result) {
    const full = result[0] ?? ''
    const innerTarget = result[1] ?? ''
    const target = normalizeWikiLinkTarget(innerTarget)
    if (full && target) {
      matches.push({
        from: lineFrom + result.index,
        to: lineFrom + result.index + full.length,
        target,
        displayText: getWikiLinkDisplayText(innerTarget, target),
      })
    }
    result = WIKILINK_PATTERN.exec(lineText)
  }

  return matches
}

function getWikiLinkDisplayText(raw: string, target: string): string {
  const pipeIndex = raw.indexOf('|')
  if (pipeIndex >= 0) {
    const alias = raw.slice(pipeIndex + 1).trim()
    if (alias) {
      return alias
    }
  }
  const cleanTarget = target.replace(/\\/g, '/').replace(/\.md$/i, '').trim()
  const parts = cleanTarget.split('/').filter(Boolean)
  return parts.at(-1) ?? cleanTarget
}

function addRange(entries: DecorationEntry[], from: number, to: number, decoration: Decoration): void {
  if (from >= to) {
    return
  }
  entries.push({ from, to, decoration })
}

function addLineClass(entries: DecorationEntry[], lineFrom: number, className: string, seen: Set<string>): void {
  const key = `${lineFrom}:${className}`
  if (seen.has(key)) {
    return
  }
  seen.add(key)
  entries.push({ from: lineFrom, to: lineFrom, decoration: Decoration.line({ class: className }), line: true })
}

function addLineClassesForRange(
  entries: DecorationEntry[],
  doc: EditorState['doc'],
  from: number,
  to: number,
  className: string,
  seen: Set<string>
): void {
  const end = Math.max(from, to - 1)
  let line = doc.lineAt(from)
  const endLine = doc.lineAt(end).number
  while (true) {
    addLineClass(entries, line.from, className, seen)
    if (line.number >= endLine) {
      break
    }
    line = doc.line(line.number + 1)
  }
}

function addSyntaxVisibilityRange(
  entries: DecorationEntry[],
  from: number,
  to: number,
  isActive: boolean,
  visibleDeco: Decoration = syntaxVisibleDeco,
  mutedDeco: Decoration = syntaxMutedDeco
): void {
  addRange(entries, from, to, isActive ? visibleDeco : mutedDeco)
}

function extendRangeToFollowingWhitespace(doc: EditorState['doc'], from: number, to: number): number {
  const line = doc.lineAt(from)
  let cursor = to
  while (cursor < line.to) {
    const char = doc.sliceString(cursor, cursor + 1)
    if (char !== ' ' && char !== '\t') {
      break
    }
    cursor += 1
  }
  return cursor
}

function intersectsSelection(from: number, to: number, selections: readonly SelectionRange[]): boolean {
  return selections.some((selection) => {
    if (selection.from === selection.to) {
      return selection.from >= from && selection.from <= to
    }
    return selection.from < to && selection.to > from
  })
}

function isInsideRange(from: number, to: number, ranges: readonly SelectionRange[]): boolean {
  return ranges.some((range) => from >= range.from && to <= range.to)
}

function intersectsMarkdownLink(from: number, to: number, selections: readonly SelectionRange[]): boolean {
  return selections.some((selection) => {
    if (selection.from === selection.to) {
      return selection.from >= from && selection.from <= to
    }
    return selection.from < to && selection.to > from
  })
}

function intersectsImageMarkup(from: number, to: number, selections: readonly SelectionRange[]): boolean {
  return selections.some((selection) => {
    if (selection.from === selection.to) {
      return selection.from > from && selection.from < to
    }
    return selection.from < to && selection.to > from
  })
}

function ancestorRange(node: { parent: SyntaxLikeNode | null }, names: ReadonlySet<string>): { from: number; to: number } | null {
  let cursor = node.parent
  while (cursor) {
    if (names.has(cursor.name)) {
      return { from: cursor.from, to: cursor.to }
    }
    cursor = cursor.parent
  }
  return null
}

function resolveLinkRanges(linkNode: { firstChild: SyntaxLikeNode | null }): {
  firstMark: { from: number; to: number } | null
  secondMark: { from: number; to: number } | null
  urlRange: { from: number; to: number } | null
} {
  let firstMark: { from: number; to: number } | null = null
  let secondMark: { from: number; to: number } | null = null
  let urlRange: { from: number; to: number } | null = null

  let cursor: SyntaxLikeNode | null = linkNode.firstChild
  while (cursor) {
    if (cursor.name === 'LinkMark') {
      const range = { from: cursor.from, to: cursor.to }
      if (!firstMark) {
        firstMark = range
      } else if (!secondMark) {
        secondMark = range
      }
    }
    if (cursor.name === 'URL') {
      urlRange = { from: cursor.from, to: cursor.to }
    }
    cursor = cursor.nextSibling
  }

  return { firstMark, secondMark, urlRange }
}

function decorateTaskLines(
  entries: DecorationEntry[],
  view: EditorView,
  lineClassSeen: Set<string>,
  selections: readonly SelectionRange[],
  excludedRanges: readonly SelectionRange[]
): void {
  const processed = new Set<number>()
  for (const range of view.visibleRanges) {
    const end = Math.max(range.from, range.to - 1)
    let line = view.state.doc.lineAt(range.from)
    const endLine = view.state.doc.lineAt(end).number

    while (true) {
      if (!processed.has(line.number)) {
        if (lineIsInsideRange(line.from, line.to, excludedRanges)) {
          processed.add(line.number)
          if (line.number >= endLine) {
            break
          }
          line = view.state.doc.line(line.number + 1)
          continue
        }
        const match = line.text.match(/^(\s*[-+*]\s+)\[( |x|X)\](\s+|$)/)
        if (match) {
          const markerFrom = line.from + match[1].length
          const markerTo = markerFrom + 3
          const checked = match[2].toLowerCase() === 'x'
          const metadata = /\s+<!-- nn:todo created=[^ ]*(?: completed=[^ ]*)? -->\s+\^[A-Za-z0-9_-]+(?:\s+<!-- nn:todo:promoted:[^>]+ -->)?\s*$/.exec(line.text)
          if (metadata) {
            const from = line.from + metadata.index
            addSyntaxVisibilityRange(entries, from, line.to, intersectsSelection(from, line.to, selections))
          }

          const markerIsActive = intersectsSelection(Math.max(line.from, markerFrom - 1), Math.min(line.to, markerTo + 1), selections)

          addLineClass(entries, line.from, `cm-md-task-line ${checked ? 'cm-md-task-checked' : 'cm-md-task-open'}`, lineClassSeen)

          if (markerIsActive) {
            addRange(entries, markerFrom, markerTo, taskMarkerVisibleDeco)
          } else {
            addRange(entries, markerFrom, markerTo, Decoration.replace({ widget: new TaskCheckboxWidget(checked, markerFrom, markerTo) }))
          }
        }
        processed.add(line.number)
      }

      if (line.number >= endLine) {
        break
      }
      line = view.state.doc.line(line.number + 1)
    }
  }
}

function decorateInlineTags(
  entries: DecorationEntry[],
  view: EditorView,
  selections: readonly SelectionRange[],
  lookup: TagLookup,
  excludedRanges: readonly SelectionRange[]
): void {
  const processedLines = new Set<number>()
  for (const range of view.visibleRanges) {
    const end = Math.max(range.from, range.to - 1)
    let line = view.state.doc.lineAt(range.from)
    const endLine = view.state.doc.lineAt(end).number

    while (true) {
      if (!processedLines.has(line.number)) {
        if (lineIsInsideRange(line.from, line.to, excludedRanges)) {
          processedLines.add(line.number)
          if (line.number >= endLine) {
            break
          }
          line = view.state.doc.line(line.number + 1)
          continue
        }
        const tags = parseInlineTagsInLine(line.text, line.from)
        for (const tag of tags) {
          const tagIsActive = intersectsSelection(Math.max(line.from, tag.from - 1), Math.min(line.to, tag.to + 1), selections)
          if (tagIsActive) {
            addRange(entries, tag.from, tag.to, inlineTagSourceDeco)
            continue
          }

          const resolved = findTagDefinition(lookup, tag.groupId, tag.tagId)
          const groupDisplayName = resolved?.group.displayName ?? tag.groupId
          const tagDisplayName = resolved?.tag.displayName ?? tag.tagId
          const groupColor = resolved?.group.color ?? DEFAULT_TAG_GROUP_COLOR
          addRange(
            entries,
            tag.from,
            tag.to,
            Decoration.replace({
              widget: new InlineTagWidget(tag.groupId, tag.tagId, groupDisplayName, tagDisplayName, groupColor, tag.syntax),
            })
          )
        }
        processedLines.add(line.number)
      }

      if (line.number >= endLine) {
        break
      }
      line = view.state.doc.line(line.number + 1)
    }
  }
}

function lineIsInsideRange(lineFrom: number, lineTo: number, ranges: readonly SelectionRange[]): boolean {
  return ranges.some((range) => lineFrom >= range.from && lineTo <= range.to)
}

function decorateInlineImages(
  entries: DecorationEntry[],
  view: EditorView,
  selections: readonly SelectionRange[],
  options: LivePreviewOptions,
  excludedRanges: readonly SelectionRange[]
): void {
  const notePath = (options.notePath ?? '').trim()
  const backendUrl = (options.backendUrl ?? '').trim()
  if (!notePath || !backendUrl) {
    return
  }

  const processedLines = new Set<number>()
  for (const range of view.visibleRanges) {
    const end = Math.max(range.from, range.to - 1)
    let line = view.state.doc.lineAt(range.from)
    const endLine = view.state.doc.lineAt(end).number

    while (true) {
      if (!processedLines.has(line.number)) {
        if (lineIsInsideRange(line.from, line.to, excludedRanges)) {
          processedLines.add(line.number)
          if (line.number >= endLine) {
            break
          }
          line = view.state.doc.line(line.number + 1)
          continue
        }
        const images = parseInlineImagesInLine(line.text, line.from)
        for (const image of images) {
          if (/^(https?:\/\/|data:|file:\/\/|mailto:)/i.test(image.source)) {
            continue
          }
          const imageIsActive = intersectsImageMarkup(image.from, image.to, selections)
          if (imageIsActive) {
            continue
          }

          addRange(
            entries,
            image.from,
            image.to,
            Decoration.replace({
              widget: new InlineImageWidget(
                image.alt,
                image.source,
                notePath,
                backendUrl,
                image.width,
                image.height,
                image.from,
                image.to
              ),
            })
          )
        }
        processedLines.add(line.number)
      }

      if (line.number >= endLine) {
        break
      }
      line = view.state.doc.line(line.number + 1)
    }
  }
}

function decorateMarkdownLinks(
  entries: DecorationEntry[],
  view: EditorView,
  selections: readonly SelectionRange[],
  excludedRanges: readonly SelectionRange[]
): void {
  const processedLines = new Set<number>()
  for (const range of view.visibleRanges) {
    const end = Math.max(range.from, range.to - 1)
    let line = view.state.doc.lineAt(range.from)
    const endLine = view.state.doc.lineAt(end).number

    while (true) {
      if (!processedLines.has(line.number)) {
        if (lineIsInsideRange(line.from, line.to, excludedRanges)) {
          processedLines.add(line.number)
          if (line.number >= endLine) {
            break
          }
          line = view.state.doc.line(line.number + 1)
          continue
        }
        const links = parseMarkdownLinksInLine(line.text, line.from)
        for (const link of links) {
          if (intersectsMarkdownLink(link.from, link.to, selections)) {
            continue
          }
          addRange(
            entries,
            link.from,
            link.to,
            Decoration.replace({
              widget: new MarkdownLinkWidget(link.text, link.url),
            })
          )
        }
        processedLines.add(line.number)
      }

      if (line.number >= endLine) {
        break
      }
      line = view.state.doc.line(line.number + 1)
    }
  }
}

function decorateWikiLinks(
  entries: DecorationEntry[],
  view: EditorView,
  selections: readonly SelectionRange[],
  excludedRanges: readonly SelectionRange[],
  linkTargets: readonly MarkdownPreviewLinkTarget[]
): void {
  const processedLines = new Set<number>()
  for (const range of view.visibleRanges) {
    const end = Math.max(range.from, range.to - 1)
    let line = view.state.doc.lineAt(range.from)
    const endLine = view.state.doc.lineAt(end).number

    while (true) {
      if (!processedLines.has(line.number)) {
        if (lineIsInsideRange(line.from, line.to, excludedRanges)) {
          processedLines.add(line.number)
          if (line.number >= endLine) {
            break
          }
          line = view.state.doc.line(line.number + 1)
          continue
        }
        const wikiLinks = parseWikiLinksInLine(line.text, line.from)
        for (const link of wikiLinks) {
          if (intersectsSelection(link.from, link.to, selections)) {
            addRange(entries, link.from, link.to, wikiLinkDeco)
            continue
          }
          addRange(
            entries,
            link.from,
            link.to,
            Decoration.replace({
              widget: new WikiLinkWidget(link.displayText, link.target, resolveWikiLinkTooltip(link.target, linkTargets)),
            })
          )
        }
        processedLines.add(line.number)
      }

      if (line.number >= endLine) {
        break
      }
      line = view.state.doc.line(line.number + 1)
    }
  }
}

function resolveWikiLinkTooltip(target: string, linkTargets: readonly MarkdownPreviewLinkTarget[]): string {
  const resolved = resolveWikiLinkRelativePath(target, linkTargets)
  return resolved || target
}

function resolveWikiLinkRelativePath(target: string, linkTargets: readonly MarkdownPreviewLinkTarget[]): string {
  const lookup = normalizeWikiLookup(target)
  if (!lookup) {
    return ''
  }

  const byRelativePath = linkTargets.filter((candidate) => normalizeWikiLookup(candidate.relativePath) === lookup)
  if (byRelativePath.length === 1) {
    return byRelativePath[0]?.relativePath ?? ''
  }

  const byTarget = linkTargets.filter((candidate) => normalizeWikiLookup(candidate.target) === lookup)
  if (byTarget.length === 1) {
    return byTarget[0]?.relativePath ?? ''
  }

  const byTitle = linkTargets.filter((candidate) => normalizeWikiLookup(candidate.title) === lookup)
  if (byTitle.length === 1) {
    return byTitle[0]?.relativePath ?? ''
  }

  return ''
}

function normalizeWikiLookup(value: string): string {
  return value.replace(/\\/g, '/').replace(/\.md$/i, '').trim().toLowerCase()
}

function parseMarkdownTablesInState(state: EditorState, fromLine = 1, toLine = state.doc.lines): ParsedMarkdownTable[] {
  const tables: ParsedMarkdownTable[] = []
  const processedLines = new Set<number>()
  let line = state.doc.line(fromLine)
  const endLine = Math.max(fromLine, Math.min(toLine, state.doc.lines))

  while (true) {
    if (!processedLines.has(line.number)) {
      processedLines.add(line.number)
      const parsedColumnWidths = parseMarkdownTableWidthComment(line.text)
      const hasColumnWidths = parsedColumnWidths !== null
      const headerLine =
        hasColumnWidths && line.number < state.doc.lines
          ? state.doc.line(line.number + 1)
          : line
      const separatorLineNumber = headerLine.number + 1
      const separatorLine = separatorLineNumber <= state.doc.lines ? state.doc.line(separatorLineNumber) : null

      if (separatorLine && isPotentialMarkdownTableRow(headerLine.text)) {
        const headers = splitMarkdownTableRow(headerLine.text)
        if (headers.length >= 1 && isMarkdownTableSeparator(separatorLine.text, headers.length)) {
          const rows: string[][] = []
          let lastLine = separatorLine
          let cursorLineNumber = separatorLine.number + 1
          processedLines.add(headerLine.number)
          processedLines.add(separatorLine.number)
          while (cursorLineNumber <= state.doc.lines) {
            const cursorLine = state.doc.line(cursorLineNumber)
            if (!isPotentialMarkdownTableRow(cursorLine.text)) {
              break
            }
            const row = splitMarkdownTableRow(cursorLine.text)
            if (row.length !== headers.length) {
              break
            }
            rows.push(row)
            processedLines.add(cursorLine.number)
            lastLine = cursorLine
            cursorLineNumber += 1
          }
          tables.push({
            from: line.from,
            to: lastLine.to,
            headers,
            rows,
            columnWidths: normalizeMarkdownTableColumnWidths(parsedColumnWidths ?? [], headers.length),
            hasColumnWidths,
          })
        }
      }
    }

    if (line.number >= endLine) {
      break
    }
    line = state.doc.line(line.number + 1)
  }

  return tables
}

function getMarkdownTableRenderContext(state: EditorState): MarkdownTableRenderContext {
  const options = state.facet(markdownTableOptionsFacet)
  return {
    tagLookup: state.facet(markdownTagLookupFacet),
    readOnly: state.readOnly,
    linkTargets: options.linkTargets,
    onOpenWikiLink: options.onOpenWikiLink,
    onOpenTagReference: options.onOpenTagReference,
    onTableContextMenu: options.onTableContextMenu,
  }
}

function buildMarkdownTableDecorations(state: EditorState): DecorationSet {
  const ranges: ReturnType<Decoration['range']>[] = []
  const tables = parseMarkdownTablesInState(state)
  const tableContext = getMarkdownTableRenderContext(state)
  for (const table of tables) {
    ranges.push(
      Decoration.replace({
        widget: new MarkdownTableWidget(
          table.headers,
          table.rows,
          table.columnWidths,
          table.hasColumnWidths,
          table.from,
          table.to,
          tableContext
        ),
      }).range(table.from, table.to)
    )
  }
  return ranges.length > 0 ? Decoration.set(ranges, true) : Decoration.none
}

const markdownTableDecorationsField = StateField.define<DecorationSet>({
  create(state) {
    return buildMarkdownTableDecorations(state)
  },
  update(value, transaction) {
    const tagLookupChanged = transaction.startState.facet(markdownTagLookupFacet) !== transaction.state.facet(markdownTagLookupFacet)
    const tableOptionsChanged =
      transaction.startState.facet(markdownTableOptionsFacet) !== transaction.state.facet(markdownTableOptionsFacet)
    return transaction.docChanged || tagLookupChanged || tableOptionsChanged || transaction.startState.readOnly !== transaction.state.readOnly ? buildMarkdownTableDecorations(transaction.state) : value.map(transaction.changes)
  },
  provide: (field) => EditorView.decorations.from(field),
})

function buildDecorations(view: EditorView, options: LivePreviewOptions): DecorationSet {
  const entries: DecorationEntry[] = []
  const doc = view.state.doc
  const selections = view.state.selection.ranges.map((range) => ({ from: range.from, to: range.to }))
  const lineClassSeen = new Set<string>()
  const tagLookup = view.state.facet(markdownTagLookupFacet)
  const tables = parseMarkdownTablesInState(view.state)
  const tableRanges = tables.map((table) => ({ from: table.from, to: table.to }))

  for (const range of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from: range.from,
      to: range.to,
      enter: (node) => {
        if (isInsideRange(node.from, node.to, tableRanges)) {
          return false
        }

        if (/^ATXHeading[1-6]$/.test(node.name)) {
          const level = Number(node.name.slice(-1))
          const lineFrom = doc.lineAt(node.from).from
          addLineClass(entries, lineFrom, `cm-md-heading cm-md-h${level}`, lineClassSeen)
          return
        }

        if (node.name === 'StrongEmphasis') {
          addRange(entries, node.from, node.to, strongDeco)
          return
        }

        if (node.name === 'Emphasis') {
          addRange(entries, node.from, node.to, emphasisDeco)
          return
        }

        if (node.name === 'InlineCode') {
          addRange(entries, node.from, node.to, inlineCodeDeco)
          return
        }

        if (node.name === 'FencedCode') {
          addRange(entries, node.from, node.to, codeBlockDeco)
          addLineClassesForRange(entries, doc, node.from, node.to, 'cm-md-code-line', lineClassSeen)
          return
        }

        if (node.name === 'Blockquote') {
          addLineClassesForRange(entries, doc, node.from, node.to, 'cm-md-quote-line', lineClassSeen)
          return
        }

        if (node.name === 'ListItem') {
          const lineFrom = doc.lineAt(node.from).from
          addLineClass(entries, lineFrom, 'cm-md-list-line', lineClassSeen)
          return
        }

        if (node.name === 'HorizontalRule') {
          const lineFrom = doc.lineAt(node.from).from
          addLineClass(entries, lineFrom, 'cm-md-hr-line', lineClassSeen)
          addSyntaxVisibilityRange(entries, node.from, node.to, intersectsSelection(node.from, node.to, selections))
          return
        }

        if (node.name === 'Link') {
          const { firstMark, secondMark, urlRange } = resolveLinkRanges(node.node)
          const isActive = intersectsSelection(node.from, node.to, selections)
          if (firstMark && secondMark && firstMark.to < secondMark.from) {
            addRange(entries, firstMark.to, secondMark.from, linkTextDeco)
          }
          if (urlRange) {
            addRange(entries, urlRange.from, urlRange.to, isActive ? linkUrlDeco : syntaxMutedDeco)
          }
          return
        }

        if (node.name === 'HeaderMark') {
          const owner = ancestorRange(node.node, HEADING_OWNER_NAMES)
          const isActive = owner ? intersectsSelection(owner.from, owner.to, selections) : intersectsSelection(node.from, node.to, selections)
          const syntaxTo = isActive ? node.to : extendRangeToFollowingWhitespace(doc, node.from, node.to)
          addSyntaxVisibilityRange(entries, node.from, syntaxTo, isActive)
          return
        }

        if (node.name === 'EmphasisMark') {
          const owner = ancestorRange(node.node, EMPHASIS_OWNER_NAMES)
          const isActive = owner ? intersectsSelection(owner.from, owner.to, selections) : intersectsSelection(node.from, node.to, selections)
          addSyntaxVisibilityRange(entries, node.from, node.to, isActive)
          return
        }

        if (node.name === 'CodeMark') {
          const owner = ancestorRange(node.node, CODE_OWNER_NAMES)
          const isActive = owner ? intersectsSelection(owner.from, owner.to, selections) : intersectsSelection(node.from, node.to, selections)
          addSyntaxVisibilityRange(entries, node.from, node.to, isActive)
          return
        }

        if (node.name === 'QuoteMark') {
          const owner = ancestorRange(node.node, BLOCKQUOTE_OWNER_NAMES)
          const isActive = owner ? intersectsSelection(owner.from, owner.to, selections) : intersectsSelection(node.from, node.to, selections)
          addSyntaxVisibilityRange(entries, node.from, node.to, isActive, quoteMarkVisibleDeco, quoteMarkMutedDeco)
          return
        }

        if (node.name === 'ListMark') {
          addSyntaxVisibilityRange(entries, node.from, node.to, true, listMarkVisibleDeco, listMarkMutedDeco)
          return
        }

        if (node.name === 'LinkMark') {
          const owner = ancestorRange(node.node, LINK_OWNER_NAMES)
          const isActive = owner ? intersectsSelection(owner.from, owner.to, selections) : intersectsSelection(node.from, node.to, selections)
          addSyntaxVisibilityRange(entries, node.from, node.to, isActive)
        }
      },
    })
  }

  decorateTaskLines(entries, view, lineClassSeen, selections, tableRanges)
  decorateInlineTags(entries, view, selections, tagLookup, tableRanges)
  decorateInlineImages(entries, view, selections, options, tableRanges)
  decorateMarkdownLinks(entries, view, selections, tableRanges)
  decorateWikiLinks(entries, view, selections, tableRanges, options.linkTargets ?? [])

  const ranges = entries.map((entry) => (entry.line ? entry.decoration.range(entry.from) : entry.decoration.range(entry.from, entry.to)))
  return Decoration.set(ranges, true)
}

function findLinkUrlAtPosition(state: EditorState, position: number): string | null {
  let cursor: SyntaxLikeNode | null = syntaxTree(state).resolveInner(position, -1) as SyntaxLikeNode
  while (cursor) {
    if (cursor.name === 'Link') {
      let child: SyntaxLikeNode | null = cursor.firstChild
      while (child) {
        if (child.name === 'URL') {
          return state.doc.sliceString(child.from, child.to)
        }
        child = child.nextSibling
      }
      return null
    }
    cursor = cursor.parent
  }
  return null
}

function findMarkdownLinkUrlAtPosition(state: EditorState, position: number): string | null {
  if (position < 0 || position > state.doc.length) {
    return null
  }

  const line = state.doc.lineAt(position)
  const pattern = /(^|[^!])\[([^\]\n]+)\]\(([^)\n]+)\)/g
  let match = pattern.exec(line.text)
  while (match) {
    const prefixLength = match[1]?.length ?? 0
    const full = match[0] ?? ''
    const from = line.from + match.index + prefixLength
    const to = line.from + match.index + full.length
    if (position >= from && position <= to) {
      return extractMarkdownTarget(match[3] ?? '')
    }
    match = pattern.exec(line.text)
  }

  return null
}

function findLinkUrlFromPointerEvent(view: EditorView, event: MouseEvent | PointerEvent): string {
  const position = view.posAtCoords({ x: event.clientX, y: event.clientY })
  if (typeof position !== 'number') {
    return ''
  }
  return (findMarkdownLinkUrlAtPosition(view.state, position) ?? findLinkUrlAtPosition(view.state, position) ?? '').trim()
}

function normalizeExternalUrl(rawUrl: string): string {
  const cleanUrl = rawUrl.trim()
  if (/^(https?:\/\/|mailto:|file:\/\/)/i.test(cleanUrl)) {
    return cleanUrl
  }
  if (/^(?:www\.)?[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(?:[/?#].*)?$/i.test(cleanUrl)) {
    return `https://${cleanUrl}`
  }
  return ''
}

async function openExternalUrl(url: string): Promise<void> {
  const normalizedUrl = normalizeExternalUrl(url)
  if (!normalizedUrl) {
    return
  }
  if (window.nicknotes?.openExternalUrl) {
    try {
      const result = await window.nicknotes.openExternalUrl(normalizedUrl)
      if (!result?.ok) {
        window.alert(result?.message || 'Externer Link wurde von den Sicherheitsregeln blockiert.')
      }
    } catch {
      window.alert('Externer Link konnte nicht geöffnet werden.')
    }
    return
  }
  window.open(normalizedUrl, '_blank', 'noopener,noreferrer')
}

function openLinkFromPointerEvent(view: EditorView, event: MouseEvent | PointerEvent): boolean {
  if (event.button !== 0) {
    return false
  }

  const target = event.target
  const widget = target instanceof HTMLElement ? target.closest<HTMLElement>('.cm-md-markdown-link-widget') : null
  const rawUrl = widget?.dataset.url ?? findLinkUrlFromPointerEvent(view, event)
  const url = normalizeExternalUrl(rawUrl)
  if (!url) {
    return false
  }

  event.preventDefault()
  event.stopPropagation()
  void openExternalUrl(url)
  return true
}

function openWikiLinkFromPointerEvent(
  view: EditorView,
  event: MouseEvent | PointerEvent,
  onOpenWikiLink: ((target: string) => void) | undefined
): boolean {
  if (event.button !== 0 || !onOpenWikiLink) {
    return false
  }

  const eventTarget = event.target
  const widget = eventTarget instanceof HTMLElement ? eventTarget.closest<HTMLElement>('.cm-md-wikilink-widget') : null
  const widgetTarget = widget?.dataset.wikiTarget?.trim()
  if (widgetTarget) {
    event.preventDefault()
    event.stopPropagation()
    onOpenWikiLink(widgetTarget)
    return true
  }

  const position = view.posAtCoords({ x: event.clientX, y: event.clientY })
  if (typeof position !== 'number') {
    return false
  }

  const wikiTarget = findWikiLinkTargetAtPosition(view.state, position)
  if (!wikiTarget) {
    return false
  }

  event.preventDefault()
  event.stopPropagation()
  onOpenWikiLink(wikiTarget)
  return true
}

function normalizeWikiLinkTarget(raw: string): string {
  let clean = raw.trim()
  if (!clean) {
    return ''
  }
  if (clean.includes('|')) {
    clean = clean.split('|', 1)[0]?.trim() ?? ''
  }
  if (clean.includes('#')) {
    clean = clean.split('#', 1)[0]?.trim() ?? ''
  }
  clean = clean.replace(/\\/g, '/').replace(/\.md$/i, '').trim()
  return clean
}

function findWikiLinkTargetAtPosition(state: EditorState, position: number): string | null {
  if (position < 0 || position > state.doc.length) {
    return null
  }

  const line = state.doc.lineAt(position)
  const text = line.text
  WIKILINK_PATTERN.lastIndex = 0

  let match = WIKILINK_PATTERN.exec(text)
  while (match) {
    const full = match[0] ?? ''
    const innerTarget = match[1] ?? ''
    const from = line.from + match.index
    const to = from + full.length
    if (position >= from && position < to) {
      const normalized = normalizeWikiLinkTarget(innerTarget)
      return normalized || null
    }
    match = WIKILINK_PATTERN.exec(text)
  }

  return null
}

function toggleTaskMarker(view: EditorView, markerFrom: number, markerTo: number): boolean {
  if (markerFrom < 0 || markerTo <= markerFrom || markerTo > view.state.doc.length) {
    return false
  }

  const current = view.state.doc.sliceString(markerFrom, markerTo)
  if (!/^\[(?: |x|X)\]$/.test(current)) {
    return false
  }

  const next = /\[[xX]\]/.test(current) ? '[ ]' : '[x]'
  view.dispatch({
    changes: { from: markerFrom, to: markerTo, insert: next },
    selection: { anchor: markerTo },
    scrollIntoView: false,
    userEvent: 'input.type',
  })
  return true
}

type ResizeDirection = 'nw' | 'ne' | 'sw' | 'se'

function startImageResize(
  view: EditorView,
  wrapper: HTMLElement,
  handle: HTMLElement,
  pointerDownEvent: PointerEvent
): boolean {
  const direction = (handle.dataset.resizeDirection ?? '') as ResizeDirection
  if (!['nw', 'ne', 'sw', 'se'].includes(direction)) {
    return false
  }
  if (pointerDownEvent.button !== 0) {
    return false
  }

  const from = Number.parseInt(wrapper.dataset.imageFrom ?? '', 10)
  const to = Number.parseInt(wrapper.dataset.imageTo ?? '', 10)
  const source = wrapper.dataset.imageSource ?? ''
  if (!Number.isFinite(from) || !Number.isFinite(to) || !source) {
    return false
  }

  const alt = wrapper.dataset.imageAlt ?? ''
  const image = wrapper.querySelector<HTMLImageElement>('.cm-md-image')
  if (!image) {
    return false
  }

  const startRect = image.getBoundingClientRect()
  const startWidth = Math.max(80, startRect.width)
  const startHeight = Math.max(80, startRect.height)
  const aspectRatio = startHeight > 0 ? startWidth / startHeight : 1
  const startX = pointerDownEvent.clientX
  const startY = pointerDownEvent.clientY
  const activePointerId = pointerDownEvent.pointerId
  let rafId: number | null = null
  let latestX = startX
  let latestY = startY

  try {
    handle.setPointerCapture(activePointerId)
  } catch {
    // Ignore pointer-capture failures and fall back to window listeners.
  }

  const applyResize = (clientX: number, clientY: number) => {
    const deltaX = clientX - startX
    const deltaY = clientY - startY

    const signedDeltaX = direction.includes('e') ? deltaX : -deltaX
    const signedDeltaY = direction.includes('s') ? deltaY : -deltaY
    const dominantDelta = Math.abs(signedDeltaX) >= Math.abs(signedDeltaY) ? signedDeltaX : signedDeltaY

    const width = clampImageDimension(startWidth + dominantDelta)
    const height = clampImageDimension(width / Math.max(0.1, aspectRatio))
    image.style.width = `${width}px`
    image.style.height = `${height}px`
    wrapper.dataset.imageWidth = String(width)
    wrapper.dataset.imageHeight = String(height)
  }

  const finishResize = () => {
    if (rafId !== null) {
      window.cancelAnimationFrame(rafId)
      rafId = null
    }
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
    window.removeEventListener('pointercancel', onPointerCancel)
    try {
      handle.releasePointerCapture(activePointerId)
    } catch {
      // Safe no-op if capture was never set or already released.
    }

    const width = clampImageDimension(Number.parseFloat(wrapper.dataset.imageWidth ?? String(startWidth)))
    const height = clampImageDimension(Number.parseFloat(wrapper.dataset.imageHeight ?? String(startHeight)))
    const nextMarkdown = buildImageMarkdown(alt, source, width, height)
    view.dispatch({
      changes: { from, to, insert: nextMarkdown },
      selection: { anchor: from + nextMarkdown.length },
      scrollIntoView: false,
      userEvent: 'input.type',
    })
    view.focus()
  }

  const onPointerMove = (event: PointerEvent) => {
    if (event.pointerId !== activePointerId) {
      return
    }
    if ((event.buttons & 1) === 0) {
      finishResize()
      return
    }
    event.preventDefault()
    latestX = event.clientX
    latestY = event.clientY
    if (rafId !== null) {
      return
    }
    rafId = window.requestAnimationFrame(() => {
      rafId = null
      applyResize(latestX, latestY)
    })
  }

  const onPointerUp = (event: PointerEvent) => {
    if (event.pointerId !== activePointerId) {
      return
    }
    finishResize()
  }

  const onPointerCancel = (event: PointerEvent) => {
    if (event.pointerId !== activePointerId) {
      return
    }
    finishResize()
  }

  window.addEventListener('pointermove', onPointerMove, { passive: false })
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', onPointerCancel)
  return true
}

function createMarkdownPreviewPlugin(options: LivePreviewOptions): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet

      constructor(view: EditorView) {
        this.decorations = buildDecorations(view, options)
        view.requestMeasure()
      }

      update(update: ViewUpdate): void {
        const configChanged = update.startState.facet(markdownTagLookupFacet) !== update.state.facet(markdownTagLookupFacet)
        if (update.docChanged || update.selectionSet || update.viewportChanged || configChanged) {
          this.decorations = buildDecorations(update.view, options)
          if (update.docChanged || update.viewportChanged) {
            update.view.requestMeasure()
          }
        }
      }
    },
    {
      decorations: (instance) => instance.decorations,
    }
  )
}

export function markdownTagLookupExtension(tagGroups: TagGroupDefinition[]): Extension {
  return markdownTagLookupFacet.of(buildTagLookup(tagGroups))
}

export function liveMarkdownPreview(options: LivePreviewOptions = {}): Extension {
  return [
    markdownTableOptionsFacet.of({
      linkTargets: options.linkTargets ?? EMPTY_LINK_TARGETS,
      onOpenWikiLink: options.onOpenWikiLink,
      onOpenTagReference: options.onOpenTagReference,
      onTableContextMenu: options.onTableContextMenu,
    }),
    markdownTableDecorationsField,
    createMarkdownPreviewPlugin(options),
    EditorView.domEventHandlers({
      pointerdown: (event, view) => {
        if (openLinkFromPointerEvent(view, event)) {
          return true
        }
        if (openWikiLinkFromPointerEvent(view, event, options.onOpenWikiLink)) {
          return true
        }

        const target = event.target
        if (!(target instanceof HTMLElement)) {
          return false
        }
        const resizeHandle = target.closest<HTMLElement>('.cm-md-image-handle')
        if (resizeHandle) {
          const imageWidget = resizeHandle.closest<HTMLElement>('.cm-md-image-widget')
          if (!imageWidget) {
            return false
          }
          event.preventDefault()
          event.stopPropagation()
          view.focus()
          return startImageResize(view, imageWidget, resizeHandle, event)
        }

        return false
      },
      dblclick: (event, view) => {
        if (event.button !== 0) {
          return false
        }

        const target = event.target
        if (!(target instanceof Node)) {
          return false
        }

        if (target instanceof HTMLElement && target.closest('.cm-md-task-checkbox')) {
          return false
        }
        if (target instanceof HTMLElement && target.closest('.cm-md-inline-tag-chip')) {
          return false
        }
        if (target instanceof HTMLElement && target.closest('.cm-md-image-widget')) {
          return false
        }

        let position = -1
        try {
          position = view.posAtDOM(target, 0)
        } catch {
          return false
        }

        if (position < 0 || position > view.state.doc.length) {
          return false
        }

        const word = view.state.wordAt(position) ?? view.state.wordAt(Math.max(0, position - 1))
        if (!word || word.from === word.to) {
          return false
        }

        event.preventDefault()
        view.focus()
        view.dispatch({
          selection: { anchor: word.from, head: word.to },
          scrollIntoView: false,
          userEvent: 'select.pointer',
        })
        return true
      },
      mousedown: (event, view) => {
        const target = event.target
        if (!(target instanceof HTMLElement)) {
          return false
        }

        const taskToggle = target.closest<HTMLElement>('.cm-md-task-checkbox')
        if (taskToggle) {
          const markerFrom = Number.parseInt(taskToggle.dataset.markerFrom ?? '', 10)
          const markerTo = Number.parseInt(taskToggle.dataset.markerTo ?? '', 10)
          if (Number.isFinite(markerFrom) && Number.isFinite(markerTo)) {
            event.preventDefault()
            view.focus()
            return toggleTaskMarker(view, markerFrom, markerTo)
          }
        }

        const tagChip = target.closest<HTMLElement>('.cm-md-inline-tag-chip')
        if (tagChip && event.button === 0 && options.onOpenTagReference) {
          const groupId = (tagChip.dataset.tagGroupId || '').trim()
          const tagId = (tagChip.dataset.tagId || '').trim()
          if (groupId && tagId) {
            event.preventDefault()
            event.stopPropagation()
            view.focus()
            options.onOpenTagReference(groupId, tagId)
            return true
          }
        }

        return false
      },
    }),
  ]
}
