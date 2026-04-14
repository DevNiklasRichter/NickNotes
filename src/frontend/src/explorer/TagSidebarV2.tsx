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

type TagSortDirection = 'asc' | 'desc'

type TagSearchMatch =
  | {
      kind: 'group'
      groupId: string
      folderKey: string
    }
  | {
      kind: 'tag'
      groupId: string
      tagId: string
      folderKey: string
    }

const MIN_WIDTH = 220
const MAX_WIDTH = 520

function normalizeQuery(value: string): string {
  return value.trim().toLowerCase()
}

function compareByDisplayName(left: { id: string; displayName: string }, right: { id: string; displayName: string }): number {
  const byName = left.displayName.localeCompare(right.displayName, 'de', { sensitivity: 'base' })
  if (byName !== 0) {
    return byName
  }
  return left.id.localeCompare(right.id, 'de', { sensitivity: 'base' })
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
  setSelectedGroupId: (next: string) => void,
  setSelectedTagKey: (next: string) => void
) {
  event.preventDefault()
  event.stopPropagation()
  setSelectedGroupId(target.groupId)
  setSelectedTagKey(target.kind === 'tag' ? `${target.groupId}:${target.tagId}` : '')
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
  const [selectedTagKey, setSelectedTagKey] = useState<string>('')
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null)
  const [sortDirection, setSortDirection] = useState<TagSortDirection>('asc')
  const [sortMenuOpen, setSortMenuOpen] = useState(false)
  const [searchCursor, setSearchCursor] = useState(-1)
  const contextPanelRef = useRef<HTMLDivElement | null>(null)
  const sortMenuRef = useRef<HTMLDivElement | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)

  const visibleGroups = useMemo<VisibleTagGroup[]>(() => {
    const query = normalizeQuery(filterQuery)
    const orderedGroups = [...groups].sort((left, right) => {
      const byDisplay = compareByDisplayName(left, right)
      return sortDirection === 'asc' ? byDisplay : -byDisplay
    })

    return orderedGroups.reduce<VisibleTagGroup[]>((result, group) => {
      const orderedTags = [...group.tags].sort((left, right) => {
        const byDisplay = compareByDisplayName(left, right)
        return sortDirection === 'asc' ? byDisplay : -byDisplay
      })

      if (!query) {
        result.push({
          group,
          folderKey: `tag-group-${group.id}`,
          tags: orderedTags,
          totalCount: group.tags.length,
        })
        return result
      }

      const groupBag = `${group.id} ${group.displayName}`.toLowerCase()
      const groupMatch = groupBag.includes(query)
      const matchingTags = groupMatch
        ? orderedTags
        : orderedTags.filter((tag) => {
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
  }, [filterQuery, groups, sortDirection])

  const searchMatches = useMemo<TagSearchMatch[]>(() => {
    const query = normalizeQuery(filterQuery)
    if (!query) {
      return []
    }
    const matches: TagSearchMatch[] = []
    for (const entry of visibleGroups) {
      const groupBag = `${entry.group.id} ${entry.group.displayName}`.toLowerCase()
      if (groupBag.includes(query)) {
        matches.push({
          kind: 'group',
          groupId: entry.group.id,
          folderKey: entry.folderKey,
        })
      }
      for (const tag of entry.tags) {
        const tagBag = `${tag.id} ${tag.displayName} ${entry.group.id}/${tag.id}`.toLowerCase()
        if (!tagBag.includes(query)) {
          continue
        }
        matches.push({
          kind: 'tag',
          groupId: entry.group.id,
          tagId: tag.id,
          folderKey: entry.folderKey,
        })
      }
    }
    return matches
  }, [filterQuery, visibleGroups])

  const jumpToSearchMatch = (direction: 1 | -1) => {
    if (searchMatches.length === 0) {
      return
    }
    const nextIndex =
      searchCursor < 0
        ? direction === 1
          ? 0
          : searchMatches.length - 1
        : (searchCursor + direction + searchMatches.length) % searchMatches.length
    const match = searchMatches[nextIndex]
    setSearchCursor(nextIndex)
    setSelectedGroupId(match.groupId)
    if ((expandedGroups[match.folderKey] ?? true) === false) {
      onToggleGroup(match.folderKey)
    }
    if (match.kind === 'tag') {
      setSelectedTagKey(`${match.groupId}:${match.tagId}`)
    } else {
      setSelectedTagKey('')
    }
  }

  useEffect(() => {
    if (!selectedGroupId && visibleGroups.length > 0) {
      setSelectedGroupId(visibleGroups[0].group.id)
      return
    }
    if (selectedGroupId && !groups.some((group) => group.id.toLowerCase() === selectedGroupId.toLowerCase())) {
      setSelectedGroupId(visibleGroups[0]?.group.id ?? groups[0]?.id ?? '')
    }
  }, [groups, selectedGroupId, visibleGroups])

  useEffect(() => {
    if (!selectedTagKey) {
      return
    }
    const selectedKey = selectedTagKey.toLowerCase()
    const stillExists = groups.some((group) =>
      group.tags.some((tag) => `${group.id}:${tag.id}`.toLowerCase() === selectedKey)
    )
    if (!stillExists) {
      setSelectedTagKey('')
    }
  }, [groups, selectedTagKey])

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

  useEffect(() => {
    if (!sortMenuOpen) {
      return
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Node && sortMenuRef.current?.contains(target)) {
        return
      }
      setSortMenuOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [sortMenuOpen])

  useEffect(() => {
    setSearchCursor(-1)
  }, [filterQuery])

  useEffect(() => {
    if (searchCursor < searchMatches.length) {
      return
    }
    setSearchCursor(-1)
  }, [searchCursor, searchMatches.length])

  return (
    <div
      className="explorer-shell tag-explorer-shell"
      onClick={() => {
        setContextMenu(null)
        setSortMenuOpen(false)
      }}
    >
      <header className="explorer-toolbar">
        <div className="explorer-toolbar-top">
          <div className="explorer-toolbar-left">
            <div className="explorer-sort-anchor" ref={sortMenuRef}>
              <button
                className={`icon-button compact ${sortMenuOpen ? 'active' : ''}`}
                onClick={(event) => {
                  event.stopPropagation()
                  setSortMenuOpen((prev) => !prev)
                }}
                disabled={!vaultLoaded}
                title="Sortierung aendern"
              >
                <LucideNamedIcon name="ArrowUpDown" className="row-action-icon" size={14} />
              </button>
              {sortMenuOpen ? (
                <div className="explorer-sort-menu">
                  <div className="explorer-sort-menu-section">
                    <span>Sortierung</span>
                    <button
                      className={sortDirection === 'asc' ? 'active' : ''}
                      onClick={() => {
                        setSortDirection('asc')
                        setSortMenuOpen(false)
                      }}
                    >
                      Alphabetisch (A-Z)
                    </button>
                    <button
                      className={sortDirection === 'desc' ? 'active' : ''}
                      onClick={() => {
                        setSortDirection('desc')
                        setSortMenuOpen(false)
                      }}
                    >
                      Alphabetisch (Z-A)
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <h3>Tags</h3>

          <div className="explorer-toolbar-right">
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

        <div className="explorer-toolbar-search">
          <div className="explorer-search-input-wrap">
            <LucideNamedIcon name="Search" className="explorer-search-icon" size={14} />
            <input
              ref={searchInputRef}
              className="explorer-search-input"
              value={filterQuery}
              onChange={(event) => setFilterQuery(event.target.value)}
              placeholder="Search"
              title={filterQuery ? 'Enter: naechster Treffer, Shift+Enter: vorheriger Treffer' : 'Tags und Gruppen filtern'}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') {
                  return
                }
                event.preventDefault()
                jumpToSearchMatch(event.shiftKey ? -1 : 1)
              }}
            />
            {filterQuery ? (
              <button
                type="button"
                className="explorer-search-clear"
                onPointerDown={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  setFilterQuery('')
                  setSearchCursor(-1)
                  window.requestAnimationFrame(() => {
                    searchInputRef.current?.focus()
                  })
                }}
                aria-label="Suche leeren"
                title="Suche leeren"
              >
                <LucideNamedIcon name="X" size={12} />
              </button>
            ) : null}
          </div>
        </div>
      </header>

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
                  setSortMenuOpen(false)
                  setSelectedGroupId(group.id)
                  setSelectedTagKey('')
                  onToggleGroup(entry.folderKey)
                }}
                onContextMenu={(event) =>
                  openContextAt(event, { kind: 'group', groupId: group.id }, setContextMenu, setSelectedGroupId, setSelectedTagKey)
                }
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
                      setSortMenuOpen(false)
                      setSelectedGroupId(group.id)
                      setSelectedTagKey('')
                      onToggleGroup(entry.folderKey)
                    }}
                  >
                    <LucideNamedIcon name={isOpen ? 'ChevronDown' : 'ChevronRight'} size={12} className="twistie-icon" />
                  </button>
                  <span
                    className="row-name tag-colored-label"
                    style={{ '--tag-accent': group.color } as CSSProperties}
                    title={group.id}
                  >
                    {group.displayName}
                  </span>
                </div>
                <div className="row-meta">
                  <button
                    type="button"
                    className="row-folder-menu"
                    onClick={(event) =>
                      openContextAt(event, { kind: 'group', groupId: group.id }, setContextMenu, setSelectedGroupId, setSelectedTagKey)
                    }
                    title="Gruppe verwalten"
                  >
                    <LucideNamedIcon name="MoreHorizontal" size={13} className="row-menu-icon" />
                  </button>
                  <span className="row-count">{entry.totalCount}</span>
                </div>
              </div>

              {isOpen
                ? entry.tags.map((tag) => {
                    const tagKey = `${group.id}:${tag.id}`
                    return (
                    <div
                      key={tagKey}
                      className={`explorer-row compact tag-entry-row ${selectedTagKey.toLowerCase() === tagKey.toLowerCase() ? 'selected' : ''}`}
                      style={{ paddingLeft: '30px' }}
                      onClick={(event) => {
                        event.stopPropagation()
                        setContextMenu(null)
                        setSortMenuOpen(false)
                        setSelectedGroupId(group.id)
                        setSelectedTagKey(tagKey)
                      }}
                      onContextMenu={(event) =>
                        openContextAt(
                          event,
                          { kind: 'tag', groupId: group.id, tagId: tag.id },
                          setContextMenu,
                          setSelectedGroupId,
                          setSelectedTagKey
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
                        <span
                          className="row-name tag-colored-label"
                          style={{ '--tag-accent': group.color } as CSSProperties}
                          title={`${group.id}/${tag.id}`}
                        >
                          {tag.displayName}
                        </span>
                      </div>
                      <div className="row-meta">
                        <button
                          type="button"
                          className="row-folder-menu"
                          onClick={(event) =>
                            openContextAt(
                              event,
                              { kind: 'tag', groupId: group.id, tagId: tag.id },
                              setContextMenu,
                              setSelectedGroupId,
                              setSelectedTagKey
                            )
                          }
                          title="Tag verwalten"
                        >
                          <LucideNamedIcon name="MoreHorizontal" size={13} className="row-menu-icon" />
                        </button>
                      </div>
                    </div>
                    )
                  })
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
