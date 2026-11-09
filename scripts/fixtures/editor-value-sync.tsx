import {useRef,useState} from 'react'
import {createRoot} from 'react-dom/client'
import {CodeMirrorMarkdownEditor,type MarkdownEditorApi} from '../../src/frontend/src/editor/CodeMirrorMarkdownEditor'

const TAG_GROUPS: []=[]

/** Controlled editor with deliberately delayed parent acknowledgements. */
function EditorValueSyncFixture() {
  const [value,setValue]=useState('')
  const [pending,setPending]=useState<string[]>([])
  const editorApi=useRef<MarkdownEditorApi|null>(null)
  return <section data-testid="editor-value-sync-fixture">
    <output data-testid="pending-echo-count">{pending.length}</output>
    <output data-testid="parent-editor-value">{value}</output>
    <button disabled={!pending.length} onClick={()=>{setValue(pending[0]??'');setPending(pending.slice(1))}}>Apply oldest echo</button>
    <button disabled={!pending.length} onClick={()=>{setValue(pending[pending.length-1]??'');setPending([])}}>Apply latest echo</button>
    <button onClick={()=>setValue('External replacement')}>Replace externally</button>
    <button onClick={()=>setValue('a')}>Use old text externally</button>
    <CodeMirrorMarkdownEditor value={value} onChange={next=>setPending(current=>[...current,next])} theme="light" tagGroups={TAG_GROUPS} editorApiRef={editorApi}/>
  </section>
}

export function mountEditorValueSyncFixture() {
  const host=document.createElement('div')
  host.style.cssText='position:fixed;inset:5%;z-index:10000;overflow:auto;background:white;color:black;padding:20px;'
  document.body.append(host)
  const root=createRoot(host)
  root.render(<EditorValueSyncFixture/>)
  return ()=>{root.unmount();host.remove()}
}
