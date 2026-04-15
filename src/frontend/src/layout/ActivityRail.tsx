import { LucideNamedIcon } from '../icons/lucideCatalog'

type SidebarView = 'vault' | 'notes' | 'todos' | 'tasks' | 'focus' | 'tags' | 'review'

type ActivityRailProps = {
  sidebarView: SidebarView
  settingsTabOpen: boolean
  onOpenSidebarView: (view: SidebarView) => void
  onOpenSettings: () => void
}

export function ActivityRail({ sidebarView, settingsTabOpen, onOpenSidebarView, onOpenSettings }: ActivityRailProps) {
  return (
    <aside className="activity-rail">
      <div className="rail-brand">
        <span className="rail-logo">NN</span>
        <div className="rail-brand-copy">
          <strong>NickNotes</strong>
          <span>Workspace</span>
        </div>
      </div>

      <div className="rail-menu">
        <button className={sidebarView === 'vault' ? 'active' : ''} onClick={() => onOpenSidebarView('vault')} title="Board">
          <span className="rail-glyph">
            <LucideNamedIcon name="LayoutGrid" size={14} />
          </span>
          <span className="rail-label">Board</span>
        </button>
        <button className={sidebarView === 'notes' ? 'active' : ''} onClick={() => onOpenSidebarView('notes')} title="Notizen">
          <span className="rail-glyph">
            <LucideNamedIcon name="FileText" size={14} />
          </span>
          <span className="rail-label">Notizen</span>
        </button>
        <button className={sidebarView === 'todos' ? 'active' : ''} onClick={() => onOpenSidebarView('todos')} title="Todos">
          <span className="rail-glyph">
            <LucideNamedIcon name="ListTodo" size={14} />
          </span>
          <span className="rail-label">Todos</span>
        </button>
        <button className={sidebarView === 'tasks' ? 'active' : ''} onClick={() => onOpenSidebarView('tasks')} title="Tasks">
          <span className="rail-glyph">
            <LucideNamedIcon name="CheckSquare" size={14} />
          </span>
          <span className="rail-label">Tasks</span>
        </button>
        <button className={sidebarView === 'focus' ? 'active' : ''} onClick={() => onOpenSidebarView('focus')} title="Focus">
          <span className="rail-glyph">
            <LucideNamedIcon name="Crosshair" size={14} />
          </span>
          <span className="rail-label">Focus</span>
        </button>
        <button className={sidebarView === 'tags' ? 'active' : ''} onClick={() => onOpenSidebarView('tags')} title="Tagging">
          <span className="rail-glyph">
            <LucideNamedIcon name="Tag" size={14} />
          </span>
          <span className="rail-label">Tags</span>
        </button>
        <button className={sidebarView === 'review' ? 'active' : ''} onClick={() => onOpenSidebarView('review')} title="Review">
          <span className="rail-glyph">
            <LucideNamedIcon name="BarChart3" size={14} />
          </span>
          <span className="rail-label">Review</span>
        </button>
      </div>

      <div className="rail-spacer" />

      <button className={settingsTabOpen ? 'active' : ''} onClick={onOpenSettings} title="Einstellungen" aria-label="Einstellungen">
        <span className="rail-glyph">
          <LucideNamedIcon name="Settings" size={14} />
        </span>
      </button>
    </aside>
  )
}
