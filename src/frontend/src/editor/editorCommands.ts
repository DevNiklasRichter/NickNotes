import type { EditorView } from '@codemirror/view'

export type MarkdownCommandId =
  | 'heading-1'
  | 'heading-2'
  | 'heading-3'
  | 'bullet-list'
  | 'numbered-list'
  | 'task-list'
  | 'blockquote'
  | 'bold'
  | 'italic'
  | 'inline-code'
  | 'code-block-ts'
  | 'code-block-js'
  | 'code-block-text'
  | 'hyperlink'
  | 'divider'

export type MarkdownCommand = {
  id: MarkdownCommandId
  title: string
  description: string
  keywords: string[]
}

type CommandRuntimeContext = {
  replaceFrom?: number
  replaceTo?: number
}

const DEFAULT_URL = 'https://'

export const markdownCommands: readonly MarkdownCommand[] = [
  {
    id: 'heading-1',
    title: 'Heading 1',
    description: 'Setzt eine H1-Ueberschrift (#).',
    keywords: ['h1', 'title', 'headline', 'ueberschrift'],
  },
  {
    id: 'heading-2',
    title: 'Heading 2',
    description: 'Setzt eine H2-Ueberschrift (##).',
    keywords: ['h2', 'subtitle', 'headline'],
  },
  {
    id: 'heading-3',
    title: 'Heading 3',
    description: 'Setzt eine H3-Ueberschrift (###).',
    keywords: ['h3', 'headline'],
  },
  {
    id: 'bullet-list',
    title: 'Bullet List',
    description: 'Fuegt einen Listenpunkt ein (-).',
    keywords: ['list', 'bullet', 'ul', 'punktliste'],
  },
  {
    id: 'numbered-list',
    title: 'Numbered List',
    description: 'Fuegt einen nummerierten Listenpunkt ein (1.).',
    keywords: ['list', 'ordered', 'ol', 'nummeriert'],
  },
  {
    id: 'task-list',
    title: 'Task List',
    description: 'Fuegt einen Task-Listenpunkt ein (- [ ]).',
    keywords: ['task', 'todo', 'checkbox', 'checkliste'],
  },
  {
    id: 'blockquote',
    title: 'Blockquote',
    description: 'Fuegt ein Zitat ein (>).',
    keywords: ['quote', 'zitat', 'callout'],
  },
  {
    id: 'bold',
    title: 'Bold',
    description: 'Formatiert Auswahl fett (**text**).',
    keywords: ['bold', 'fett', 'strong'],
  },
  {
    id: 'italic',
    title: 'Italic',
    description: 'Formatiert Auswahl kursiv (*text*).',
    keywords: ['italic', 'kursiv', 'emphasis'],
  },
  {
    id: 'inline-code',
    title: 'Inline Code',
    description: 'Formatiert Auswahl als Inline-Code (`code`).',
    keywords: ['code', 'inline', 'snippet'],
  },
  {
    id: 'code-block-ts',
    title: 'Code Block (TypeScript)',
    description: 'Fuegt einen TypeScript-Codeblock (```ts) ein.',
    keywords: ['codeblock', 'ts', 'typescript', 'fenced'],
  },
  {
    id: 'code-block-js',
    title: 'Code Block (JavaScript)',
    description: 'Fuegt einen JavaScript-Codeblock (```js) ein.',
    keywords: ['codeblock', 'js', 'javascript', 'fenced'],
  },
  {
    id: 'code-block-text',
    title: 'Code Block (Plain Text)',
    description: 'Fuegt einen einfachen Codeblock ein.',
    keywords: ['codeblock', 'plain', 'text', 'fenced'],
  },
  {
    id: 'hyperlink',
    title: 'Hyperlink',
    description: 'Fuegt einen Markdown-Link ein [Text](URL).',
    keywords: ['url', 'web', 'markdown-link'],
  },
  {
    id: 'divider',
    title: 'Divider',
    description: 'Fuegt eine horizontale Trennlinie ein (---).',
    keywords: ['divider', 'hr', 'trennlinie'],
  },
]

function resolveRange(view: EditorView, context?: CommandRuntimeContext): { from: number; to: number } {
  if (context && typeof context.replaceFrom === 'number') {
    const from = Math.max(0, context.replaceFrom)
    const to = Math.max(from, typeof context.replaceTo === 'number' ? context.replaceTo : context.replaceFrom)
    return { from, to }
  }
  const selection = view.state.selection.main
  return { from: selection.from, to: selection.to }
}

