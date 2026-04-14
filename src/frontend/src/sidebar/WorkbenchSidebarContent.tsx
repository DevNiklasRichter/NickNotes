import { ExplorerSidebar } from '../explorer/ExplorerSidebarFlatV3'
import { TagSidebar } from '../explorer/TagSidebarV2'
import type { ExplorerOptions, ExplorerSourceFile, ExplorerSourceGroup, ExplorerViewState } from '../explorer/types'
import { LucideNamedIcon } from '../icons/lucideCatalog'
import type { TagGroupDefinition } from '../tags/tagTypes'

type SidebarView = 'vault' | 'notes' | 'tags' | 'tasks' | 'review'

type TaskRow = {
  id: string
  title: string
  status: string
  priority: string
  due_date: string | null
  updated_at: string
}

type ReviewDaily = {
  date: string
  new_notes: number
  open_tasks: number
  done_today: number
}

type ReviewWeekly = {
  from: string
  to: string
  notes_total: number
  tasks_open: number
  tasks_done: number
}

type WorkbenchSidebarContentProps = {
  sidebarView: SidebarView
  noteBaseName: string
  vaultLoaded: boolean
  explorerWidth: number
  onExplorerWidthChange: (nextWidth: number) => void
  onRenameNoteBase: () => void
  onDeleteNoteBase: () => void
  onPickAndOpenVault: () => void
  onCreateVault: () => void
  onMigrateExistingNotesToTemplate: () => void
  tasks: TaskRow[]
  onRefreshTasks: () => void
  onMarkTaskDone: (id: string) => void
  taskStatusClassName: (raw: string) => string
  taskStatusLabel: (raw: string) => string
  taskPriorityDotClassName: (raw: string) => string
  taskPriorityLabel: (raw: string) => string
  toGermanTimestamp: (value: string) => string
  daily: ReviewDaily | null
  weekly: ReviewWeekly | null
  onRefreshReview: () => void
  mergedTagGroups: TagGroupDefinition[]
  expandedFolders: Record<string, boolean>
  onToggleFolder: (folderKey: string) => void
  onCreateTagGroup: () => void
  onCreateTagInExistingGroup: (groupName: string | null) => void
  onRenameTagGroup: (groupName: string) => void
  onSetTagGroupColor: (groupName: string) => void
  onDeleteTagGroup: (groupName: string) => void
  onRenameTag: (groupName: string, tagName: string) => void
  onDeleteTag: (groupName: string, tagName: string) => void
  noteGroups: ExplorerSourceGroup[]
  explorerRows: ExplorerSourceFile[]
  activeNotePath: string
  dirtyFilePaths: Set<string>
  vaultPath: string
  onOpenNoteInTab: (path: string, title?: string) => Promise<void>
  onOpenNoteInCurrentEditor: (path: string, title?: string) => Promise<void>
  onCreateExplorerFile: (parentFolderKey: string, title: string) => Promise<void>
  onCreateExplorerTask: (parentFolderKey: string, title: string) => Promise<void>
  onCreateExplorerFolder: (parentFolderKey: string, name: string) => Promise<void>
  onRenameExplorerFile: (path: string, newName: string) => Promise<void>
  onRenameExplorerFolder: (groupKey: string, newName: string) => Promise<void>
  onDeleteExplorerFile: (path: string) => Promise<void>
  onDeleteExplorerFolder: (groupKey: string) => Promise<void>
  onMoveExplorerFile: (path: string, targetGroupKey: string) => Promise<void>
  onMoveExplorerFiles: (paths: string[], targetGroupKey: string) => Promise<void>
  onMoveExplorerFolder: (groupKey: string, targetParentKey: string) => Promise<void>
  onToggleFavoriteFolder: (groupKey: string) => Promise<void>
  explorerOptions: ExplorerOptions
  explorerContentMatchPathKeys: Set<string>
  onExplorerFilterQueryChange: (query: string) => void
  onExplorerOptionsChange: (next: ExplorerOptions) => void
  explorerRevealPath: string
  explorerRevealRequestId: number
  explorerViewSeed: ExplorerViewState | null
  explorerViewSeedId: number
  onExplorerViewStateChange: (next: ExplorerViewState) => void
  onRefreshExplorerSidebarData: () => void
}

