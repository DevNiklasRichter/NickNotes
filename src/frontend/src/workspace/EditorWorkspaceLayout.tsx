import {contextMenuAnchor, isContextMenuKey} from '../ui/contextMenuAnchor'
import type {ContextMenuAnchor} from '../ui/contextMenuAnchor'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, DragEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import type { NoteTab } from '../app/AppShared'
import {commandTitle} from '../app/commands'
import { LucideNamedIcon } from '../icons/lucideCatalog'
import type { PaneId, WorkspaceState } from './workspaceState'

const WORKSPACE_TAB_MIME = 'application/x-nicknotes-workspace-tab'
const MIN_SPLIT_PANE_PX = 320
const OVERFLOW_BUTTON_WIDTH_PX = 30
const FALLBACK_TAB_WIDTH_PX = 140
const TAB_GAP_PX = 4

type InternalTabDragPayload = {
  tabId: string
  sourcePaneId: PaneId
}

export type ExternalNoteDropPayload = {
  path: string
  title?: string
}

type EditorWorkspaceLayoutProps = {
  writingMode: boolean
  onToggleWritingMode: () => void
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
  onTabContextMenu: (tabId: string, anchor: ContextMenuAnchor) => void
  renderPaneContent: (paneId: PaneId, activeTab: NoteTab | null) => ReactNode
  resolveTabIconName: (tab: NoteTab) => string
  getTabTooltip: (tab: NoteTab) => string
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
      <p>Keine Notiz geöffnet</p>
    </div>
  )
}

function isDraggableWorkspaceTab(tab: NoteTab): boolean {
  return (
    tab.kind === 'note' ||
    tab.kind === 'todo_dashboard' ||
    tab.kind === 'task_dashboard' ||
    tab.kind === 'focus_dashboard' ||
    tab.kind === 'review_dashboard' ||
    tab.kind === 'graph_dashboard'
  )
}

