import { LucideNamedIcon } from '../icons/lucideCatalog'

type SidebarView = 'vault' | 'notes' | 'todos' | 'tasks' | 'focus' | 'tags' | 'review' | 'graph'

type ActivityRailProps = {
  sidebarView: SidebarView
  assistantActive: boolean
  assistantAvailable: boolean
  onOpenSidebarView: (view: SidebarView) => void
  onOpenAssistant: () => void
  onOpenSettings: () => void
}

export function ActivityRail({
  sidebarView,
  assistantActive,
  assistantAvailable,
  onOpenSidebarView,
  onOpenAssistant,
  onOpenSettings,
}: ActivityRailProps) {
  const activeSidebarView = assistantActive ? null : sidebarView

  return (
    <aside className="activity-rail">
      <div className="rail-header">
        <span className="rail-header-title">Workspace</span>
      </div>

      <div className="rail-menu">
        <button className={activeSidebarView === 'vault' ? 'active' : ''} onClick={() => onOpenSidebarView('vault')} title="NoteBase">
          <span className="rail-glyph">
            <LucideNamedIcon name="LayoutGrid" size={14} />
          </span>
          <span className="rail-label">NoteBase</span>
        </button>
        <button className={activeSidebarView === 'notes' ? 'active' : ''} onClick={() => onOpenSidebarView('notes')} title="Notizen">
          <span className="rail-glyph">
            <LucideNamedIcon name="FileText" size={14} />
          </span>
          <span className="rail-label">Notizen</span>
        </button>
        <button className={activeSidebarView === 'todos' ? 'active' : ''} onClick={() => onOpenSidebarView('todos')} title="Todos">
          <span className="rail-glyph">
            <LucideNamedIcon name="ListTodo" size={14} />
          </span>
          <span className="rail-label">Todos</span>
        </button>
        <button className={activeSidebarView === 'tasks' ? 'active' : ''} onClick={() => onOpenSidebarView('tasks')} title="Tasks">
          <span className="rail-glyph">
            <LucideNamedIcon name="CheckSquare" size={14} />
          </span>
          <span className="rail-label">Tasks</span>
        </button>
        <button className={activeSidebarView === 'focus' ? 'active' : ''} onClick={() => onOpenSidebarView('focus')} title="Focus">
          <span className="rail-glyph">
            <LucideNamedIcon name="Crosshair" size={14} />
          </span>
          <span className="rail-label">Focus</span>
        </button>
        <button className={activeSidebarView === 'tags' ? 'active' : ''} onClick={() => onOpenSidebarView('tags')} title="Tagging">
          <span className="rail-glyph">
            <LucideNamedIcon name="Tag" size={14} />
          </span>
          <span className="rail-label">Tags</span>
        </button>
        <button className={activeSidebarView === 'review' ? 'active' : ''} onClick={() => onOpenSidebarView('review')} title="Review">
          <span className="rail-glyph">
            <LucideNamedIcon name="BarChart3" size={14} />
          </span>
          <span className="rail-label">Review</span>
        </button>
        <button className={activeSidebarView === 'graph' ? 'active' : ''} onClick={() => onOpenSidebarView('graph')} title="Graph">
          <span className="rail-glyph">
            <LucideNamedIcon name="Network" size={14} />
          </span>
          <span className="rail-label">Graph</span>
        </button>
        {assistantAvailable ? (
          <button className={assistantActive ? 'active' : ''} onClick={onOpenAssistant} title="KI-Assistent">
            <span className="rail-glyph">
              <LucideNamedIcon name="MessageCircle" size={14} />
            </span>
            <span className="rail-label">KI-Assistent</span>
          </button>
        ) : null}
      </div>

      <div className="rail-spacer" />

      <button onClick={onOpenSettings} title="Einstellungen" aria-label="Einstellungen">
        <span className="rail-glyph">
          <LucideNamedIcon name="Settings" size={14} />
        </span>
      </button>
    </aside>
  )
}
