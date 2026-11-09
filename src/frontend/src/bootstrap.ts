// Paint and restore the small capture before loading React, editors and dashboards.
function start() {
  window.nicknotesStartup?.mount((ready,failed)=>{
    window.nicknotesStartup?.deferUi(()=>{
      import('./mountApp').then(({mount})=>mount(ready,failed)).catch(failed)
    })
  })
}
if(window.nicknotesStartup)start()
else window.addEventListener('nicknotes:bootstrap-ready',start,{once:true})