function insertText(
  view: EditorView,
  from: number,
  to: number,
  insert: string,
  selectionFrom: number,
  selectionTo: number
): void {
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: selectionFrom, head: selectionTo },
    scrollIntoView: true,
    userEvent: 'input.type',
  })
}

function insertSnippet(view: EditorView, snippet: string, context?: CommandRuntimeContext): void {
  const range = resolveRange(view, context)
  const cursor = range.from + snippet.length
  insertText(view, range.from, range.to, snippet, cursor, cursor)
}

function wrapSelection(view: EditorView, left: string, right: string, context?: CommandRuntimeContext): void {
  const range = resolveRange(view, context)
  const selected = view.state.doc.sliceString(range.from, range.to)
  if (!selected) {
    const insert = `${left}${right}`
    const cursor = range.from + left.length
    insertText(view, range.from, range.to, insert, cursor, cursor)
    return
  }

  const insert = `${left}${selected}${right}`
  const selectionFrom = range.from + left.length
  insertText(view, range.from, range.to, insert, selectionFrom, selectionFrom + selected.length)
}

function insertCodeFence(view: EditorView, language: string, context?: CommandRuntimeContext): void {
  const range = resolveRange(view, context)
  const selected = view.state.doc.sliceString(range.from, range.to)
  if (selected) {
    const insert = `\`\`\`${language}\n${selected}\n\`\`\``
    const selectionFrom = range.from + language.length + 4
    insertText(view, range.from, range.to, insert, selectionFrom, selectionFrom + selected.length)
    return
  }

  const insert = `\`\`\`${language}\n\n\`\`\``
  const cursor = range.from + language.length + 4
  insertText(view, range.from, range.to, insert, cursor, cursor)
}

function insertLink(view: EditorView, context?: CommandRuntimeContext): void {
  const range = resolveRange(view, context)
  const selected = view.state.doc.sliceString(range.from, range.to)
  const text = selected || 'Linktext'
  const insert = `[${text}](${DEFAULT_URL})`
  const urlFrom = range.from + text.length + 3
  const urlTo = urlFrom + DEFAULT_URL.length
  insertText(view, range.from, range.to, insert, urlFrom, urlTo)
}

export function runMarkdownCommand(view: EditorView, commandId: MarkdownCommandId, context?: CommandRuntimeContext): boolean {
  switch (commandId) {
    case 'heading-1':
      insertSnippet(view, '# ', context)
      return true
    case 'heading-2':
      insertSnippet(view, '## ', context)
      return true
    case 'heading-3':
      insertSnippet(view, '### ', context)
      return true
    case 'bullet-list':
      insertSnippet(view, '- ', context)
      return true
    case 'numbered-list':
      insertSnippet(view, '1. ', context)
      return true
    case 'task-list':
      insertSnippet(view, '- [ ] ', context)
      return true
    case 'blockquote':
      insertSnippet(view, '> ', context)
      return true
    case 'bold':
      wrapSelection(view, '**', '**', context)
      return true
    case 'italic':
      wrapSelection(view, '*', '*', context)
      return true
    case 'inline-code':
      wrapSelection(view, '`', '`', context)
      return true
    case 'code-block-ts':
      insertCodeFence(view, 'ts', context)
      return true
    case 'code-block-js':
      insertCodeFence(view, 'js', context)
      return true
    case 'code-block-text':
      insertCodeFence(view, '', context)
      return true
    case 'hyperlink':
      insertLink(view, context)
      return true
    case 'divider':
      insertSnippet(view, '\n---\n', context)
      return true
    default:
      return false
  }
}

export function filterMarkdownCommands(query: string): MarkdownCommand[] {
  const clean = query.trim().toLowerCase()
  if (!clean) {
    return [...markdownCommands]
  }

  const ranked = markdownCommands
    .map((command) => {
      const bag = `${command.title} ${command.description} ${command.keywords.join(' ')}`.toLowerCase()
      const starts = command.title.toLowerCase().startsWith(clean)
      const includes = bag.includes(clean)
      if (!includes) {
        return null
      }
      const score = starts ? 2 : 1
      return { command, score }
    })
    .filter((entry): entry is { command: MarkdownCommand; score: number } => Boolean(entry))
    .sort((left, right) => right.score - left.score || left.command.title.localeCompare(right.command.title, 'de'))

  return ranked.map((entry) => entry.command)
}
