import {useRef, useState} from 'react'
import {createRoot} from 'react-dom/client'
import {CodeMirrorMarkdownEditor, type MarkdownEditorApi, type MarkdownEditorTagSuggestion} from '../../src/frontend/src/editor/CodeMirrorMarkdownEditor'

const TAG_GROUPS: [] = []
const SUGGESTION: MarkdownEditorTagSuggestion = {
  key: 'ux-vorschlag:synthese', category: 'ux-vorschlag', slug: 'synthese', displayName: 'Synthese', source: 'context',
}
const INITIAL = 'Vorher Synthese nachher.'

function TagSuggestionFixture() {
  const [value, setValue] = useState(INITIAL)
  const [readOnly, setReadOnly] = useState(false)
  const [suggestions, setSuggestions] = useState([SUGGESTION])
  const [accepted, setAccepted] = useState(0)
  const [rejected, setRejected] = useState(0)
  const api = useRef<MarkdownEditorApi | null>(null)
  return <section data-testid="tag-suggestion-fixture">
    <button onClick={() => setReadOnly(current => !current)}>Schreibschutz wechseln</button>
    <button onClick={() => setSuggestions([{...SUGGESTION}])}>Vorschläge erneuern</button>
    <button onClick={() => setValue('Extern ersetzter Text.')}>Dokument extern ersetzen</button>
    <output data-testid="suggestion-actions">{accepted}/{rejected}</output>
    <CodeMirrorMarkdownEditor value={value} onChange={setValue} readOnly={readOnly} theme="light"
      tagGroups={TAG_GROUPS} tagSuggestions={suggestions} editorApiRef={api}
      onToggleTagSuggestion={() => setAccepted(count => count + 1)}
      onRejectTagSuggestion={() => setRejected(count => count + 1)} />
  </section>
}

/** Real editor, synthetic prop changes, disposable Electron profile only. */
export function mountTagSuggestionFixture() {
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;inset:8%;z-index:300;overflow:auto;background:var(--surface);color:var(--text);padding:12px;border:1px solid var(--line);'
  document.body.append(host)
  const root = createRoot(host)
  root.render(<TagSuggestionFixture />)
  return () => {root.unmount(); host.remove()}
}
