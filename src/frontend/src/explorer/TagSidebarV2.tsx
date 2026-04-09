import { useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { LucideNamedIcon } from '../icons/lucideCatalog'
import './ExplorerSidebar.css'

type ContextMenuTarget =
  | {
      kind: 'group'
      groupName: string
    }
  | {
      kind: 'tag'
      groupName: string
      tagName: string
    }

type ContextMenuState = {
  x: number
  y: number
  target: ContextMenuTarget
} | null

type TagSidebarProps = {
  vaultLoaded: boolean
  width: number
  onWidthChange: (nextWidth: number) => void
  sortedGroupNames: string[]
  tagGroups: Record<string, string[]>
  expandedGroups: Record<string, boolean>
  onToggleGroup: (folderKey: string) => void
  onCreateGroup: () => void
  onCreateTag: (preferredGroup: string | null) => void
  onRenameGroup: (groupName: string) => void
  onDeleteGroup: (groupName: string) => void
  onRenameTag: (groupName: string, tagName: string) => void
  onDeleteTag: (groupName: string, tagName: string) => void
}

type VisibleTagGroup = {
  groupName: string
  folderKey: string
  tags: string[]
  totalCount: number
}

const MIN_WIDTH = 220
const MAX_WIDTH = 520

function normalizeQuery(value: string): string {
  return value.trim().toLowerCase()
}

function isTagTarget(
  target: ContextMenuTarget
): target is {
  kind: 'tag'
  groupName: string
  tagName: string
} {
  return target.kind === 'tag'
}

function openContextAt(
  event: ReactMouseEvent<HTMLElement>,
  target: ContextMenuTarget,
  setContextMenu: (next: ContextMenuState) => void,
  setSelectedGroupName: (next: string) => void
) {
  event.preventDefault()
  event.stopPropagation()
  setSelectedGroupName(target.groupName)
  setContextMenu({ x: event.clientX, y: event.clientY, target })
}

export function TagSidebar({
  vaultLoaded,
  width,
  onWidthChange,
  sortedGroupNames,
  tagGroups,
  expandedGroups,
  onToggleGroup,
  onCreateGroup,
  onCreateTag,
  onRenameGroup,
  onDeleteGroup,
  onRenameTag,
  onDeleteTag,
}: TagSidebarProps) {
  const [filterQuery, setFilterQuery] = useState('')
  const [selectedGroupName, setSelectedGroupName] = useState<string>('')
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null)
  const contextPanelRef = useRef<HTMLDivElement | null>(null)

  const visibleGroups = useMemo<VisibleTagGroup[]>(() => {
    const query = normalizeQuery(filterQuery)
    return sortedGroupNames.reduce<VisibleTagGroup[]>((result, groupName) => {
      const tags = tagGroups[groupName] ?? []
      if (!query) {
        result.push({
          groupName,
          folderKey: `tag-group-${groupName}`,
          tags,
          totalCount: tags.length,
        })
        return result
      }

      const groupMatch = groupName.toLowerCase().includes(query)
      const matchingTags = groupMatch
        ? tags
        : tags.filter((tag) => {
            const cleanTag = tag.toLowerCase()
            if (cleanTag.includes(query)) {
              return true
            }
            return `${groupName}:${tag}`.toLowerCase().includes(query)
          })

      if (!groupMatch && matchingTags.length === 0) {
        return result
      }

      result.push({
        groupName,
        folderKey: `tag-group-${groupName}`,
        tags: matchingTags,
        totalCount: tags.length,
      })
      return result
    }, [])
  }, [filterQuery, sortedGroupNames, tagGroups])

  useEffect(() => {
    if (!selectedGroupName && sortedGroupNames.length > 0) {
      setSelectedGroupName(sortedGroupNames[0])
      return
    }
    if (selectedGroupName && !sortedGroupNames.some((name) => name.toLowerCase() === selectedGroupName.toLowerCase())) {
      setSelectedGroupName(sortedGroupNames[0] ?? '')
    }
  }, [selectedGroupName, sortedGroupNames])

  useEffect(() => {
    if (!contextMenu) {
      return
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Node && contextPanelRef.current?.contains(target)) {
        return
      }
      setContextMenu(null)
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [contextMenu])

  return (
    <div
      className="explorer-shell tag-explorer-shell"
      onClick={() => {
        setContextMenu(null)
      }}
    >
      <header className="explorer-toolbar">
        <h3>TAGS</h3>
        <div className="explorer-toolbar-search">
          <input
            className="explorer-search-input"
            value={filterQuery}
            onChange={(event) => setFilterQuery(event.target.value)}
            placeholder="Tags filtern"
            onClick={(event) => event.stopPropagation()}
          />
        </div>
      </header>

      <div className="explorer-toolbar-actions-row">
        <div className="explorer-toolbar-actions">
          <button
            className="icon-button compact"
            onClick={(event) => {
              event.stopPropagation()
              onCreateGroup()
            }}
            disabled={!vaultLoaded}
            title="Neue Tag-Gruppe"
          >
            <LucideNamedIcon name="FolderPlus" className="row-action-icon" size={14} />
          </button>
          <button
            className="icon-button compact"
            onClick={(event) => {
              event.stopPropagation()
              onCreateTag(selectedGroupName || null)
            }}
            disabled={!vaultLoaded || sortedGroupNames.length === 0}
            title="Neuer Tag in bestehender Gruppe"
          >
            <LucideNamedIcon name="Tag" className="row-action-icon" size={14} />
          </button>
        </div>
      </div>

      <section className="explorer-tree explorer-flat-tree tag-explorer-tree">
        {visibleGroups.length === 0 ? <p className="empty-copy">Keine passenden Tags oder Gruppen.</p> : null}

        {visibleGroups.map((group) => {
          const isOpen = expandedGroups[group.folderKey] ?? true
          const visibleCount = isOpen ? group.tags.length : group.totalCount
          const isSelected = selectedGroupName.toLowerCase() === group.groupName.toLowerCase()

          return (
            <div key={group.folderKey} className="explorer-row-wrap">
              <div
                className={`explorer-row compact tag-group-row ${isSelected ? 'selected' : ''}`}
                style={{ paddingLeft: '8px' }}
                onClick={(event) => {
                  event.stopPropagation()
                  setContextMenu(null)
                  setSelectedGroupName(group.groupName)
                  onToggleGroup(group.folderKey)
                }}
                onContextMenu={(event) => openContextAt(event, { kind: 'group', groupName: group.groupName }, setContextMenu, setSelectedGroupName)}
              >
                <div className="row-content">
                  <span className="row-pin-slot" aria-hidden="true">
                    {' '}
                  </span>
                  <button
                    type="button"
                    className="twistie row-twistie show"
                    onClick={(event) => {
                      event.stopPropagation()
                      setContextMenu(null)
                      setSelectedGroupName(group.groupName)
                      onToggleGroup(group.folderKey)
                    }}
                  >
                    <LucideNamedIcon name={isOpen ? 'ChevronDown' : 'ChevronRight'} size={12} className="twistie-icon" />
                  </button>
                  <span className="row-name">{group.groupName}</span>
                </div>
                <div className="row-meta">
                  <button
                    type="button"
                    className="row-folder-menu"
                    onClick={(event) =>
                      openContextAt(event, { kind: 'group', groupName: group.groupName }, setContextMenu, setSelectedGroupName)
                    }
                    title="Gruppe verwalten"
                  >
                    <LucideNamedIcon name="MoreHorizontal" size={13} className="row-menu-icon" />
                  </button>
                  <span className="row-count">{visibleCount}</span>
                </div>
              </div>

              {isOpen
                ? group.tags.map((tag) => (
                    <div
                      key={`${group.groupName}:${tag}`}
                      className="explorer-row compact tag-entry-row"
                      style={{ paddingLeft: '30px' }}
                      onClick={(event) => {
                        event.stopPropagation()
                        setContextMenu(null)
                        setSelectedGroupName(group.groupName)
                      }}
                      onContextMenu={(event) =>
                        openContextAt(
                          event,
                          { kind: 'tag', groupName: group.groupName, tagName: tag },
                          setContextMenu,
                          setSelectedGroupName
                        )
                      }
                    >
                      <div className="row-content">
                        <span className="row-pin-slot" aria-hidden="true">
                          {' '}
                        </span>
                        <span className="tag-entry-marker" aria-hidden="true">
                          <LucideNamedIcon name="Hash" size={11} className="tag-entry-icon" />
                        </span>
                        <span className="row-name">{tag}</span>
                      </div>
                      <div className="row-meta">
                        <button
                          type="button"
                          className="row-folder-menu"
                          onClick={(event) =>
                            openContextAt(
                              event,
                              { kind: 'tag', groupName: group.groupName, tagName: tag },
                              setContextMenu,
                              setSelectedGroupName
                            )
                          }
                          title="Tag verwalten"
                        >
                          <LucideNamedIcon name="MoreHorizontal" size={13} className="row-menu-icon" />
                        </button>
                      </div>
                    </div>
                  ))
                : null}

              {isOpen && group.tags.length === 0 ? <p className="empty-copy tag-group-empty">Noch keine Tags.</p> : null}
            </div>
          )
        })}
      </section>

      {contextMenu ? (
        <div className="explorer-context-menu" style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}>
          <div className="explorer-context-panel modern-tag-context" ref={contextPanelRef}>
            {contextMenu.target.kind === 'group' ? (
              <>
                <button
                  className="context-menu-item"
                  onClick={() => {
                    onCreateTag(contextMenu.target.groupName)
                    setContextMenu(null)
                  }}
                >
                  <LucideNamedIcon name="Tag" className="context-menu-icon" size={14} />
                  <span>Neuen Tag erstellen</span>
                </button>
                <button
                  className="context-menu-item"
                  onClick={() => {
                    onRenameGroup(contextMenu.target.groupName)
                    setContextMenu(null)
                  }}
                >
                  <LucideNamedIcon name="Pencil" className="context-menu-icon" size={14} />
                  <span>Gruppe umbenennen</span>
                </button>
                <button
                  className="context-menu-item danger"
                  onClick={() => {
                    onDeleteGroup(contextMenu.target.groupName)
                    setContextMenu(null)
                  }}
                >
                  <LucideNamedIcon name="Trash2" className="context-menu-icon" size={14} />
                  <span>Gruppe loeschen</span>
                </button>
              </>
            ) : (
              <>
                <button
                  className="context-menu-item"
                  onClick={() => {
                    if (!isTagTarget(contextMenu.target)) {
                      return
                    }
                    onRenameTag(contextMenu.target.groupName, contextMenu.target.tagName)
                    setContextMenu(null)
                  }}
                >
                  <LucideNamedIcon name="Pencil" className="context-menu-icon" size={14} />
                  <span>Tag umbenennen</span>
                </button>
                <button
                  className="context-menu-item danger"
                  onClick={() => {
                    if (!isTagTarget(contextMenu.target)) {
                      return
                    }
                    onDeleteTag(contextMenu.target.groupName, contextMenu.target.tagName)
                    setContextMenu(null)
                  }}
                >
                  <LucideNamedIcon name="Trash2" className="context-menu-icon" size={14} />
                  <span>Tag loeschen</span>
                </button>
              </>
            )}
          </div>
        </div>
      ) : null}

      <div
        className="explorer-width-handle"
        onMouseDown={(event) => {
          event.preventDefault()
          const startX = event.clientX
          const startWidth = width
          const onMove = (moveEvent: MouseEvent) =>
            onWidthChange(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + moveEvent.clientX - startX)))
          const onUp = () => {
            window.removeEventListener('mousemove', onMove)
            window.removeEventListener('mouseup', onUp)
          }
          window.addEventListener('mousemove', onMove)
          window.addEventListener('mouseup', onUp)
        }}
        title="Explorer-Breite anpassen"
      />
    </div>
  )
}