export function WorkbenchSidebarContent({
  sidebarView,
  noteBaseName,
  vaultLoaded,
  explorerWidth,
  onExplorerWidthChange,
  onRenameNoteBase,
  onDeleteNoteBase,
  onPickAndOpenVault,
  onCreateVault,
  onMigrateExistingNotesToTemplate,
  tasks,
  onRefreshTasks,
  onMarkTaskDone,
  taskStatusClassName,
  taskStatusLabel,
  taskPriorityDotClassName,
  taskPriorityLabel,
  toGermanTimestamp,
  daily,
  weekly,
  onRefreshReview,
  mergedTagGroups,
  expandedFolders,
  onToggleFolder,
  onCreateTagGroup,
  onCreateTagInExistingGroup,
  onRenameTagGroup,
  onSetTagGroupColor,
  onDeleteTagGroup,
  onRenameTag,
  onDeleteTag,
  noteGroups,
  explorerRows,
  activeNotePath,
  dirtyFilePaths,
  vaultPath,
  onOpenNoteInTab,
  onOpenNoteInCurrentEditor,
  onCreateExplorerFile,
  onCreateExplorerTask,
  onCreateExplorerFolder,
  onRenameExplorerFile,
  onRenameExplorerFolder,
  onDeleteExplorerFile,
  onDeleteExplorerFolder,
  onMoveExplorerFile,
  onMoveExplorerFiles,
  onMoveExplorerFolder,
  onToggleFavoriteFolder,
  explorerOptions,
  explorerContentMatchPathKeys,
  onExplorerFilterQueryChange,
  onExplorerOptionsChange,
  explorerRevealPath,
  explorerRevealRequestId,
  explorerViewSeed,
  explorerViewSeedId,
  onExplorerViewStateChange,
  onRefreshExplorerSidebarData,
}: WorkbenchSidebarContentProps) {
  if (sidebarView === 'vault') {
    return (
      <div className="sidebar-content">
        <h3>Board</h3>
        <p className="muted-label">Aktive NoteBase</p>
        <div className="active-notebase-row">
          <strong>{noteBaseName || 'Keine NoteBase'}</strong>
          <div className="hover-menu-anchor">
            <button className="icon-button compact muted" title="NoteBase-Menue">
              <LucideNamedIcon name="MoreHorizontal" size={14} />
            </button>
            <div className="hover-menu">
              <button onClick={onRenameNoteBase}>NoteBase umbenennen</button>
              <button className="danger" onClick={onDeleteNoteBase}>
                NoteBase loeschen
              </button>
            </div>
          </div>
        </div>

        <div className="stacked-actions">
          <button onClick={onPickAndOpenVault}>NoteBase laden</button>
          <button onClick={onCreateVault}>NoteBase anlegen</button>
          <button onClick={onMigrateExistingNotesToTemplate} disabled={!vaultLoaded}>
            Templates migrieren
          </button>
        </div>
      </div>
    )
  }

  if (sidebarView === 'tasks') {
    return (
      <div className="sidebar-content">
        <div className="sidebar-header-row">
          <h3>Tasks</h3>
          <button onClick={onRefreshTasks} disabled={!vaultLoaded}>
            Aktualisieren
          </button>
        </div>

        <div className="task-list">
          {tasks.length === 0 ? <p className="empty-copy">Keine offenen Tasks.</p> : null}
          {tasks.map((task) => (
            <article key={task.id} className="task-item">
              <header>
                <strong>{task.title}</strong>
                <div className="task-meta-badges">
                  <span className={taskStatusClassName(task.status)}>{taskStatusLabel(task.status)}</span>
                  <span className="task-priority-badge">
                    <span className={taskPriorityDotClassName(task.priority)} aria-hidden="true" />
                    {taskPriorityLabel(task.priority)}
                  </span>
                </div>
              </header>
              <p>{task.due_date ? `Faellig: ${task.due_date}` : 'Kein Faelligkeitsdatum'}</p>
              <p className="muted-copy">{toGermanTimestamp(task.updated_at)}</p>
              <button onClick={() => onMarkTaskDone(task.id)} disabled={task.status === 'done'}>
                Done
              </button>
            </article>
          ))}
        </div>
      </div>
    )
  }

  if (sidebarView === 'review') {
    return (
      <div className="sidebar-content">
        <div className="sidebar-header-row">
          <h3>Review</h3>
          <button onClick={onRefreshReview} disabled={!vaultLoaded}>
            Aktualisieren
          </button>
        </div>

        <section className="review-card">
          <h4>Daily</h4>
          {daily ? (
            <>
              <p>Datum: {daily.date}</p>
              <p>Neue Notizen: {daily.new_notes}</p>
              <p>Offene Tasks: {daily.open_tasks}</p>
              <p>Heute erledigt: {daily.done_today}</p>
            </>
          ) : (
            <p className="empty-copy">Keine Daily-Daten.</p>
          )}
        </section>

        <section className="review-card">
          <h4>Weekly</h4>
          {weekly ? (
            <>
              <p>
                Zeitraum: {weekly.from} bis {weekly.to}
              </p>
              <p>Notizen gesamt: {weekly.notes_total}</p>
              <p>Tasks offen: {weekly.tasks_open}</p>
              <p>Tasks erledigt: {weekly.tasks_done}</p>
            </>
          ) : (
            <p className="empty-copy">Keine Weekly-Daten.</p>
          )}
        </section>
      </div>
    )
  }

  if (sidebarView === 'tags') {
    return (
      <TagSidebar
        vaultLoaded={vaultLoaded}
        width={explorerWidth}
        onWidthChange={onExplorerWidthChange}
        groups={mergedTagGroups}
        expandedGroups={expandedFolders}
        onToggleGroup={onToggleFolder}
        onCreateGroup={onCreateTagGroup}
        onCreateTag={onCreateTagInExistingGroup}
        onRenameGroup={onRenameTagGroup}
        onSetGroupColor={onSetTagGroupColor}
        onDeleteGroup={onDeleteTagGroup}
        onRenameTag={onRenameTag}
        onDeleteTag={onDeleteTag}
      />
    )
  }

  return (
    <ExplorerSidebar
      vaultLoaded={vaultLoaded}
      vaultPath={vaultPath}
      groups={noteGroups}
      files={explorerRows}
      activeFilePath={activeNotePath}
      dirtyFilePaths={dirtyFilePaths}
      width={explorerWidth}
      onWidthChange={onExplorerWidthChange}
      onOpenFile={onOpenNoteInTab}
      onPreviewFile={onOpenNoteInCurrentEditor}
      onCreateFile={onCreateExplorerFile}
      onCreateTask={onCreateExplorerTask}
      onCreateFolder={onCreateExplorerFolder}
      onRenameFile={onRenameExplorerFile}
      onRenameFolder={onRenameExplorerFolder}
      onDeleteFile={onDeleteExplorerFile}
      onDeleteFolder={onDeleteExplorerFolder}
      onMoveFile={onMoveExplorerFile}
      onMoveFiles={onMoveExplorerFiles}
      onMoveFolder={onMoveExplorerFolder}
      onToggleFavoriteFolder={onToggleFavoriteFolder}
      options={explorerOptions}
      contentMatchFilePathKeys={explorerContentMatchPathKeys}
      onFilterQueryChange={onExplorerFilterQueryChange}
      onOptionsChange={onExplorerOptionsChange}
      revealFilePath={explorerRevealPath}
      revealRequestId={explorerRevealRequestId}
      viewStateSeed={explorerViewSeed}
      viewStateSeedId={explorerViewSeedId}
      onViewStateChange={onExplorerViewStateChange}
      onRefresh={onRefreshExplorerSidebarData}
    />
  )
}
