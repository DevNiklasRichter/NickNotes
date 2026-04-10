import { useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import type { CSSProperties } from 'react'
import { LucideNamedIcon } from '../icons/lucideCatalog'
import type { TagDefinition, TagGroupDefinition } from '../tags/tagTypes'
import './ExplorerSidebar.css'

type ContextMenuTarget =
  | {
      kind: 'group'
      groupId: string
    }
  | {
      kind: 'tag'
      groupId: string
      tagId: string
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
  groups: TagGroupDefinition[]
  expandedGroups: Record<string, boolean>
  onToggleGroup: (folderKey: string) => void
  onCreateGroup: () => void
  onCreateTag: (preferredGroupId: string | null) => void
  onRenameGroup: (groupId: string) => void
  onSetGroupColor: (groupId: string) => void
  onDeleteGroup: (groupId: string) => void
  onRenameTag: (groupId: string, tagId: string) => void
  onDeleteTag: (groupId: string, tagId: string) => void
}

type VisibleTagGroup = {
  group: TagGroupDefinition
  folderKey: string
  tags: TagDefinition[]
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
  groupId: string
  tagId: string
} {
  return target.kind === 'tag'
}

function openContextAt(
  event: ReactMouseEvent<HTMLElement>,
  target: ContextMenuTarget,
  setContextMenu: (next: ContextMenuState) => void,
  setSelectedGroupId: (next: string) => void
) {
  event.preventDefault()
  event.stopPropagation()
  setSelectedGroupId(target.groupId)
  setContextMenu({ x: event.clientX, y: event.clientY, target })
}

export function TagSidebar({
  vaultLoaded,
  width,
  onWidthChange,
  groups,
  expandedGroups,
  onToggleGroup,
  onCreateGroup,
  onCreateTag,
  onRenameGroup,
  onSetGroupColor,
  onDeleteGroup,
  onRenameTag,
  onDeleteTag,
}: TagSidebarProps) {
  const [filterQuery, setFilterQuery] = useState('')
  const [selectedGroupId, setSelectedGroupId] = useState<string>('')
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null)
  const contextPanelRef = useRef<HTMLDivElement | null>(null)

  const visibleGroups = useMemo<VisibleTagGroup[]>(() => {
    const query = normalizeQuery(filterQuery)
    return groups.reduce<VisibleTagGroup[]>((result, group) => {
      if (!query) {
        result.push({
          group,
          folderKey: `tag-group-${group.id}`,
          tags: group.tags,
          totalCount: group.tags.length,
        })
        return result
      }

      const groupBag = `${group.id} ${group.displayName}`.toLowerCase()
      const groupMatch = groupBag.includes(query)
      const matchingTags = groupMatch
        ? group.tags
        : group.tags.filter((tag) => {
            const tagBag = `${tag.id} ${tag.displayName} ${group.id}/${tag.id}`.toLowerCase()
            return tagBag.includes(query)
          })

      if (!groupMatch && matchingTags.length === 0) {
        return result
      }

      result.push({
        group,
        folderKey: `tag-group-${group.id}`,
        tags: matchingTags,
        totalCount: group.tags.length,
      })
      return result
    }, [])
  }, [filterQuery, groups])

  useEffect(() => {
    if (!selectedGroupId && groups.length > 0) {
      setSelectedGroupId(groups[0].id)
      return
    }
    if (selectedGroupId && !groups.some((group) => group.id.toLowerCase() === selectedGroupId.toLowerCase())) {
      setSelectedGroupId(groups[0]?.id ?? '')
    }
  }, [groups, selectedGroupId])

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
              onCreateTag(selectedGroupId || null)
            }}
            disabled={!vaultLoaded || groups.length === 0}
            title="Neuer Tag in bestehender Gruppe"
          >
            <LucideNamedIcon name="Tag" className="row-action-icon" size={14} />
          </button>
        </div>
      </div>

      <section className="explorer-tree explorer-flat-tree tag-explorer-tree">
        {visibleGroups.length === 0 ? <p className="empty-copy">Keine passenden Tags oder Gruppen.</p> : null}

        {visibleGroups.map((entry) => {
          const { group } = entry
          const isOpen = expandedGroups[entry.folderKey] ?? true
          const isSelected = selectedGroupId.toLowerCase() === group.id.toLowerCase()

          return (
            <div key={entry.folderKey} className="explorer-row-wrap">
              <div
                className={`explorer-row compact tag-group-row ${isSelected ? 'selected' : ''}`}
                style={{ paddingLeft: '8px' }}
                onClick={(event) => {
                  event.stopPropagation()
                  setContextMenu(null)
                  setSelectedGroupId(group.id)
                  onToggleGroup(entry.folderKey)
                }}
                onContextMenu={(event) => openContextAt(event, { kind: 'group', groupId: group.id }, setContextMenu, setSelectedGroupId)}
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
                      setSelectedGroupId(group.id)
                      onToggleGroup(entry.folderKey)
                    }}
                  >
                    <LucideNamedIcon name={isOpen ? 'ChevronDown' : 'ChevronRight'} size={12} className="twistie-icon" />
                  </button>
                  <span className="row-name tag-colored-label" style={{ '--tag-accent': group.color } as CSSProperties}>
                    {group.displayName}
                  </span>
                  <span className="tag-group-id">{group.id}</span>
                </div>
                <div className="row-meta">
                  <button
                    type="button"
                    className="row-folder-menu"
                    onClick={(event) => openContextAt(event, { kind: 'group', groupId: group.id }, setContextMenu, setSelectedGroupId)}
                    title="Gruppe verwalten"
                  >
                    <LucideNamedIcon name="MoreHorizontal" size={13} className="row-menu-icon" />
                  </button>
                  <span className="row-count">{entry.totalCount}</span>
                </div>
              </div>

              {isOpen
                ? entry.tags.map((tag) => (
                    <div
                      key={`${group.id}:${tag.id}`}
                      className="explorer-row compact tag-entry-row"
                      style={{ paddingLeft: '30px' }}
                      onClick={(event) => {
                        event.stopPropagation()
                        setContextMenu(null)
                        setSelectedGroupId(group.id)
                      }}
                      onContextMenu={(event) =>
                        openContextAt(event, { kind: 'tag', groupId: group.id, tagId: tag.id }, setContextMenu, setSelectedGroupId)
                      }
                    >
                      <div className="row-content">
                        <span className="row-pin-slot" aria-hidden="true">
                          {' '}
                        </span>
                        <span className="tag-entry-marker" aria-hidden="true">
                          <LucideNamedIcon name="Hash" size={11} className="tag-entry-icon" />
                        </span>
                        <span className="row-name tag-colored-label" style={{ '--tag-accent': group.color } as CSSProperties}>
                          {tag.displayName}
                        </span>
                        <span className="tag-entry-id">{tag.id}</span>
                      </div>
                      <div className="row-meta">
                        <button
                          type="button"
                          className="row-folder-menu"
                          onClick={(event) =>
                            openContextAt(event, { kind: 'tag', groupId: group.id, tagId: tag.id }, setContextMenu, setSelectedGroupId)
                          }
                          title="Tag verwalten"
                        >
                          <LucideNamedIcon name="MoreHorizontal" size={13} className="row-menu-icon" />
                        </button>
                      </div>
                    </div>
                  ))
                : null}

              {isOpen && entry.tags.length === 0 ? <p className="empty-copy tag-group-empty">Noch keine Tags.</p> : null}
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
                    onCreateTag(contextMenu.target.groupId)
                    setContextMenu(null)
                  }}
                >
                  <LucideNamedIcon name="Tag" className="context-menu-icon" size={14} />
                  <span>Neuen Tag erstellen</span>
                </button>
                <button
                  className="context-menu-item"
                  onClick={() => {
                    onRenameGroup(contextMenu.target.groupId)
                    setContextMenu(null)
                  }}
                >
                  <LucideNamedIcon name="Pencil" className="context-menu-icon" size={14} />
                  <span>Gruppe bearbeiten</span>
                </button>
                <button
                  className="context-menu-item"
                  onClick={() => {
                    onSetGroupColor(contextMenu.target.groupId)
                    setContextMenu(null)
                  }}
                >
                  <LucideNamedIcon name="Palette" className="context-menu-icon" size={14} />
                  <span>Farbe setzen</span>
                </button>
                <button
                  className="context-menu-item danger"
                  onClick={() => {
                    onDeleteGroup(contextMenu.target.groupId)
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
                    onRenameTag(contextMenu.target.groupId, contextMenu.target.tagId)
                    setContextMenu(null)
                  }}
                >
                  <LucideNamedIcon name="Pencil" className="context-menu-icon" size={14} />
                  <span>Tag bearbeiten</span>
                </button>
                <button
                  className="context-menu-item danger"
                  onClick={() => {
                    if (!isTagTarget(contextMenu.target)) {
                      return
                    }
                    onDeleteTag(contextMenu.target.groupId, contextMenu.target.tagId)
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
