// Deliberately plain JavaScript: usable even while Vite optimizes the React/editor dependencies.
(() => {
  const startup=document.getElementById('startup')
  const textarea=document.getElementById('startup-draft')
  const status=document.getElementById('startup-status')
  const draftStatus=document.getElementById('startup-draft-status')
  const failure=document.getElementById('startup-error')
  const detail=document.getElementById('startup-error-detail')
  let touched=false,uiReady=false,backendReady=!window.nicknotes?.getBackendStatus,failed=false,shown=false
  document.documentElement.dataset.theme=window.nicknotes?.startupTheme??(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light')
  document.getElementById('startup-retry').addEventListener('click',()=>window.location.reload())
  // Hidden/occluded windows can stop receiving animation frames. They must still
  // finish loading; the timeout does not claim that a paint actually happened.
  function deferUi(callback){
    let called=false
    const run=()=>{if(called)return;called=true;clearTimeout(timer);callback()}
    const timer=setTimeout(run,500)
    requestAnimationFrame(()=>requestAnimationFrame(run))
  }

  function showFailure(error) {
    failed=true;startup.hidden=false;document.getElementById('root').hidden=true;failure.hidden=false
    detail.textContent=error instanceof Error?error.message:String(error)
    status.textContent='Beim Start ist ein Fehler aufgetreten. Dein Schnellerfassungsentwurf bleibt verfügbar.'
    console.error('[startup]',error)
  }
  function showApplication() {
    if(!uiReady||!backendReady||failed||shown)return
    shown=true
    window.dispatchEvent(new CustomEvent('nicknotes:startup-draft',{detail:textarea.value}))
    deferUi(()=>{
      startup.hidden=true;document.getElementById('root').hidden=false
      if(touched||textarea.value)document.querySelector('[data-launch-capture],.capture-markdown-editor .cm-content')?.focus()
      window.dispatchEvent(new Event('nicknotes:startup-complete'))
    })
  }
  textarea.addEventListener('input',()=>{
    touched=true
    window.dispatchEvent(new CustomEvent('nicknotes:startup-draft',{detail:textarea.value}))
    window.nicknotes?.writeCaptureDraft?.(textarea.value).catch(error=>{
      draftStatus.textContent='Der Entwurf konnte nicht lokal gesichert werden. Bitte kopiere den Text vor dem Beenden.'
      console.error('[capture-draft]',error)
    })
  })
  const draftReady=(window.nicknotes?.readCaptureDraft?.().then(text=>{if(!touched)textarea.value=text}).catch(error=>{draftStatus.textContent=String(error)})??Promise.resolve()).then(()=>{
    textarea.readOnly=false;textarea.focus()
    window.nicknotes?.startupMark?.('quick-entry-enabled')
    requestAnimationFrame(()=>requestAnimationFrame(()=>window.nicknotes?.startupMark?.('quick-entry-ready')))
    window.dispatchEvent(new Event('nicknotes:quick-entry-ready'))
  })
  window.nicknotes?.onBackendStatus?.(state=>{
    if(state.phase==='error'){showFailure(new Error(state.message));return}
    backendReady=state.phase==='ready';status.textContent=state.message;showApplication()
  })
  window.nicknotes?.getBackendStatus?.().then(state=>{
    if(state.phase==='error')showFailure(new Error(state.message))
    else {backendReady=state.phase==='ready';status.textContent=state.message;showApplication()}
  }).catch(showFailure)
  window.addEventListener('error',event=>{
    if(!uiReady&&event.error)showFailure(event.error)
    else if(!uiReady&&event.target instanceof HTMLScriptElement)showFailure(new Error('Eine Datei der Oberfläche konnte nicht geladen werden. Bitte erneut laden; Details stehen im Terminal.'))
  },true)
  window.addEventListener('unhandledrejection',event=>{if(!uiReady)showFailure(event.reason)})
  window.nicknotesStartup={deferUi,mount:callback=>{
    draftReady.then(()=>callback(()=>{uiReady=true;window.nicknotes?.startupMark?.('ui-rendered');showApplication()},showFailure)).catch(showFailure)
  }}
  window.dispatchEvent(new Event('nicknotes:bootstrap-ready'))
})()
