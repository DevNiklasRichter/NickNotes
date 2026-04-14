import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, DragEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import type { NoteTab } from '../app/AppShared'
import { LucideNamedIcon } from '../icons/lucideCatalog'
import type { PaneId, WorkspaceState } from './workspaceState'

const WORKSPACE_TAB_MIME = 'application/x-nicknotes-workspace-tab'
const MIN_SPLIT_PANE_PX = 320

type InternalTabDragPayload = {
  tabId: string
  sourcePaneId: PaneId
}

export type ExternalNoteDropPayload = {
  path: string
  title?: string
}

type EditorWorkspaceLayoutProps = {
  workspace: WorkspaceState
  paneTabs: Record<PaneId, NoteTab[]>
  paneActiveTabs: Record<PaneId, NoteTab | null>
  activePaneId: PaneId
  disableSave: boolean
  disableReveal: boolean
  onSaveActive: () => void
  onRevealActive: () => void
  onToggleSplitMode: () => void
  onCloseEditorPanel: () => void
  onSetSplitRatio: (nextRatio: number) => void
  onActivateTab: (paneId: PaneId, tabId: string) => void
  onCloseTab: (tabId: string) => void
  onFocusPane: (paneId: PaneId, tabId?: string | null) => void
  onMoveTabWithinPane: (paneId: PaneId, fromIndex: number, toIndex: number) => void
  onMoveTabToPane: (fromPaneId: PaneId, toPaneId: PaneId, tabId: string) => void
  onDropExternalNote: (paneId: PaneId, payload: ExternalNoteDropPayload) => void
  onTabContextMenu: (tabId: string, x: number, y: number) => void
  renderPaneContent: (paneId: PaneId, activeTab: NoteTab | null) => ReactNode
  resolveTabIconName: (tab: NoteTab) => string
}

function parseInternalTabDragPayload(event: DragEvent<HTMLElement>): InternalTabDragPayload | null {
  const raw = event.dataTransfer.getData(WORKSPACE_TAB_MIME)
  if (!raw) {
    return null
  }
  try {
    const parsed = JSON.parse(raw) as Partial<InternalTabDragPayload>
    if (
      typeof parsed.tabId !== 'string' ||
      !parsed.tabId ||
      (parsed.sourcePaneId !== 'left' && parsed.sourcePaneId !== 'right')
    ) {
      return null
    }
    return {
      tabId: parsed.tabId,
      sourcePaneId: parsed.sourcePaneId,
    }
  } catch {
    return null
  }
}

