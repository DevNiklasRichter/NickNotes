import { syntaxTree } from '@codemirror/language'
import { type EditorState, type Extension, RangeSetBuilder } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, ViewPlugin, WidgetType } from '@codemirror/view'

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

function addRange(builder: RangeSetBuilder<Decoration>, from: number, to: number, decoration: Decoration) {
  if (from >= to) {
    return
  }
  builder.add(from, to, decoration)
}

function addSyntaxVisibilityRange(
  builder: RangeSetBuilder<Decoration>,
  from: number,
  to: number,
  isActive: boolean,
  visibleDeco: Decoration = syntaxVisibleDeco,
  mutedDeco: Decoration = syntaxMutedDeco
): void {
  addRange(builder, from, to, isActive ? visibleDeco : mutedDeco)
}

function addLineClass(
  builder: RangeSetBuilder<Decoration>,
  lineFrom: number,
  className: string,
  seen: Set<string>
): void {
  const key = `${lineFrom}:${className}`
  if (seen.has(key)) {
    return
  }
  seen.add(key)
  builder.add(lineFrom, lineFrom, Decoration.line({ class: className }))
}

function addLineClassesForRange(
  builder: RangeSetBuilder<Decoration>,
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
    addLineClass(builder, line.from, className, seen)
    if (line.number >= endLine) {
      break
    }
    line = doc.line(line.number + 1)
  }
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
  markerRanges: Array<{ from: number; to: number }>
  labelRange: { from: number; to: number } | null
  urlRange: { from: number; to: number } | null
} {
  const markerRanges: Array<{ from: number; to: number }> = []
  let firstMark: { from: number; to: number } | null = null
  let secondMark: { from: number; to: number } | null = null
  let urlRange: { from: number; to: number } | null = null

  let cursor: SyntaxLikeNode | null = linkNode.firstChild
  while (cursor) {
    if (cursor.name === 'LinkMark') {
      const range = { from: cursor.from, to: cursor.to }
      markerRanges.push(range)
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

  const labelRange = firstMark && secondMark ? { from: firstMark.to, to: secondMark.from } : null
  return { markerRanges, labelRange, urlRange }
}

function decorateTaskLines(
  builder: RangeSetBuilder<Decoration>,
  view: EditorView,
  lineClassSeen: Set<string>,
  selections: readonly SelectionRange[]
): void {
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
          const lineIsActive = intersectsSelection(line.from, line.to, selections)

          addLineClass(
            builder,
            line.from,
            `cm-md-task-line ${checked ? 'cm-md-task-checked' : 'cm-md-task-open'}`,
            lineClassSeen
          )

          if (lineIsActive) {
            addRange(builder, markerFrom, markerTo, taskMarkerVisibleDeco)
          } else {
            builder.add(markerFrom, markerTo, Decoration.replace({ widget: new TaskCheckboxWidget(checked, markerFrom, markerTo) }))
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

function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const doc = view.state.doc
  const selections = view.state.selection.ranges.map((range) => ({ from: range.from, to: range.to }))
  const lineClassSeen = new Set<string>()

  for (const range of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from: range.from,
      to: range.to,
      enter: (node) => {
        if (/^ATXHeading[1-6]$/.test(node.name)) {
          const level = Number(node.name.slice(-1))
          const lineFrom = doc.lineAt(node.from).from
          addLineClass(builder, lineFrom, `cm-md-heading cm-md-h${level}`, lineClassSeen)
          return
        }

        if (node.name === 'StrongEmphasis') {
          addRange(builder, node.from, node.to, strongDeco)
          return
        }

        if (node.name === 'Emphasis') {
          addRange(builder, node.from, node.to, emphasisDeco)
          return
        }

        if (node.name === 'InlineCode') {
          addRange(builder, node.from, node.to, inlineCodeDeco)
          return
        }

        if (node.name === 'FencedCode') {
          addRange(builder, node.from, node.to, codeBlockDeco)
          addLineClassesForRange(builder, doc, node.from, node.to, 'cm-md-code-line', lineClassSeen)
          return
        }

        if (node.name === 'Blockquote') {
          addLineClassesForRange(builder, doc, node.from, node.to, 'cm-md-quote-line', lineClassSeen)
          return
        }

        if (node.name === 'ListItem') {
          const lineFrom = doc.lineAt(node.from).from
          addLineClass(builder, lineFrom, 'cm-md-list-line', lineClassSeen)
          return
        }

        if (node.name === 'HorizontalRule') {
          const lineFrom = doc.lineAt(node.from).from
          addLineClass(builder, lineFrom, 'cm-md-hr-line', lineClassSeen)
          addSyntaxVisibilityRange(builder, node.from, node.to, intersectsSelection(node.from, node.to, selections))
          return
        }

        if (node.name === 'Link') {
          const linkIsActive = intersectsSelection(node.from, node.to, selections)
          const { markerRanges, labelRange, urlRange } = resolveLinkRanges(node.node)
          if (labelRange) {
            addRange(builder, labelRange.from, labelRange.to, linkTextDeco)
          }
          if (urlRange) {
            addRange(builder, urlRange.from, urlRange.to, linkUrlDeco)
          }
          for (const markerRange of markerRanges) {
            addSyntaxVisibilityRange(builder, markerRange.from, markerRange.to, linkIsActive)
          }
          return
        }

        if (node.name === 'HeaderMark') {
          const owner = ancestorRange(node.node, HEADING_OWNER_NAMES)
          const isActive = owner ? intersectsSelection(owner.from, owner.to, selections) : intersectsSelection(node.from, node.to, selections)
          addSyntaxVisibilityRange(builder, node.from, node.to, isActive)
          return
        }

        if (node.name === 'EmphasisMark') {
          const owner = ancestorRange(node.node, EMPHASIS_OWNER_NAMES)
          const isActive = owner ? intersectsSelection(owner.from, owner.to, selections) : intersectsSelection(node.from, node.to, selections)
          addSyntaxVisibilityRange(builder, node.from, node.to, isActive)
          return
        }

        if (node.name === 'CodeMark') {
          const owner = ancestorRange(node.node, CODE_OWNER_NAMES)
          const isActive = owner ? intersectsSelection(owner.from, owner.to, selections) : intersectsSelection(node.from, node.to, selections)
          addSyntaxVisibilityRange(builder, node.from, node.to, isActive)
          return
        }

        if (node.name === 'QuoteMark') {
          const owner = ancestorRange(node.node, BLOCKQUOTE_OWNER_NAMES)
          const isActive = owner ? intersectsSelection(owner.from, owner.to, selections) : intersectsSelection(node.from, node.to, selections)
          addSyntaxVisibilityRange(builder, node.from, node.to, isActive, quoteMarkVisibleDeco, quoteMarkMutedDeco)
          return
        }

        if (node.name === 'ListMark') {
          const owner = ancestorRange(node.node, LIST_ITEM_OWNER_NAMES)
          const isActive = owner ? intersectsSelection(owner.from, owner.to, selections) : intersectsSelection(node.from, node.to, selections)
          addSyntaxVisibilityRange(builder, node.from, node.to, isActive, listMarkVisibleDeco, listMarkMutedDeco)
          return
        }

        if (node.name === 'LinkMark') {
          const owner = ancestorRange(node.node, LINK_OWNER_NAMES)
          const isActive = owner ? intersectsSelection(owner.from, owner.to, selections) : intersectsSelection(node.from, node.to, selections)
          addSyntaxVisibilityRange(builder, node.from, node.to, isActive)
        }
      },
    })
  }

  decorateTaskLines(builder, view, lineClassSeen, selections)
  return builder.finish()
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
    }

    update(update: { view: EditorView; docChanged: boolean; selectionSet: boolean; viewportChanged: boolean }): void {
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = buildDecorations(update.view)
      }
    }
  },
  {
    decorations: (instance) => instance.decorations,
  }
)

export function liveMarkdownPreview(): Extension {
  return [
    markdownPreviewPlugin,
    EditorView.domEventHandlers({
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
