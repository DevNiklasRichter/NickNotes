import { LucideNamedIcon } from '../icons/lucideCatalog';
import {commandTitle} from '../app/commands';
type SidebarView = 'vault' | 'notes' | 'todos' | 'tasks' | 'focus' | 'tags' | 'review' | 'graph';
type ActivityRailProps = {
    sidebarView: SidebarView;
    onOpenSidebarView: (view: SidebarView) => void;
    onOpenSettings: () => void;
};
export function ActivityRail({ sidebarView, onOpenSidebarView, onOpenSettings, }: ActivityRailProps) {
    const activeSidebarView = sidebarView;
    return (<aside className="activity-rail" data-tooltip-side="right">
      <div className="rail-header">
        <span className="rail-header-title">Workspace</span>
      </div>

      <div className="rail-menu">
        <button className={activeSidebarView === 'vault' ? 'active' : ''} onClick={() => onOpenSidebarView('vault')} aria-label="NoteBase" data-tooltip={commandTitle('vault')}>
          <span className="rail-glyph">
            <LucideNamedIcon name="LayoutGrid" size={14}/>
          </span>
          <span className="rail-label">NoteBase</span>
        </button>
        <button className={activeSidebarView === 'notes' ? 'active' : ''} onClick={() => onOpenSidebarView('notes')} aria-label="Notizen" data-tooltip={commandTitle('notes')}>
          <span className="rail-glyph">
            <LucideNamedIcon name="FileText" size={14}/>
          </span>
          <span className="rail-label">Notizen</span>
        </button>
        <button className={activeSidebarView === 'todos' ? 'active' : ''} onClick={() => onOpenSidebarView('todos')} aria-label="Todos" data-tooltip={commandTitle('todos')}>
          <span className="rail-glyph">
            <LucideNamedIcon name="ListTodo" size={14}/>
          </span>
          <span className="rail-label">Todos</span>
        </button>
        <button className={activeSidebarView === 'tasks' ? 'active' : ''} onClick={() => onOpenSidebarView('tasks')} aria-label="Tasks" data-tooltip={commandTitle('tasks')}>
          <span className="rail-glyph">
            <LucideNamedIcon name="CheckSquare" size={14}/>
          </span>
          <span className="rail-label">Tasks</span>
        </button>
        <button className={activeSidebarView === 'focus' ? 'active' : ''} onClick={() => onOpenSidebarView('focus')} aria-label="Focus" data-tooltip={commandTitle('focus')}>
          <span className="rail-glyph">
            <LucideNamedIcon name="Crosshair" size={14}/>
          </span>
          <span className="rail-label">Focus</span>
        </button>
        <button className={activeSidebarView === 'tags' ? 'active' : ''} onClick={() => onOpenSidebarView('tags')} aria-label="Tagging" data-tooltip={commandTitle('tags')}>
          <span className="rail-glyph">
            <LucideNamedIcon name="Tag" size={14}/>
          </span>
          <span className="rail-label">Tags</span>
        </button>
        <button className={activeSidebarView === 'review' ? 'active' : ''} onClick={() => onOpenSidebarView('review')} aria-label="Review" data-tooltip={commandTitle('review')}>
          <span className="rail-glyph">
            <LucideNamedIcon name="BarChart3" size={14}/>
          </span>
          <span className="rail-label">Review</span>
        </button>
        <button className={activeSidebarView === 'graph' ? 'active' : ''} onClick={() => onOpenSidebarView('graph')} aria-label="Graph" data-tooltip={commandTitle('graph')}>
          <span className="rail-glyph">
            <LucideNamedIcon name="Network" size={14}/>
          </span>
          <span className="rail-label">Graph</span>
        </button>

      </div>

      <div className="rail-spacer"/>

      <button onClick={onOpenSettings} data-tooltip={commandTitle('settings')} aria-label="Einstellungen">
        <span className="rail-glyph">
          <LucideNamedIcon name="Settings" size={14}/>
        </span>
      </button>
    </aside>);
}
