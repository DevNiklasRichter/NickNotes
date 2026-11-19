import { RangeSetBuilder, type Extension } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'
import { isInvalidDateToken } from './inlineSuggestions'

const invalidMark = Decoration.mark({
  class: 'cm-invalid-date',
  attributes: { title: 'Kein gültiges Datum – so entsteht keine Fälligkeit (Beispiel: 20.11.2026)' },
})

const DATE_TOKEN = /(?:^|\s)(@[\d.-]+)(?=\s|$)/g

function build(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const cursor = view.state.selection.main.head
  for (const { from, to } of view.visibleRanges) {
    let line = view.state.doc.lineAt(from)
    for (;;) {
      DATE_TOKEN.lastIndex = 0
      for (let match = DATE_TOKEN.exec(line.text); match; match = DATE_TOKEN.exec(line.text)) {
        const start = line.from + match.index + match[0].length - match[1].length
        const end = start + match[1].length
        // The token under the cursor is still being typed; the date popup guides it.
        if (cursor >= start && cursor <= end) continue
        if (isInvalidDateToken(match[1].slice(1))) builder.add(start, end, invalidMark)
      }
      if (line.to >= to) break
      line = view.state.doc.line(line.number + 1)
    }
  }
  return builder.finish()
}

/** Underlines `@` dates that are not a real day, so a typo is visible instead of silently ignored. */
export function invalidDateMarks(): Extension {
  return ViewPlugin.fromClass(class {
    decorations: DecorationSet
    constructor(view: EditorView) { this.decorations = build(view) }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged || update.selectionSet) this.decorations = build(update.view)
    }
  }, { decorations: plugin => plugin.decorations })
}
