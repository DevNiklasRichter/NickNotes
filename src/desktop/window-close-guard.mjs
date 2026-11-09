/** Synchronize renderer drafts before native close; never close on a missing/stale reply. */
export function createWindowCloseGuard(win, dialog) {
  let ready=false,dirty=false,phase='idle',requestId=0,allowClose=false,timer
  const clearTimer=()=>{clearTimeout(timer);timer=undefined}
  const reset=()=>{
    clearTimer();phase='idle'
    if(!win.isDestroyed())win.setEnabled(true)
  }
  const fail=message=>{
    reset()
    if(!win.isDestroyed())dialog.showErrorBox('Schließen nicht abgeschlossen',message)
  }
  const armTimeout=(expectedPhase,milliseconds)=>{
    clearTimer()
    const expectedRequest=requestId
    timer=setTimeout(()=>{
      if(phase===expectedPhase&&requestId===expectedRequest)fail('Die Anwendung hat nicht rechtzeitig geantwortet. Das Fenster bleibt zum Schutz ungespeicherter Änderungen geöffnet.')
    },milliseconds)
  }
  const finish=()=>{
    clearTimer();phase='closing';allowClose=true
    win.close()
  }
  const decide=()=>{
    if(!dirty){finish();return}
    // The native modal dialog owns input until the choice returns.
    win.setEnabled(true)
    const choice=dialog.showMessageBoxSync(win,{
      type:'question',buttons:['Speichern','Nicht speichern','Abbrechen'],
      defaultId:0,cancelId:2,title:'Ungespeicherte Aenderungen',
      message:'Es gibt ungespeicherte Aenderungen. Vor dem Schliessen speichern?',noLink:true,
    })
    if(choice===1){finish();return}
    if(choice!==0){reset();return}
    phase='saving';win.setEnabled(false)
    armTimeout('saving',120_000)
    win.webContents.send('app:request-save-before-close',{requestId})
  }
  const guard={
    setReady(value){ready=value===true},
    setDirty(value){if(typeof value==='boolean')dirty=value},
    receiveState(payload){
      if(phase!=='checking'||payload?.requestId!==requestId||typeof payload.hasUnsavedChanges!=='boolean')return
      clearTimer();dirty=payload.hasUnsavedChanges
      try{decide()}catch{fail('Die Schließen-Abfrage konnte nicht verarbeitet werden. Das Fenster bleibt geöffnet.')}
    },
    receiveSaveResult(payload){
      if(phase!=='saving'||payload?.requestId!==requestId||typeof payload.ok!=='boolean')return
      if(payload.ok)finish();else reset()
    },
    dispose(){clearTimer();phase='closed'},
  }
  win.on('close',event=>{
    if(allowClose){allowClose=false;return}
    event.preventDefault()
    if(phase!=='idle')return
    requestId++;win.setEnabled(false)
    try{
      if(!ready){decide();return} // The early capture screen has no note editor yet.
      phase='checking';armTimeout('checking',10_000)
      win.webContents.send('app:request-close-state',{requestId})
    }catch{fail('Die Anwendung konnte vor dem Schließen nicht erreicht werden. Das Fenster bleibt geöffnet.')}
  })
  win.on('closed',()=>guard.dispose())
  return guard
}
