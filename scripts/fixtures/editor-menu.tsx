import {useRef, useState} from 'react'
import {createRoot} from 'react-dom/client'
import {CodeMirrorMarkdownEditor, type MarkdownEditorApi} from '../../src/frontend/src/editor/CodeMirrorMarkdownEditor'

const TAG_GROUPS: [] = []
const INITIAL = 'Auswahlwort\n\n| Kopf |\n| --- |\n| Zelle |\n'

function EditorMenuFixture() {
  const [value, setValue] = useState(INITIAL)
  const [readOnly, setReadOnly] = useState(true)
  const [result, setResult] = useState('')
  const replace = useRef<((syntax: string) => boolean) | null>(null)
  const editorApi = useRef<MarkdownEditorApi | null>(null)
  return <section data-testid="editor-menu-fixture">
    <button onClick={() => setReadOnly(current => !current)}>Schreibschutz wechseln</button>
    <button onClick={() => setValue('Extern ersetzter Text.\n')}>Dokument extern ersetzen</button>
    <button onClick={() => setResult(String(replace.current?.('{tag:test/alt}')))}>Verspätete Auswahl übernehmen</button>
    <output data-testid="late-selection-result">{result}</output>
    <CodeMirrorMarkdownEditor value={value} onChange={setValue} readOnly={readOnly} theme="light"
      tagGroups={TAG_GROUPS} editorApiRef={editorApi} onCreateTagFromSelection={(_text, apply) => {replace.current = apply}} />
  </section>
}

/** Standalone component checks inside the disposable Electron test window only. */
export function mountEditorMenuFixture() {
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;inset:8%;z-index:300;overflow:auto;background:var(--surface);color:var(--text);padding:20px;border:1px solid var(--line);'
  document.body.append(host)
  const root = createRoot(host)
  root.render(<EditorMenuFixture />)
  return () => {root.unmount(); host.remove()}
}
