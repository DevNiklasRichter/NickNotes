import {LucideNamedIcon} from '../icons/lucideCatalog'
import {commandSpec, commandTitle} from '../app/commands'

type SidebarView = 'vault' | 'notes' | 'todos' | 'tasks' | 'focus' | 'tags' | 'review' | 'graph'
type ActivityRailProps = {
  sidebarView: SidebarView
  noteBaseName: string
  onOpenSidebarView: (view: SidebarView) => void
  onOpenSettings: () => void
}
const groups = [
  {label:'Schreiben',items:[{id:'notes',icon:'FileText'}]},
  {label:'Aufgaben',items:[{id:'todos',icon:'ListTodo',detail:'In Notizen'},{id:'tasks',icon:'CheckSquare',detail:'Eigene Dateien'},{id:'focus',icon:'Crosshair'}]},
  {label:'Wissen',items:[{id:'tags',icon:'Tag'},{id:'graph',icon:'Network'},{id:'review',icon:'BarChart3'}]},
] as const

export function ActivityRail({sidebarView,noteBaseName,onOpenSidebarView,onOpenSettings}:ActivityRailProps) {
  return <aside className="activity-rail" data-tooltip-side="right">
    <div className="rail-header"><span className="rail-header-title">Bereiche</span></div>
    <button type="button" className={sidebarView==='vault'?'active':''} aria-label="NoteBase" aria-description={noteBaseName}
      aria-current={sidebarView==='vault'?'page':undefined} data-tooltip={`${commandTitle('vault')}\n${noteBaseName}`} onClick={()=>onOpenSidebarView('vault')}>
      <span className="rail-glyph"><LucideNamedIcon name="LayoutGrid" size={16}/></span>
      <span className="rail-label"><span>NoteBase</span><small>{noteBaseName}</small></span>
    </button>
    <nav className="rail-menu" aria-label="Arbeitsbereiche">
      {groups.map(group=><div className="rail-group" role="group" aria-label={group.label} key={group.label}>
        <p className="rail-group-label" aria-hidden="true">{group.label}</p>
        {group.items.map(item=>{
          const detail='detail' in item?item.detail:''
          return <button type="button" key={item.id} className={sidebarView===item.id?'active':''} aria-label={commandSpec(item.id).label}
            aria-current={sidebarView===item.id?'page':undefined} data-tooltip={`${commandTitle(item.id)}${detail?'\n'+detail:''}`} onClick={()=>onOpenSidebarView(item.id)}>
            <span className="rail-glyph"><LucideNamedIcon name={item.icon} size={16}/></span>
            <span className="rail-label"><span>{commandSpec(item.id).label}</span>{detail?<small>{detail}</small>:null}</span>
          </button>
        })}
      </div>)}
    </nav>
    <div className="rail-spacer"/>
    <button type="button" onClick={onOpenSettings} data-tooltip={commandTitle('settings')} aria-label="Einstellungen">
      <span className="rail-glyph"><LucideNamedIcon name="Settings" size={16}/></span>
    </button>
  </aside>
}
