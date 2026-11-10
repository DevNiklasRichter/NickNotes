import { defaultHighlightStyle, HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import type { Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { tags } from '@lezer/highlight'

const markdownHighlightStyle = HighlightStyle.define([
  { tag: tags.heading, fontWeight: '700' },
  { tag: [tags.emphasis], fontStyle: 'italic' },
  { tag: [tags.strong], fontWeight: '700' },
  { tag: [tags.quote], color: 'var(--muted)' },
  { tag: [tags.monospace], color: 'var(--text)' },
  { tag: [tags.keyword, tags.operatorKeyword], color: '#b14d1f' },
  { tag: [tags.string], color: '#1d7a4b' },
  { tag: [tags.number, tags.bool, tags.null], color: '#8f3fa6' },
  { tag: [tags.comment], color: 'color-mix(in srgb, var(--muted) 85%, transparent)', fontStyle: 'italic' },
  { tag: [tags.variableName], color: 'var(--text)' },
  { tag: [tags.function(tags.variableName)], color: '#0d6696' },
  { tag: [tags.typeName], color: '#2b6cb0' },
  { tag: [tags.link], color: 'var(--accent-strong)' },
  { tag: [tags.url], color: 'var(--accent)' },
  { tag: [tags.list], color: 'var(--muted)' },
  { tag: [tags.processingInstruction], color: 'var(--muted)' },
])

export const markdownHighlightExtension: Extension = [
  syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
  syntaxHighlighting(markdownHighlightStyle),
]

export function buildCodeMirrorTheme(mode: 'light' | 'dark'): Extension {
  const selectionBackground =
    mode === 'dark'
      ? 'color-mix(in srgb, #91b4ff 44%, transparent)'
      : 'color-mix(in srgb, #3b82f6 30%, transparent)'
  const selectionMatchBackground =
    mode === 'dark'
      ? 'color-mix(in srgb, #d3bc6d 34%, transparent)'
      : 'color-mix(in srgb, #facc15 28%, transparent)'
  const selectionMatchMainBackground =
    mode === 'dark'
      ? 'color-mix(in srgb, #eab308 44%, transparent)'
      : 'color-mix(in srgb, #f59e0b 36%, transparent)'

  return EditorView.theme(
    {
      '&': {
        height: '100%',
        minHeight: '0',
        backgroundColor: 'var(--editor-note-bg)',
        color: 'var(--text)',
      },
      '.cm-scroller': {
        overflow: 'auto',
        fontFamily: 'var(--font-family-ui)',
        fontSize: 'var(--font-editor)',
        lineHeight: '1.7',
        fontFeatureSettings: "'liga' 1, 'calt' 1",
      },
      '.cm-content': {
        minHeight: '100%',
        padding: '1.4rem 0 4rem',
        caretColor: 'var(--accent)',
      },
      '.cm-line': {
        padding: '0 0.35rem',
      },
      '.cm-gutters': {
        border: 'none',
        backgroundColor: 'transparent',
        color: 'var(--muted)',
      },
      '.cm-activeLine': {
        backgroundColor: 'transparent',
      },
      '.cm-activeLineGutter': {
        backgroundColor: 'transparent',
      },
      '.cm-selectionBackground, .cm-content ::selection': {
        backgroundColor: selectionBackground,
      },
      '.cm-selectionMatch': {
        backgroundColor: selectionMatchBackground,
        outline: mode === 'dark' ? '1px solid rgba(250, 204, 21, 0.42)' : '1px solid rgba(217, 119, 6, 0.32)',
        borderRadius: '4px',
      },
      '.cm-selectionMatch-main': {
        backgroundColor: selectionMatchMainBackground,
        outline: mode === 'dark' ? '1px solid rgba(250, 204, 21, 0.62)' : '1px solid rgba(217, 119, 6, 0.48)',
        borderRadius: '4px',
      },
      '&.cm-focused': {
        outline: 'none',
      },
      '&.cm-focused .cm-cursor': {
        borderLeftColor: 'var(--accent)',
      },
      '.cm-searchMatch': {
        backgroundColor: 'color-mix(in srgb, var(--accent) 18%, transparent)',
        border: '1px solid color-mix(in srgb, var(--accent) 36%, transparent)',
      },
      '.cm-searchMatch.cm-searchMatch-selected': {
        backgroundColor: 'color-mix(in srgb, var(--accent) 28%, transparent)',
      },
      '.cm-placeholder': {
        color: 'color-mix(in srgb, var(--muted) 78%, transparent)',
        fontStyle: 'italic',
      },
    },
    { dark: mode === 'dark' }
  )
}
