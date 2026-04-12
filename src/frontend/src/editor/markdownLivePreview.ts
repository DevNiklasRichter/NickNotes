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
const syntaxVisibleDeco = Decoration.mark({ class: 'cm-md-syntax-token cm-md-syntax-visible' })
const syntaxMutedDeco = Decoration.mark({ class: 'cm-md-syntax-token cm-md-syntax-muted' })
const listMarkVisibleDeco = Decoration.mark({ class: 'cm-md-list-mark cm-md-syntax-token cm-md-syntax-visible' })
const listMarkMutedDeco = Decoration.mark({ class: 'cm-md-list-mark cm-md-syntax-token cm-md-syntax-muted' })
const quoteMarkVisibleDeco = Decoration.mark({ class: 'cm-md-quote-mark cm-md-syntax-token cm-md-syntax-visible' })
const quoteMarkMutedDeco = Decoration.mark({ class: 'cm-md-quote-mark cm-md-syntax-token cm-md-syntax-muted' })
const taskMarkerVisibleDeco = Decoration.mark({ class: 'cm-md-task-marker cm-md-syntax-token cm-md-syntax-visible' })
const inlineTagSourceDeco = Decoration.mark({ class: 'cm-md-inline-tag-source' })

const INLINE_TAG_PATTERN = /\{tag:([A-Za-z0-9][A-Za-z0-9_-]*)\/([A-Za-z0-9][A-Za-z0-9_-]*)\}/g
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
  readonly groupDisplayName: string
  readonly tagDisplayName: string
  readonly groupColor: string
  readonly syntax: string

  constructor(groupDisplayName: string, tagDisplayName: string, groupColor: string, syntax: string) {
    super()
    this.groupDisplayName = groupDisplayName
    this.tagDisplayName = tagDisplayName
    this.groupColor = groupColor
    this.syntax = syntax
  }

  eq(other: InlineTagWidget): boolean {
    return (
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
    element.textContent = this.tagDisplayName
    element.title = `${this.groupDisplayName} / ${this.tagDisplayName}`
    element.setAttribute('aria-label', `Tag ${this.tagDisplayName}`)
    return element
  }

  ignoreEvent(): boolean {
    return true
  }
}

type ParsedInlineTag = {
  from: number
  to: number
  groupId: string
  tagId: string
  syntax: string
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

function intersectsSelection(from: number, to: number, selections: readonly SelectionRange[]): boolean {
  return selections.some((selection) => {
    if (selection.from === selection.to) {
      return selection.from >= from && selection.from <= to
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
              widget: new InlineTagWidget(groupDisplayName, tagDisplayName, groupColor, tag.syntax),
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

function buildDecorations(view: EditorView): DecorationSet {
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
          addSyntaxVisibilityRange(entries, node.from, node.to, isActive)
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

const markdownPreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view)
      view.requestMeasure()
    }

    update(update: ViewUpdate): void {
      const configChanged = update.startState.facet(markdownTagLookupFacet) !== update.state.facet(markdownTagLookupFacet)
      if (update.docChanged || update.selectionSet || update.viewportChanged || configChanged) {
        this.decorations = buildDecorations(update.view)
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

export function markdownTagLookupExtension(tagGroups: TagGroupDefinition[]): Extension {
  return markdownTagLookupFacet.of(buildTagLookup(tagGroups))
}

export function liveMarkdownPreview(): Extension {
  return [
    markdownPreviewPlugin,
    EditorView.domEventHandlers({
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

        if (event.button !== 0 || (!event.metaKey && !event.ctrlKey)) {
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
