import { indentLess, indentMore } from '@codemirror/commands'
import { EditorSelection } from '@codemirror/state'
import type { KeyBinding } from '@codemirror/view'
import { EditorView } from '@codemirror/view'

function wrapMainSelection(view: EditorView, left: string, right: string): boolean {
  const changes = view.state.changeByRange((range) => {
    const selected = view.state.doc.sliceString(range.from, range.to)
    if (!selected) {
      const insert = `${left}${right}`
      const cursor = range.from + left.length
      return {
        changes: { from: range.from, to: range.to, insert },
        range: EditorSelection.cursor(cursor),
      }
    }

    const insert = `${left}${selected}${right}`
    const selectionFrom = range.from + left.length
    return {
      changes: { from: range.from, to: range.to, insert },
      range: EditorSelection.range(selectionFrom, selectionFrom + selected.length),
    }
  })

  view.dispatch(
    view.state.update(changes, {
      scrollIntoView: true,
      userEvent: 'input.type',
    })
  )
  return true
}

function continueMarkdownOnEnter(view: EditorView): boolean {
  const selection = view.state.selection.main
  if (!selection.empty) {
    return false
  }

  const cursor = selection.head
  const line = view.state.doc.lineAt(cursor)
  if (cursor !== line.to) {
    return false
  }

  const text = line.text

  const taskMatch = text.match(/^(\s*)([-+*])\s+\[(?: |x|X)\]\s*(.*)$/)
  if (taskMatch) {
    const [, indent, bullet, tail] = taskMatch
    if (!tail.trim()) {
      view.dispatch({
        changes: { from: line.from, to: line.to, insert: indent },
        selection: { anchor: line.from + indent.length },
        scrollIntoView: true,
        userEvent: 'input.type',
      })
      return true
    }

    const prefix = `${indent}${bullet} [ ] `
    view.dispatch({
      changes: { from: cursor, to: cursor, insert: `\n${prefix}` },
      selection: { anchor: cursor + prefix.length + 1 },
      scrollIntoView: true,
      userEvent: 'input.type',
    })
    return true
  }

  const bulletMatch = text.match(/^(\s*)([-+*])\s+(.*)$/)
  if (bulletMatch) {
    const [, indent, bullet, tail] = bulletMatch
    if (!tail.trim()) {
      view.dispatch({
        changes: { from: line.from, to: line.to, insert: indent },
        selection: { anchor: line.from + indent.length },
        scrollIntoView: true,
        userEvent: 'input.type',
      })
      return true
    }

    const prefix = `${indent}${bullet} `
    view.dispatch({
      changes: { from: cursor, to: cursor, insert: `\n${prefix}` },
      selection: { anchor: cursor + prefix.length + 1 },
      scrollIntoView: true,
      userEvent: 'input.type',
    })
    return true
  }

  const orderedMatch = text.match(/^(\s*)(\d+)([.)])\s+(.*)$/)
  if (orderedMatch) {
    const [, indent, rawNumber, separator, tail] = orderedMatch
    if (!tail.trim()) {
      view.dispatch({
        changes: { from: line.from, to: line.to, insert: indent },
        selection: { anchor: line.from + indent.length },
        scrollIntoView: true,
        userEvent: 'input.type',
      })
      return true
    }

    const nextNumber = Number.parseInt(rawNumber, 10) + 1
    const prefix = `${indent}${nextNumber}${separator} `
    view.dispatch({
      changes: { from: cursor, to: cursor, insert: `\n${prefix}` },
      selection: { anchor: cursor + prefix.length + 1 },
      scrollIntoView: true,
      userEvent: 'input.type',
    })
    return true
  }

  const quoteMatch = text.match(/^(\s*(?:>\s*)+)(.*)$/)
  if (quoteMatch) {
    const [, rawPrefix, tail] = quoteMatch
    if (!tail.trim()) {
      const indent = rawPrefix.match(/^\s*/)?.[0] ?? ''
      view.dispatch({
        changes: { from: line.from, to: line.to, insert: indent },
        selection: { anchor: line.from + indent.length },
        scrollIntoView: true,
        userEvent: 'input.type',
      })
      return true
    }

    const prefix = rawPrefix.endsWith(' ') ? rawPrefix : `${rawPrefix} `
    view.dispatch({
      changes: { from: cursor, to: cursor, insert: `\n${prefix}` },
      selection: { anchor: cursor + prefix.length + 1 },
      scrollIntoView: true,
      userEvent: 'input.type',
    })
    return true
  }

  return false
}

const toggleBold = (view: EditorView) => wrapMainSelection(view, '**', '**')
const toggleItalic = (view: EditorView) => wrapMainSelection(view, '*', '*')

export const markdownKeyBindings: readonly KeyBinding[] = [
  { key: 'Enter', run: continueMarkdownOnEnter },
  { key: 'Tab', run: indentMore },
  { key: 'Shift-Tab', run: indentLess },
  { key: 'Mod-b', run: toggleBold },
  { key: 'Mod-i', run: toggleItalic },
]
