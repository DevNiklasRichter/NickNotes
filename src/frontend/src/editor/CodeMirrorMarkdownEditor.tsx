import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, MutableRefObject } from 'react'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { javascript } from '@codemirror/lang-javascript'
import { markdown, markdownKeymap } from '@codemirror/lang-markdown'
import { bracketMatching, indentOnInput, LanguageDescription } from '@codemirror/language'
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search'
import { Compartment, EditorState } from '@codemirror/state'
import {
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightSpecialChars,
  keymap,
  placeholder,
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

export type MarkdownEditorApi = {
  insertText: (text: string) => void
  getSelectedText: () => string
  getMarkdown: () => string
  focus: () => void
  openCommandPalette: () => void
  runCommand: (commandId: MarkdownCommandId) => boolean
}

type CodeMirrorMarkdownEditorProps = {
  value: string
  theme: 'light' | 'dark'
  tagGroups: TagGroupDefinition[]
  onChange: (nextValue: string) => void
  editorApiRef: MutableRefObject<MarkdownEditorApi | null>
}

type SlashMatch = {
  from: number
  to: number
  query: string
}

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
  const left = Math.max(10, Math.min(coords.left - rect.left - 16, rect.width - panelWidth - 10))
  const top = Math.max(10, coords.bottom - rect.top + 8)
  return { left, top }
}

function clampIndex(index: number, itemCount: number): number {
  if (itemCount <= 0) {
    return 0
  }
  return Math.max(0, Math.min(index, itemCount - 1))
}

type PaletteItem =
  | {
      kind: 'tag-root'
      title: string
      description: string
    }
  | {
      kind: 'command'
      command: MarkdownCommand
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

export function CodeMirrorMarkdownEditor({ value, theme, tagGroups, onChange, editorApiRef }: CodeMirrorMarkdownEditorProps) {
  const shellRef = useRef<HTMLDivElement | null>(null)
  const hostRef = useRef<HTMLDivElement | null>(null)
  const paletteInputRef = useRef<HTMLInputElement | null>(null)
  const editorRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  const syncingRef = useRef(false)
  const themeCompartmentRef = useRef(new Compartment())
  const tagLookupCompartmentRef = useRef(new Compartment())
  const initialValueRef = useRef(value)
  const initialThemeRef = useRef(theme)
  const initialTagGroupsRef = useRef(tagGroups)
  const [paletteState, setPaletteState] = useState<PaletteState | null>(null)
  const paletteStateRef = useRef<PaletteState | null>(null)

  const paletteItems = useMemo<PaletteItem[]>(() => {
    if (!paletteState) {
      return []
    }

    if (paletteState.mode === 'slash') {
      return [
        {
          kind: 'tag-root',
          title: 'Tag',
          description: 'Fuegt ein hierarchisches Tag ({tag:gruppe/tag}) ein.',
        },
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

    const query = paletteState.query.trim().toLowerCase()
    const tags = paletteState.group.tags
    if (!query) {
      return tags.map<PaletteItem>((tag) => ({ kind: 'tag', group: paletteState.group, tag }))
    }
    return tags
      .filter((tag) => `${tag.id} ${tag.displayName}`.toLowerCase().includes(query))
      .map<PaletteItem>((tag) => ({ kind: 'tag', group: paletteState.group, tag }))
  }, [paletteState, tagGroups])

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
    if (!paletteState || (paletteState.mode !== 'palette' && paletteState.mode !== 'tag-group' && paletteState.mode !== 'tag-item')) {
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

    const applyPaletteCommand = (indexOverride?: number): boolean => {
      const current = paletteStateRef.current
      const view = editorRef.current
      if (!current || !view) {
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
        if (current.mode !== 'tag-group') {
          return false
        }
        insertTagSyntax(view, current.context.from, current.context.to, item.group.id, item.tag.id)
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
          highlightActiveLine(),
          indentOnInput(),
          bracketMatching(),
          history(),
          EditorView.lineWrapping,
          markdownHighlightExtension,
          tagLookupCompartmentRef.current.of(markdownTagLookupExtension(initialTagGroupsRef.current)),
          highlightSelectionMatches(),
          placeholder('Starte mit einer Notiz ...'),
          liveMarkdownPreview(),
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
              key: 'Escape',
              run: () => closePalette(),
            },
            ...markdownKeyBindings,
            ...markdownKeymap,
            ...defaultKeymap,
            ...historyKeymap,
            ...searchKeymap,
          ]),
          themeCompartmentRef.current.of(buildCodeMirrorTheme(initialThemeRef.current)),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !syncingRef.current) {
              onChangeRef.current(update.state.doc.toString())
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

    const currentValue = instance.state.doc.toString()
    if (currentValue === value) {
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
    if (!paletteState || (paletteState.mode !== 'palette' && paletteState.mode !== 'tag-group' && paletteState.mode !== 'tag-item')) {
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
      if (current.mode !== 'tag-group') {
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

  const isAnchoredPalette = paletteState && (paletteState.mode === 'slash' || paletteState.mode === 'tag-group' || paletteState.mode === 'tag-item')
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

  return (
    <div className="code-editor-shell" ref={shellRef}>
      <div className="code-editor-host" ref={hostRef} />

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

          <div className="editor-command-list" role="listbox" aria-label="Markdown-Befehle">
            {paletteItems.length === 0 ? <div className="editor-command-empty">Kein passender Eintrag.</div> : null}
            {paletteItems.map((item, index) => {
              const title =
                item.kind === 'command'
                  ? item.command.title
                  : item.kind === 'tag-root'
                    ? item.title
                    : item.kind === 'tag-group'
                      ? item.group.displayName
                      : `${item.tag.displayName}`
              const description =
                item.kind === 'command'
                  ? item.command.description
                  : item.kind === 'tag-root'
                    ? item.description
                    : item.kind === 'tag-group'
                      ? `${item.group.id} • ${item.group.tags.length} Tags`
                      : `${item.group.displayName} (${item.group.id}) • {tag:${item.group.id}/${item.tag.id}}`
              const key =
                item.kind === 'command'
                  ? item.command.id
                  : item.kind === 'tag-root'
                    ? 'tag-root'
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
              ? '↑ ↓ waehlen • Enter ausfuehren • Esc schliessen'
              : paletteState.mode === 'tag-item'
                ? '↑ ↓ waehlen • Enter einfuegen • Esc zurueck'
                : '↑ ↓ waehlen • Enter ausfuehren • Esc schliessen'}
          </div>
        </div>
      ) : null}
    </div>
  )
}
