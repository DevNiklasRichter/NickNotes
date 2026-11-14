/** GitHub hands the release body over as HTML; keep the changelog part as plain `### Heading` / `- item` lines. */
export function releaseNotesText(notes) {
  const html=Array.isArray(notes)?notes.map(item=>item?.note??'').join('\n'):String(notes??'')
  return html.split(/<hr\s*\/?>/i)[0]
    .replace(/<li[^>]*>/gi,'\n- ').replace(/<h[1-6][^>]*>/gi,'\n### ').replace(/<\/(?:p|h[1-6]|li|ul|ol)>|<br\s*\/?>/gi,'\n')
    .replace(/<[^>]+>/g,'').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,'&')
    .split('\n').map(line=>line.trim()).filter(Boolean).join('\n').slice(0,6000)
}

/** Public stable releases only; no network/download/installation without the corresponding action. */
export function createUpdateService({version,enabled,loadUpdater,notify,prepareInstall}) {
  let state={phase:enabled?'idle':'disabled',currentVersion:version,message:enabled?'Noch nicht nach Updates gesucht.':'Updates sind in dieser unsignierten Testversion deaktiviert.'}
  let updaterPromise,semver,operation=false,disposed=false,checkTimer,interval
  const publish=patch=>{state={...state,...patch};if(!disposed)notify({...state});return {...state}}
  const fail=error=>publish({phase:'error',message:'Update nicht abgeschlossen. Bitte erneut versuchen oder den Installer von GitHub verwenden. '+String(error.message??error)})
  const acceptable=info=>semver.valid(info?.version)&&!semver.prerelease(info.version)&&semver.gt(info.version,version)
  const getUpdater=()=>updaterPromise??=Promise.all([Promise.resolve().then(loadUpdater),import('semver')]).then(([updater,versions])=>{
    semver=versions.default
    updater.autoDownload=false;updater.autoInstallOnAppQuit=false
    updater.allowPrerelease=false;updater.allowDowngrade=false;updater.autoRunAppAfterInstall=true
    updater.on('error',fail)
    updater.on('update-available',info=>{
      if(!acceptable(info)){fail(new Error('Der angebotene Versionsstand ist kein neuer stabiler Release.'));return}
      publish({phase:'available',version:info.version,notes:releaseNotesText(info.releaseNotes),percent:undefined,message:`NickNotes ${info.version} ist verfügbar.`})
    })
    updater.on('update-not-available',()=>publish({phase:'current',version:undefined,notes:undefined,percent:undefined,message:'Du verwendest die aktuelle stabile Version.'}))
    updater.on('download-progress',progress=>publish({phase:'downloading',percent:Math.max(0,Math.min(100,Math.round(progress.percent))),message:'Update wird heruntergeladen …'}))
    updater.on('update-downloaded',info=>{
      if(!acceptable(info)){fail(new Error('Der Download ist kein neuer stabiler Release.'));return}
      publish({phase:'downloaded',version:info.version,percent:100,message:`NickNotes ${info.version} ist bereit zur Installation.`})
    })
    return updater
  }).catch(error=>{updaterPromise=undefined;throw error})
  const service={
    getState:()=>({...state}),
    async check(){
      if(!enabled||disposed||operation||['available','downloading','downloaded','installing'].includes(state.phase))return service.getState()
      operation=true;publish({phase:'checking',message:'Es wird nach Updates gesucht …'})
      try{await (await getUpdater()).checkForUpdates()}catch(error){fail(error)}finally{operation=false}
      return service.getState()
    },
    async download(){
      if(!enabled||disposed||operation||state.phase!=='available')return service.getState()
      operation=true;publish({phase:'downloading',percent:0,message:'Update wird heruntergeladen …'})
      try{await (await getUpdater()).downloadUpdate()}catch(error){fail(error)}finally{operation=false}
      return service.getState()
    },
    async install(){
      if(!enabled||disposed||operation||state.phase!=='downloaded')return service.getState()
      operation=true
      try{
        const updater=await getUpdater()
        const approved=await prepareInstall(()=>{
          publish({phase:'installing',message:'Das Update wird installiert …'})
          updater.quitAndInstall(false,true)
          if(state.phase==='error')throw new Error(state.message)
        })
        if(!approved&&state.phase!=='error')publish({phase:'downloaded',message:'Installation abgebrochen. Dein Update bleibt heruntergeladen.'})
      }catch(error){fail(error)}finally{operation=false}
      return service.getState()
    },
    start(){
      if(!enabled||disposed||checkTimer)return
      // Keep imports, certificate configuration and network off the startup path.
      checkTimer=setTimeout(()=>void service.check(),30_000);checkTimer.unref?.()
      interval=setInterval(()=>void service.check(),4*60*60*1000);interval.unref?.()
    },
    dispose(){disposed=true;clearTimeout(checkTimer);clearInterval(interval)},
  }
  return service
}
