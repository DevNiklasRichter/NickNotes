/**
 * Small always-on-top capture window for the global shortcut. It is created on first use and only
 * hidden afterwards, so it opens instantly and keeps its draft while NickNotes runs.
 */
export function createQuickCaptureWindow({BrowserWindow,screen,preload,load,theme,background}){
  let win=null
  let closing=false
  const create=()=>{
    win=new BrowserWindow({
      width:600,height:320,minWidth:440,minHeight:240,show:false,frame:false,
      alwaysOnTop:true,skipTaskbar:true,maximizable:false,minimizable:false,fullscreenable:false,
      title:'NickNotes Schnellerfassung',backgroundColor:background(),
      webPreferences:{preload,contextIsolation:true,sandbox:true,nodeIntegration:false,additionalArguments:[`--nicknotes-theme=${theme()}`]},
    })
    win.webContents.setWindowOpenHandler(()=>({action:'deny'}))
    win.webContents.on('will-navigate',event=>event.preventDefault())
    // Closing (Alt+F4) only hides; the draft stays and the next shortcut is instant.
    win.on('close',event=>{if(!closing){event.preventDefault();win.hide()}})
    win.on('closed',()=>{win=null})
    load(win)
  }
  const place=()=>{
    const point=screen.getCursorScreenPoint()
    const area=screen.getDisplayNearestPoint(point).workArea
    const [width,height]=win.getSize()
    win.setPosition(Math.round(area.x+(area.width-width)/2),Math.round(area.y+Math.max(24,(area.height-height)*0.3)))
  }
  const reveal=()=>{
    if(!win)return
    win.setBackgroundColor(background())
    win.show();win.focus()
    win.webContents.send('quick-capture:shown',{theme:theme()})
  }
  return {
    show(){
      if(!win)create()
      if(!win.isVisible())place()
      if(win.webContents.isLoading())win.webContents.once('did-finish-load',reveal)
      else reveal()
    },
    toggle(){
      if(win&&win.isVisible()&&win.isFocused())win.hide()
      else this.show()
    },
    hide(){win?.hide()},
    owns(webContents){return Boolean(win&&!win.isDestroyed()&&webContents===win.webContents)},
    destroy(){closing=true;if(win&&!win.isDestroyed())win.destroy();win=null},
  }
}