function parseExternalNoteDropPayload(event: DragEvent<HTMLElement>): ExternalNoteDropPayload | null {
  const explicitPath =
    event.dataTransfer.getData('application/x-note-path') ||
    event.dataTransfer.getData('application/x-open-tab-path') ||
    event.dataTransfer.getData('text/plain')
  const explicitTitle =
    event.dataTransfer.getData('application/x-note-title') || event.dataTransfer.getData('application/x-open-tab-title')

  const path = explicitPath.trim()
  if (!path) {
    return null
  }
  const title = explicitTitle.trim()
  return {
    path,
    title: title || undefined,
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function EmptyPanePlaceholder() {
  return (
    <div className="editor-pane-empty">
      <span className="editor-pane-empty-glyph" aria-hidden="true">
        <LucideNamedIcon name="FileText" size={18} />
      </span>
      <p>Keine Notiz geoeffnet</p>
    </div>
  )
}

export function EditorWorkspaceLayout({
  workspace,
  paneTabs,
  paneActiveTabs,
  activePaneId,
  disableSave,
  disableReveal,
  onSaveActive,
  onRevealActive,
  onToggleSplitMode,
  onCloseEditorPanel,
  onSetSplitRatio,
  onActivateTab,
  onCloseTab,
  onFocusPane,
  onMoveTabWithinPane,
  onMoveTabToPane,
  onDropExternalNote,
  onTabContextMenu,
  renderPaneContent,
  resolveTabIconName,
}: EditorWorkspaceLayoutProps) {
  const splitRootRef = useRef<HTMLDivElement | null>(null)
  const resizeStateRef = useRef<{ startX: number; startRatio: number; width: number } | null>(null)
  const [resizing, setResizing] = useState(false)
  const [draggedTabId, setDraggedTabId] = useState<string | null>(null)
  const [dragOverPaneId, setDragOverPaneId] = useState<PaneId | null>(null)
  const [dropIndexByPane, setDropIndexByPane] = useState<Record<PaneId, number | null>>({
    left: null,
    right: null,
  })

  useEffect(() => {
    if (!resizing) {
      return
    }
    const onPointerMove = (event: PointerEvent) => {
      const resizeState = resizeStateRef.current
      if (!resizeState) {
        return
      }
      const delta = event.clientX - resizeState.startX
      const ratioFromDelta = resizeState.startRatio + delta / resizeState.width
      const minRatio = Math.min(0.45, MIN_SPLIT_PANE_PX / resizeState.width)
      const nextRatio = clamp(ratioFromDelta, minRatio, 1 - minRatio)
      onSetSplitRatio(nextRatio)
    }
    const onPointerUp = () => {
      resizeStateRef.current = null
      setResizing(false)
    }

    document.body.classList.add('workspace-split-resizing')
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    return () => {
      document.body.classList.remove('workspace-split-resizing')
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
    }
  }, [onSetSplitRatio, resizing])

  const clearDragIndicators = () => {
    setDragOverPaneId(null)
    setDropIndexByPane({ left: null, right: null })
  }

  const resetDragState = () => {
    setDraggedTabId(null)
    clearDragIndicators()
  }

  const beginSplitResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const host = splitRootRef.current
    if (!host) {
      return
    }
    const width = host.getBoundingClientRect().width
    if (!Number.isFinite(width) || width <= MIN_SPLIT_PANE_PX * 2) {
      return
    }
    resizeStateRef.current = {
      startX: event.clientX,
      startRatio: workspace.splitRatio,
      width,
    }
    setResizing(true)
    event.preventDefault()
  }

  const handleTabDropOnPane = (event: DragEvent<HTMLElement>, paneId: PaneId, dropOnTabBar: boolean) => {
    event.preventDefault()
    if (dropOnTabBar) {
      event.stopPropagation()
    }

    const internalPayload = parseInternalTabDragPayload(event)
    if (internalPayload) {
      const targetTabs = paneTabs[paneId]
      if (internalPayload.sourcePaneId === paneId) {
        const fromIndex = targetTabs.findIndex((tab) => tab.id === internalPayload.tabId)
        if (fromIndex >= 0 && targetTabs.length > 0) {
          const hoveredIndex = dropIndexByPane[paneId]
          const fallbackIndex = targetTabs.length - 1
          const nextIndex = clamp(hoveredIndex ?? fallbackIndex, 0, targetTabs.length - 1)
          onMoveTabWithinPane(paneId, fromIndex, nextIndex)
        }
      } else if (workspace.layoutMode === 'split') {
        onMoveTabToPane(internalPayload.sourcePaneId, paneId, internalPayload.tabId)
      }
      resetDragState()
      return
    }

    const externalPayload = parseExternalNoteDropPayload(event)
    if (externalPayload) {
      onDropExternalNote(paneId, externalPayload)
    }
    resetDragState()
  }

  const splitStyle = useMemo<CSSProperties | undefined>(() => {
    if (workspace.layoutMode !== 'split') {
      return undefined
    }
    const leftRatioPercent = `${Math.round(workspace.splitRatio * 1000) / 10}%`
    const rightRatioPercent = `${Math.round((1 - workspace.splitRatio) * 1000) / 10}%`
    return {
      gridTemplateColumns: `minmax(${MIN_SPLIT_PANE_PX}px, ${leftRatioPercent}) 8px minmax(${MIN_SPLIT_PANE_PX}px, ${rightRatioPercent})`,
    }
  }, [workspace.layoutMode, workspace.splitRatio])

  const renderPane = (paneId: PaneId) => {
    const tabs = paneTabs[paneId]
    const activeTab = paneActiveTabs[paneId]
    const isDropTarget = dragOverPaneId === paneId
    const tabDropIndex = dropIndexByPane[paneId]
    const isActivePane = activePaneId === paneId

    return (
      <article
        key={`workspace-pane-${paneId}`}
        className={`workspace-pane ${isDropTarget ? 'drop-active' : ''} ${isActivePane ? 'focused' : ''}`}
        onPointerDown={() => {
          onFocusPane(paneId, activeTab?.id ?? null)
        }}
        onDragOver={(event) => {
          event.preventDefault()
          if (dragOverPaneId !== paneId) {
            setDragOverPaneId(paneId)
          }
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node)) {
            setDragOverPaneId((current) => (current === paneId ? null : current))
          }
        }}
        onDrop={(event) => handleTabDropOnPane(event, paneId, false)}
      >
        <div
          className={`pane-tab-bar ${isDropTarget ? 'drop-active' : ''}`}
          onDragOver={(event) => {
            event.preventDefault()
            if (dragOverPaneId !== paneId) {
              setDragOverPaneId(paneId)
            }
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node)) {
              setDragOverPaneId((current) => (current === paneId ? null : current))
            }
          }}
          onDrop={(event) => handleTabDropOnPane(event, paneId, true)}
        >
          <div className="pane-tab-list">
            {tabs.map((tab, index) => {
              const isActive = activeTab?.id === tab.id
              const isDragging = draggedTabId === tab.id
              const displayTitle = tab.kind === 'note' ? tab.title.replace(/\.md$/i, '') : tab.title
              const isDropAtIndex = tabDropIndex === index && dragOverPaneId === paneId && draggedTabId !== null
              return (
                <div
                  key={`${paneId}-tab-${tab.id}`}
                  className={`pane-tab ${isActive ? 'active' : ''} ${isDragging ? 'dragging' : ''} ${isDropAtIndex ? 'drop-target' : ''}`}
                  draggable={tab.kind === 'note'}
                  onDragStart={(event) => {
                    if (tab.kind !== 'note') {
                      event.preventDefault()
                      return
                    }
                    const payload: InternalTabDragPayload = {
                      tabId: tab.id,
                      sourcePaneId: paneId,
                    }
                    event.dataTransfer.effectAllowed = 'move'
                    event.dataTransfer.setData(WORKSPACE_TAB_MIME, JSON.stringify(payload))
                    event.dataTransfer.setData('application/x-open-tab-path', tab.path)
                    event.dataTransfer.setData('application/x-open-tab-title', tab.title)
                    event.dataTransfer.setData('text/plain', tab.path)
                    setDraggedTabId(tab.id)
                    setDragOverPaneId(paneId)
                  }}
                  onDragEnd={resetDragState}
                  onDragOver={(event) => {
                    event.preventDefault()
                    if (dragOverPaneId !== paneId) {
                      setDragOverPaneId(paneId)
                    }
                    setDropIndexByPane((current) => (current[paneId] === index ? current : { ...current, [paneId]: index }))
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault()
                    onTabContextMenu(tab.id, event.clientX, event.clientY)
                  }}
                >
                  <button
                    className="tab-open"
                    onClick={() => {
                      onActivateTab(paneId, tab.id)
                    }}
                    title={displayTitle}
                  >
                    <span className="tab-kind-icon" aria-hidden="true">
                      <LucideNamedIcon name={resolveTabIconName(tab)} size={13} />
                    </span>
                    <span>{displayTitle}</span>
                    {tab.dirty ? (
                      <span className="tab-dirty-dot">
                        <LucideNamedIcon name="Circle" size={8} />
                      </span>
                    ) : null}
                  </button>
                  <button
                    className="tab-close"
                    onClick={() => {
                      onCloseTab(tab.id)
                    }}
                    title="Tab schliessen"
                  >
                    <LucideNamedIcon name="X" size={14} />
                  </button>
                </div>
              )
            })}
          </div>
        </div>

        <div className="workspace-pane-content">{activeTab ? renderPaneContent(paneId, activeTab) : <EmptyPanePlaceholder />}</div>
      </article>
    )
  }

  return (
    <article className="workspace-panel editor-workspace-panel">
      <div className="editor-tabs workspace-toolbar">
        <div className="workspace-toolbar-label">
          <span>{workspace.layoutMode === 'split' ? 'Split-Editor' : 'Editor'}</span>
        </div>
        <div className="editor-tab-actions">
          <button className="icon-button compact muted" onClick={onSaveActive} disabled={disableSave} title="Speichern">
            <LucideNamedIcon name="Save" size={14} />
          </button>
          <button
            className="icon-button compact muted"
            onClick={onRevealActive}
            disabled={disableReveal}
            title="Im Explorer anzeigen"
          >
            <LucideNamedIcon name="FolderSearch" size={14} />
          </button>
          <button
            className="icon-button compact muted"
            onClick={onToggleSplitMode}
            title={workspace.layoutMode === 'split' ? 'Split aus' : 'Split an'}
          >
            <LucideNamedIcon name="Columns2" size={14} />
          </button>
          <button className="icon-button compact muted" onClick={onCloseEditorPanel} title="Editor schliessen">
            <LucideNamedIcon name="X" size={14} />
          </button>
        </div>
      </div>

      {workspace.layoutMode === 'split' ? (
        <div ref={splitRootRef} className="editor-workspace-split" style={splitStyle}>
          {renderPane('left')}
          <div
            className={`editor-split-resize-handle ${resizing ? 'active' : ''}`}
            onPointerDown={beginSplitResize}
            role="separator"
            aria-orientation="vertical"
            aria-label="Pane-Breite anpassen"
          />
          {renderPane('right')}
        </div>
      ) : (
        <div className="editor-workspace-single">{renderPane('left')}</div>
      )}
    </article>
  )
}
