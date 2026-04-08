import { useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
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

type TagContextIconName = 'newFolder' | 'newTag' | 'rename' | 'delete'

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

function TagContextIcon({ name }: { name: TagContextIconName }) {
  if (name === 'newFolder') {
    return (
      <svg className="context-menu-icon" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M2.5 5.5a1 1 0 0 1 1-1h2l1.1 1.2H12.5a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z" />
        <path d="M8 7.8v3.6" />
        <path d="M6.2 9.6h3.6" />
      </svg>
    )
  }
  if (name === 'newTag') {
    return (
      <svg className="context-menu-icon" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M2.5 8.2V3.7a1.2 1.2 0 0 1 1.2-1.2h4.5l5.3 5.3-4.8 4.8a1.2 1.2 0 0 1-1.7 0L2.5 8.2z" />
        <path d="M6.2 5.8h0" />
        <path d="M10.8 8v3.5" />
        <path d="M9 9.8h3.6" />
      </svg>
    )
  }
  if (name === 'rename') {
    return (
      <svg className="context-menu-icon" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M3 13h3l7-7-3-3-7 7z" />
        <path d="M8.5 4.5l3 3" />
      </svg>
    )
  }
  return (
    <svg className="context-menu-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3.5 4h9" />
      <path d="M5 4V3h6v1" />
      <path d="M4.5 4l.7 8a1 1 0 0 0 1 .9h3.6a1 1 0 0 0 1-.9l.7-8" />
      <path d="M6.4 6.5v4.5" />
      <path d="M9.6 6.5v4.5" />
    </svg>
  )
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
            <TagContextIcon name="newFolder" />
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
            <TagContextIcon name="newTag" />
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
                    {isOpen ? '\u25BE' : '\u25B8'}
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
                    ...
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
                          #
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
                          ...
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
                    onRenameGroup(contextMenu.target.groupName)
                    setContextMenu(null)
                  }}
                >
                  <TagContextIcon name="rename" />
                  <span>Gruppe umbenennen</span>
                </button>
                <button
                  className="context-menu-item danger"
                  onClick={() => {
                    onDeleteGroup(contextMenu.target.groupName)
                    setContextMenu(null)
                  }}
                >
                  <TagContextIcon name="delete" />
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
                  <TagContextIcon name="rename" />
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
                  <TagContextIcon name="delete" />
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
