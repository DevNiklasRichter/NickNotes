import { syntaxTree } from '@codemirror/language'
import { Facet, type EditorState, type Extension } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from '@codemirror/view'
import { buildTagLookup, findTagDefinition, type TagGroupDefinition, type TagLookup } from '../tags/tagTypes'

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
  notePath?: string
  backendUrl?: string
  onOpenWikiLink?: (target: string) => void
  onOpenTagReference?: (groupId: string, tagId: string) => void
}

const HEADING_OWNER_NAMES = new Set(['ATXHeading1', 'ATXHeading2', 'ATXHeading3', 'ATXHeading4', 'ATXHeading5', 'ATXHeading6'])
const EMPHASIS_OWNER_NAMES = new Set(['StrongEmphasis', 'Emphasis'])
const CODE_OWNER_NAMES = new Set(['InlineCode', 'FencedCode'])
const BLOCKQUOTE_OWNER_NAMES = new Set(['Blockquote'])
const LIST_ITEM_OWNER_NAMES = new Set(['ListItem'])
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
const WIKILINK_PATTERN = /\[\[([^[\]\n]+)\]\]/g
const EMPTY_TAG_LOOKUP = buildTagLookup([])

export const markdownTagLookupFacet = Facet.define<TagLookup, TagLookup>({
  combine(values) {
    return values.length > 0 ? values[values.length - 1] : EMPTY_TAG_LOOKUP
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
    image.src = `${cleanBackendUrl}/notes/media/content?${params.toString()}`
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

type ParsedWikiLink = {
  from: number
  to: number
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

function parseWikiLinksInLine(lineText: string, lineFrom: number): ParsedWikiLink[] {
  const matches: ParsedWikiLink[] = []
  WIKILINK_PATTERN.lastIndex = 0
  let result = WIKILINK_PATTERN.exec(lineText)

  while (result) {
    const full = result[0] ?? ''
    if (full) {
      matches.push({
        from: lineFrom + result.index,
        to: lineFrom + result.index + full.length,
      })
    }
    result = WIKILINK_PATTERN.exec(lineText)
  }

  return matches
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

function decorateTaskLines(entries: DecorationEntry[], view: EditorView, lineClassSeen: Set<string>, selections: readonly SelectionRange[]): void {
  const processed = new Set<number>()
  for (const range of view.visibleRanges) {
    const end = Math.max(range.from, range.to - 1)
    let line = view.state.doc.lineAt(range.from)
    const endLine = view.state.doc.lineAt(end).number

    while (true) {
      if (!processed.has(line.number)) {
        const match = line.text.match(/^(\s*[-+*]\s+)\[( |x|X)\](\s+|$)/)
        if (match) {
          const markerFrom = line.from + match[1].length
          const markerTo = markerFrom + 3
          const checked = match[2].toLowerCase() === 'x'
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

function decorateInlineTags(entries: DecorationEntry[], view: EditorView, selections: readonly SelectionRange[], lookup: TagLookup): void {
  const processedLines = new Set<number>()
  for (const range of view.visibleRanges) {
    const end = Math.max(range.from, range.to - 1)
    let line = view.state.doc.lineAt(range.from)
    const endLine = view.state.doc.lineAt(end).number

    while (true) {
      if (!processedLines.has(line.number)) {
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
          const groupColor = resolved?.group.color ?? '#4f8cff'
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

function decorateInlineImages(
  entries: DecorationEntry[],
  view: EditorView,
  selections: readonly SelectionRange[],
  options: LivePreviewOptions
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

function decorateWikiLinks(entries: DecorationEntry[], view: EditorView): void {
  const processedLines = new Set<number>()
  for (const range of view.visibleRanges) {
    const end = Math.max(range.from, range.to - 1)
    let line = view.state.doc.lineAt(range.from)
    const endLine = view.state.doc.lineAt(end).number

    while (true) {
      if (!processedLines.has(line.number)) {
        const wikiLinks = parseWikiLinksInLine(line.text, line.from)
        for (const link of wikiLinks) {
          addRange(entries, link.from, link.to, wikiLinkDeco)
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

function buildDecorations(view: EditorView, options: LivePreviewOptions): DecorationSet {
  const entries: DecorationEntry[] = []
  const doc = view.state.doc
  const selections = view.state.selection.ranges.map((range) => ({ from: range.from, to: range.to }))
  const lineClassSeen = new Set<string>()
  const tagLookup = view.state.facet(markdownTagLookupFacet)

  for (const range of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from: range.from,
      to: range.to,
      enter: (node) => {
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
          if (firstMark && secondMark && firstMark.to < secondMark.from) {
            addRange(entries, firstMark.to, secondMark.from, linkTextDeco)
          }
          if (urlRange) {
            addRange(entries, urlRange.from, urlRange.to, linkUrlDeco)
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
          const owner = ancestorRange(node.node, LIST_ITEM_OWNER_NAMES)
          const isActive = owner ? intersectsSelection(owner.from, owner.to, selections) : intersectsSelection(node.from, node.to, selections)
          addSyntaxVisibilityRange(entries, node.from, node.to, isActive, listMarkVisibleDeco, listMarkMutedDeco)
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

  decorateTaskLines(entries, view, lineClassSeen, selections)
  decorateInlineTags(entries, view, selections, tagLookup)
  decorateInlineImages(entries, view, selections, options)
  decorateWikiLinks(entries, view)

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
    createMarkdownPreviewPlugin(options),
    EditorView.domEventHandlers({
      pointerdown: (event, view) => {
        if (event.button !== 0) {
          return false
        }
        const target = event.target
        if (!(target instanceof HTMLElement)) {
          return false
        }
        const resizeHandle = target.closest<HTMLElement>('.cm-md-image-handle')
        if (!resizeHandle) {
          return false
        }
        const imageWidget = resizeHandle.closest<HTMLElement>('.cm-md-image-widget')
        if (!imageWidget) {
          return false
        }
        event.preventDefault()
        event.stopPropagation()
        view.focus()
        return startImageResize(view, imageWidget, resizeHandle, event)
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

        if (event.button !== 0) {
          return false
        }

        let position = -1
        try {
          position = view.posAtDOM(target, 0)
        } catch {
          return false
        }

        if (position < 0) {
          return false
        }

        const wikiTarget = findWikiLinkTargetAtPosition(view.state, position)
        if (wikiTarget && options.onOpenWikiLink) {
          event.preventDefault()
          event.stopPropagation()
          options.onOpenWikiLink(wikiTarget)
          return true
        }

        if (!event.metaKey && !event.ctrlKey) {
          return false
        }

        const url = findLinkUrlAtPosition(view.state, position)?.trim() ?? ''
        if (!url || !/^(https?:\/\/|mailto:|file:\/\/)/i.test(url)) {
          return false
        }

        event.preventDefault()
        window.open(url, '_blank', 'noopener,noreferrer')
        return true
      },
    }),
  ]
}