export function EditorWorkspaceLayout({
  writingMode,
  onToggleWritingMode,
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
  getTabTooltip,
}: EditorWorkspaceLayoutProps) {
  const splitRootRef = useRef<HTMLDivElement | null>(null)
  const paneTabListRefs = useRef<Record<PaneId, HTMLDivElement | null>>({
    left: null,
    right: null,
  })
  const paneTabItemRefs = useRef<Record<PaneId, Record<string, HTMLDivElement | null>>>({
    left: {},
    right: {},
  })
  const resizeStateRef = useRef<{ startX: number; startRatio: number; width: number } | null>(null)
  const [resizing, setResizing] = useState(false)
  const [draggedTabId, setDraggedTabId] = useState<string | null>(null)
  const [dragOverPaneId, setDragOverPaneId] = useState<PaneId | null>(null)
  const [insertIndexByPane, setInsertIndexByPane] = useState<Record<PaneId, number | null>>({
    left: null,
    right: null,
  })
  const [hiddenTabIdsByPane, setHiddenTabIdsByPane] = useState<Record<PaneId, string[]>>({
    left: [],
    right: [],
  })
  const [overflowMenuPaneId, setOverflowMenuPaneId] = useState<PaneId | null>(null)

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
    setInsertIndexByPane({ left: null, right: null })
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

  const computeHiddenTabIdsForPane = useCallback((paneId: PaneId): string[] => {
    const tabs = paneTabs[paneId]
    if (tabs.length === 0) {
      return []
    }
    const tabList = paneTabListRefs.current[paneId]
    if (!tabList) {
      return []
    }
    const tabBar = tabList.parentElement
    if (!(tabBar instanceof HTMLElement)) {
      return []
    }

    const measuredFallback =
      tabs.map((tab) => paneTabItemRefs.current[paneId][tab.id]?.offsetWidth ?? 0).find((width) => width > 0) ??
      FALLBACK_TAB_WIDTH_PX
    const widths = tabs.map((tab) => paneTabItemRefs.current[paneId][tab.id]?.offsetWidth ?? measuredFallback)
    const tabBarStyle = window.getComputedStyle(tabBar)
    const horizontalPadding =
      (Number.parseFloat(tabBarStyle.paddingLeft || '0') || 0) + (Number.parseFloat(tabBarStyle.paddingRight || '0') || 0)
    const contentWidth = Math.max(0, tabBar.clientWidth - horizontalPadding)
    if (contentWidth <= 0) {
      return []
    }

    let usedWithoutButton = 0
    let needsOverflow = false
    for (let index = 0; index < widths.length; index += 1) {
      const addition = widths[index] + (index > 0 ? TAB_GAP_PX : 0)
      if (usedWithoutButton + addition > contentWidth) {
        needsOverflow = true
        break
      }
      usedWithoutButton += addition
    }
    if (!needsOverflow) {
      return []
    }

    const availableWidth = Math.max(0, contentWidth - OVERFLOW_BUTTON_WIDTH_PX - TAB_GAP_PX)
    let usedWithButton = 0
    let fitCount = 0
    for (let index = 0; index < widths.length; index += 1) {
      const addition = widths[index] + (index > 0 ? TAB_GAP_PX : 0)
      if (usedWithButton + addition > availableWidth) {
        break
      }
      usedWithButton += addition
      fitCount += 1
    }

    return tabs.slice(fitCount).map((tab) => tab.id)
  }, [paneTabs])

  useEffect(() => {
    const recalc = () => {
      const nextHidden: Record<PaneId, string[]> = {
        left: computeHiddenTabIdsForPane('left'),
        right: computeHiddenTabIdsForPane('right'),
      }
      setHiddenTabIdsByPane((current) => {
        const leftEqual =
          current.left.length === nextHidden.left.length &&
          current.left.every((tabId, index) => tabId === nextHidden.left[index])
        const rightEqual =
          current.right.length === nextHidden.right.length &&
          current.right.every((tabId, index) => tabId === nextHidden.right[index])
        if (leftEqual && rightEqual) {
          return current
        }
        return nextHidden
      })
    }

    const frameId = window.requestAnimationFrame(() => {
      recalc()
    })

    const observer = new ResizeObserver(() => {
      recalc()
    })
    const leftList = paneTabListRefs.current.left
    const rightList = paneTabListRefs.current.right
    if (leftList) {
      observer.observe(leftList)
    }
    if (rightList) {
      observer.observe(rightList)
    }

    window.addEventListener('resize', recalc)
    return () => {
      window.cancelAnimationFrame(frameId)
      observer.disconnect()
      window.removeEventListener('resize', recalc)
    }
  }, [computeHiddenTabIdsForPane, workspace.layoutMode, workspace.splitRatio])

  useEffect(() => {
    if (!overflowMenuPaneId) {
      return
    }
    const hiddenTabIds = hiddenTabIdsByPane[overflowMenuPaneId]
    if (hiddenTabIds.length > 0) {
      return
    }
    const frameId = window.requestAnimationFrame(() => {
      setOverflowMenuPaneId(null)
    })
    return () => {
      window.cancelAnimationFrame(frameId)
    }
  }, [hiddenTabIdsByPane, overflowMenuPaneId])

  useEffect(() => {
    if (!overflowMenuPaneId) {
      return
    }
    const closeMenuOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof HTMLElement && target.closest('.pane-tab-overflow')) {
        return
      }
      setOverflowMenuPaneId(null)
    }
    window.addEventListener('pointerdown', closeMenuOnOutsidePointer)
    return () => {
      window.removeEventListener('pointerdown', closeMenuOnOutsidePointer)
    }
  }, [overflowMenuPaneId])

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
          const hoveredInsertIndex = insertIndexByPane[paneId] ?? targetTabs.length
          let nextIndex = hoveredInsertIndex
          if (nextIndex > fromIndex) {
            nextIndex -= 1
          }
          nextIndex = clamp(nextIndex, 0, targetTabs.length - 1)
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

  const renderPaneTabBar = (paneId: PaneId, variant: 'pane' | 'toolbar' = 'pane') => {
    const menuAnchor = (trigger: HTMLElement) => contextMenuAnchor(trigger,
      trigger.closest<HTMLElement>('.workspace-pane') ??
      trigger.closest('.editor-workspace-panel')?.querySelector<HTMLElement>(`[data-pane-id="${paneId}"]`))
    const tabs = paneTabs[paneId]
    const hiddenTabIdSet = new Set(hiddenTabIdsByPane[paneId])
    const visibleEntries = tabs
      .map((tab, index) => ({ tab, index }))
      .filter((entry) => !hiddenTabIdSet.has(entry.tab.id))
    const hiddenTabs = tabs.filter((tab) => hiddenTabIdSet.has(tab.id))
    const activeTab = paneActiveTabs[paneId]
    const isDropTarget = dragOverPaneId === paneId
    const tabInsertIndex = insertIndexByPane[paneId]
    const showInsertMarker = isDropTarget && draggedTabId !== null
    const overflowMenuOpen = overflowMenuPaneId === paneId && hiddenTabs.length > 0
    const tabBarClassName = `pane-tab-bar ${variant === 'toolbar' ? 'toolbar-tab-bar' : ''} ${
      isDropTarget ? 'drop-active' : ''
    }`.trim()

    return (
      <div
        className={tabBarClassName}
        onPointerDown={() => {
          onFocusPane(paneId, activeTab?.id ?? null)
        }}
        onDragOver={(event) => {
          event.preventDefault()
          if (dragOverPaneId !== paneId) {
            setDragOverPaneId(paneId)
          }
          const target = event.target
          if (target instanceof HTMLElement && target.closest('.pane-tab')) {
            return
          }
          setInsertIndexByPane((current) => ({ ...current, [paneId]: tabs.length }))
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node)) {
            setDragOverPaneId((current) => (current === paneId ? null : current))
            setInsertIndexByPane((current) => ({ ...current, [paneId]: null }))
          }
        }}
        onDrop={(event) => handleTabDropOnPane(event, paneId, true)}
      >
        <div
          className="pane-tab-list"
          ref={(node) => {
            paneTabListRefs.current[paneId] = node
          }}
        >
          {visibleEntries.map((entry) => {
            const { tab, index } = entry
            const isActive = activeTab?.id === tab.id
            const isDragging = draggedTabId === tab.id
            const displayTitle = tab.kind === 'note' ? tab.title.replace(/\.md$/i, '') : tab.title
            const showMarkerBefore = showInsertMarker && tabInsertIndex === index
            return (
              <div
                key={`${paneId}-tab-wrap-${tab.id}`}
                className="pane-tab-wrap"
                ref={(node) => {
                  paneTabItemRefs.current[paneId][tab.id] = node
                }}
              >
                {showMarkerBefore ? <div className="pane-tab-insert-marker" aria-hidden="true" /> : null}
                <div
                  className={`pane-tab ${isActive ? 'active' : ''} ${isDragging ? 'dragging' : ''}`}
                  draggable={isDraggableWorkspaceTab(tab)}
                  onDragStart={(event) => {
                    if (!isDraggableWorkspaceTab(tab)) {
                      event.preventDefault()
                      return
                    }
                    const payload: InternalTabDragPayload = {
                      tabId: tab.id,
                      sourcePaneId: paneId,
                    }
                    event.dataTransfer.effectAllowed = 'move'
                    event.dataTransfer.setData(WORKSPACE_TAB_MIME, JSON.stringify(payload))
                    if (tab.kind === 'note') {
                      event.dataTransfer.setData('application/x-open-tab-path', tab.path)
                      event.dataTransfer.setData('application/x-open-tab-title', tab.title)
                      event.dataTransfer.setData('text/plain', tab.path)
                    }
                    setDraggedTabId(tab.id)
                    setDragOverPaneId(paneId)
                    setInsertIndexByPane((current) => ({ ...current, [paneId]: index + 1 }))
                  }}
                  onDragEnd={resetDragState}
                  onDragOver={(event) => {
                    event.preventDefault()
                    if (dragOverPaneId !== paneId) {
                      setDragOverPaneId(paneId)
                    }
                    const rect = event.currentTarget.getBoundingClientRect()
                    const placeBefore = event.clientX < rect.left + rect.width / 2
                    const nextInsertIndex = placeBefore ? index : index + 1
                    setInsertIndexByPane((current) =>
                      current[paneId] === nextInsertIndex ? current : { ...current, [paneId]: nextInsertIndex }
                    )
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault()
                    const trigger = event.currentTarget.querySelector<HTMLButtonElement>('.tab-open')!
                    onTabContextMenu(tab.id, {...menuAnchor(trigger), x: event.clientX, y: event.clientY})
                  }}
                >
                  <button
                    className="tab-open"
                    aria-haspopup="menu"
                    onKeyDown={event => {
                      if (!isContextMenuKey(event)) return
                      event.preventDefault(); event.stopPropagation()
                      onTabContextMenu(tab.id, menuAnchor(event.currentTarget))
                    }}
                    onClick={() => {
                      onActivateTab(paneId, tab.id)
                    }}
                    data-tooltip={getTabTooltip(tab)}
                  >
                    <span className="tab-kind-icon" aria-hidden="true">
                      <LucideNamedIcon name={resolveTabIconName(tab)} size={13} />
                    </span>
                    <span className="tab-title-text">{displayTitle}</span>
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
                    aria-label="Diese Ansicht schließen" data-tooltip={`Diese Ansicht schließen\n${commandTitle('closeTab')}`}
                  >
                    <LucideNamedIcon name="X" size={14} />
                  </button>
                </div>
              </div>
            )
          })}
          {showInsertMarker && tabInsertIndex === tabs.length ? (
            <div className="pane-tab-insert-marker pane-tab-insert-marker-tail" aria-hidden="true" />
          ) : null}
        </div>
        {hiddenTabs.length > 0 ? (
          <div className="pane-tab-overflow">
            <button
              type="button"
              className={`pane-tab-overflow-toggle ${overflowMenuOpen ? 'active' : ''}`}
              onClick={() => {
                setOverflowMenuPaneId((current) => (current === paneId ? null : paneId))
              }}
              aria-label="Weitere Tabs anzeigen" data-tooltip="Weitere Tabs anzeigen"
            >
              <LucideNamedIcon name="ChevronDown" size={14} />
            </button>
            {overflowMenuOpen ? (
              <div className="pane-tab-overflow-menu">
                {hiddenTabs.map((tab) => {
                  const isActive = activeTab?.id === tab.id
                  return (
                    <button
                      key={`${paneId}-overflow-tab-${tab.id}`}
                      type="button"
                      className={`pane-tab-overflow-item ${isActive ? 'active' : ''}`}
                      data-tooltip={getTabTooltip(tab)}
                      onClick={() => {
                        const fromIndex = tabs.findIndex((entry) => entry.id === tab.id)
                        if (fromIndex > 0) {
                          onMoveTabWithinPane(paneId, fromIndex, 0)
                        }
                        onActivateTab(paneId, tab.id)
                        setOverflowMenuPaneId(null)
                      }}
                    >
                      <span className="tab-kind-icon" aria-hidden="true">
                        <LucideNamedIcon name={resolveTabIconName(tab)} size={13} />
                      </span>
                      <span className="pane-tab-overflow-item-label">{tab.title.replace(/\.md$/i, '')}</span>
                      {tab.dirty ? (
                        <span className="tab-dirty-dot">
                          <LucideNamedIcon name="Circle" size={8} />
                        </span>
                      ) : null}
                    </button>
                  )
                })}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    )
  }

  const renderPane = (paneId: PaneId, showTabBar = true) => {
    const activeTab = paneActiveTabs[paneId]
    const isDropTarget = dragOverPaneId === paneId
    const isActivePane = activePaneId === paneId

    return (
      <article
        key={`workspace-pane-${paneId}`}
        data-pane-id={paneId}
        tabIndex={-1}
        aria-label={paneId==='left'?'Linke Editorgruppe':'Rechte Editorgruppe'}
        className={`workspace-pane ${isDropTarget ? 'drop-active' : ''} ${isActivePane ? 'focused' : ''}`}
        onPointerDown={() => {
          onFocusPane(paneId, activeTab?.id ?? null)
        }}
        onFocus={() => onFocusPane(paneId, activeTab?.id ?? null)}
        onDragOver={(event) => {
          event.preventDefault()
          if (dragOverPaneId !== paneId) {
            setDragOverPaneId(paneId)
          }
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node)) {
            setDragOverPaneId((current) => (current === paneId ? null : current))
            setInsertIndexByPane((current) => ({ ...current, [paneId]: null }))
          }
        }}
        onDrop={(event) => handleTabDropOnPane(event, paneId, false)}
      >
        {showTabBar ? renderPaneTabBar(paneId) : null}

        <div className="workspace-pane-content">{activeTab?.conflict && <p className="graph-warning" role="alert">Die gespeicherte Notiz hat sich geändert. Dein Entwurf bleibt erhalten. Kopiere ihn vor dem erneuten Laden; Speichern überschreibt die externe Fassung nicht.</p>}{activeTab ? renderPaneContent(paneId, activeTab) : <EmptyPanePlaceholder />}</div>
      </article>
    )
  }

  return (
    <article className="workspace-panel editor-workspace-panel">
      <div className="editor-tabs workspace-toolbar">
        {workspace.layoutMode === 'split' ? (
          <div className="workspace-toolbar-spacer" aria-hidden="true" />
        ) : (
          renderPaneTabBar('left', 'toolbar')
        )}
        <div className="editor-tab-actions">
          <button className={`workspace-writing-button${writingMode?' active':''}`} onClick={onToggleWritingMode} aria-pressed={writingMode}
            aria-label={writingMode?'Schreibmodus beenden':'Schreibmodus starten'} data-tooltip={commandTitle('writingMode')}>
            <LucideNamedIcon name="PenLine" size={14}/><span>{writingMode?'Schreibmodus beenden':'Schreiben'}</span>
          </button>
          <button className="icon-button compact muted" onClick={onSaveActive} disabled={disableSave} aria-label="Speichern" data-tooltip={commandTitle('save')}>
            <LucideNamedIcon name="Save" size={14} />
          </button>
          <button
            className="icon-button compact muted"
            onClick={onRevealActive}
            disabled={disableReveal}
            aria-label="Im Explorer anzeigen" data-tooltip="Im Explorer anzeigen"
          >
            <LucideNamedIcon name="FolderSearch" size={14} />
          </button>
          <button
            className="icon-button compact muted"
            onClick={onToggleSplitMode}
            aria-label={workspace.layoutMode === 'split' ? 'Split aus' : 'Split an'}
            data-tooltip={commandTitle('split',workspace.layoutMode === 'split' ? 'Split aus' : 'Split an')}
          >
            <LucideNamedIcon name="Columns2" size={14} />
          </button>
          <button className="icon-button compact muted" onClick={onCloseEditorPanel} aria-label="Editor schließen" data-tooltip={commandTitle('editor','Editor schließen')}>
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
        <div className="editor-workspace-single">{renderPane('left', false)}</div>
      )}
    </article>
  )
}
