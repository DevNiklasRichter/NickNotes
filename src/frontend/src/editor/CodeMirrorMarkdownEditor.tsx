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
import { liveMarkdownPreview } from './markdownLivePreview'
import { buildCodeMirrorTheme, markdownHighlightExtension } from './markdownTheme'

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

export function CodeMirrorMarkdownEditor({ value, theme, onChange, editorApiRef }: CodeMirrorMarkdownEditorProps) {
  const shellRef = useRef<HTMLDivElement | null>(null)
  const hostRef = useRef<HTMLDivElement | null>(null)
  const paletteInputRef = useRef<HTMLInputElement | null>(null)
  const editorRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  const syncingRef = useRef(false)
  const themeCompartmentRef = useRef(new Compartment())
  const initialValueRef = useRef(value)
  const initialThemeRef = useRef(theme)
  const [paletteState, setPaletteState] = useState<PaletteState | null>(null)
  const paletteStateRef = useRef<PaletteState | null>(null)

  const paletteQuery = paletteState ? paletteState.query : ''
  const filteredCommands = useMemo(() => {
    return filterMarkdownCommands(paletteQuery)
  }, [paletteQuery])

  const filteredCommandsRef = useRef<MarkdownCommand[]>([])

  useEffect(() => {
    filteredCommandsRef.current = filteredCommands
  }, [filteredCommands])

  useEffect(() => {
    paletteStateRef.current = paletteState
  }, [paletteState])

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    if (!paletteState || paletteState.mode !== 'palette') {
      return
    }
    window.requestAnimationFrame(() => {
      paletteInputRef.current?.focus()
      paletteInputRef.current?.select()
    })
  }, [paletteState])

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
      const available = filteredCommandsRef.current.length
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

    const applyPaletteCommand = (indexOverride?: number): boolean => {
      const current = paletteStateRef.current
      const view = editorRef.current
      if (!current || !view) {
        return false
      }

      const available = filteredCommandsRef.current
      if (available.length === 0) {
        return true
      }

      const index = clampIndex(typeof indexOverride === 'number' ? indexOverride : current.selectedIndex, available.length)
      const command = available[index]
      const context =
        current.mode === 'slash'
          ? {
              replaceFrom: current.from,
              replaceTo: current.to,
            }
          : undefined

      runMarkdownCommand(view, command.id, context)
      setPaletteState(null)
      view.focus()
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
      if (current && current.mode === 'palette') {
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

  const executeCommand = (command: MarkdownCommand) => {
    const current = paletteStateRef.current
    const view = editorRef.current
    if (!view) {
      return
    }

    const context =
      current && current.mode === 'slash'
        ? {
            replaceFrom: current.from,
            replaceTo: current.to,
          }
        : undefined

    runMarkdownCommand(view, command.id, context)
    setPaletteState(null)
    view.focus()
  }

  const onPaletteInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (!paletteState || paletteState.mode !== 'palette') {
      return
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setPaletteState((current) => {
        if (!current) {
          return current
        }
        const available = filteredCommands.length
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
        const available = filteredCommands.length
        if (available === 0) {
          return current
        }
        return { ...current, selectedIndex: (current.selectedIndex - 1 + available) % available }
      })
      return
    }

    if (event.key === 'Enter') {
      event.preventDefault()
      const activeCommandIndex = clampIndex(paletteState.selectedIndex, filteredCommands.length)
      const command = filteredCommands[activeCommandIndex]
      if (command) {
        executeCommand(command)
      }
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      setPaletteState(null)
      editorRef.current?.focus()
    }
  }

  const paletteLeft = paletteState && paletteState.mode === 'slash' ? paletteState.anchor.left : undefined
  const paletteTop = paletteState && paletteState.mode === 'slash' ? paletteState.anchor.top : undefined
  const activeCommandIndex = clampIndex(paletteState ? paletteState.selectedIndex : 0, filteredCommands.length)

  return (
    <div className="code-editor-shell" ref={shellRef}>
      <div className="code-editor-host" ref={hostRef} />

      {paletteState ? (
        <div
          className={`editor-command-palette ${paletteState.mode === 'slash' ? 'slash' : 'global'}`}
          style={paletteState.mode === 'slash' ? { left: `${paletteLeft}px`, top: `${paletteTop}px` } : undefined}
        >
          {paletteState.mode === 'palette' ? (
            <div className="editor-command-search-row">
              <input
                ref={paletteInputRef}
                value={paletteState.query}
                onChange={(event) => {
                  const nextQuery = event.target.value
                  setPaletteState((current) =>
                    current && current.mode === 'palette'
                      ? {
                          ...current,
                          query: nextQuery,
                          selectedIndex: 0,
                        }
                      : current
                  )
                }}
                onKeyDown={onPaletteInputKeyDown}
                placeholder="Befehl suchen (z. B. task, code, link)"
              />
            </div>
          ) : (
            <div className="editor-command-slash-meta">/{paletteState.query || ''}</div>
          )}

          <div className="editor-command-list" role="listbox" aria-label="Markdown-Befehle">
            {filteredCommands.length === 0 ? <div className="editor-command-empty">Kein passender Befehl.</div> : null}
            {filteredCommands.map((command, index) => (
              <button
                key={command.id}
                type="button"
                className={`editor-command-item ${index === activeCommandIndex ? 'active' : ''}`}
                onMouseDown={(event) => {
                  event.preventDefault()
                }}
                onClick={() => executeCommand(command)}
              >
                <span className="editor-command-title">{command.title}</span>
                <span className="editor-command-desc">{command.description}</span>
              </button>
            ))}
          </div>

          <div className="editor-command-footnote">
            {paletteState.mode === 'slash' ? '↑ ↓ waehlen • Enter ausfuehren • Esc schliessen' : 'Enter ausfuehren • Esc schliessen'}
          </div>
        </div>
      ) : null}
    </div>
  )
}
