import type { SetStateAction } from 'react'
import {
  apiRequest,
  normalizeLabel,
  isPermanentPinnedRootGroupKey,
  toNoteDisplayName,
  type NoteGroup,
  type VaultCounts,
  type NoteTab,
} from './AppShared'
import { type TagGroupDefinition } from '../tags/tagTypes'
import type { AppMutationEvent } from './mutationEvents'

type ExplorerMutationContext = {
  getBackendUrl: () => string
  getVaultLoaded: () => boolean
  getNoteGroupsByKey: () => Map<string, NoteGroup>
  openNoteInTab: (path: string, title?: string, options?: { initialNoteType: 'note' | 'task' }) => Promise<void>
  remapOpenNotePaths: (fromPath: string, toPath: string) => void
  emitMutation?: (event: AppMutationEvent) => Promise<void> | void
}

type ExplorerMutationWriter = {
  setMessage: (message: string) => void
  setError: (error: string) => void
  setCounts: (counts: VaultCounts) => void
  setNoteGroups: (groups: NoteGroup[]) => void
  setOpenTabs: (updater: SetStateAction<NoteTab[]>) => void
  setCustomTagGroups: (groups: TagGroupDefinition[]) => void
  setFolderOpen?: (folderKey: string) => void
}

const normalizePath = (value: string): string => value.replace(/\\/g, '/').replace(/\/+$/g, '')

export class ExplorerMutationService {
  private readonly context: ExplorerMutationContext
  private readonly writer: ExplorerMutationWriter

  constructor(context: ExplorerMutationContext, writer: ExplorerMutationWriter) {
    this.context = context
    this.writer = writer
  }

  private get backendUrl() {
    return this.context.getBackendUrl()
  }

  createExplorerFolder = async (parentGroupKey: string, groupName: string): Promise<void> => {
    const cleanGroupName = normalizeLabel(groupName)
    if (!cleanGroupName) {
      return
    }

    const effectiveParentKey = parentGroupKey && this.context.getNoteGroupsByKey().has(parentGroupKey) ? parentGroupKey : ''
    const targetGroup = this.context.getNoteGroupsByKey().get(effectiveParentKey)
    if (targetGroup?.canCreateGroups === false) {
      this.writer.setMessage('In diesem Ordner koennen keine neuen Unterordner angelegt werden.')
      return
    }

    try {
      this.writer.setError('')
      const response = await apiRequest<{ group: NoteGroup; groups: NoteGroup[] }>(
        this.backendUrl,
        '/note-groups/add-group',
        {
          method: 'POST',
          body: JSON.stringify({ groupName: cleanGroupName, parentKey: effectiveParentKey }),
        }
      )
      this.writer.setNoteGroups(response.groups)
      this.writer.setMessage(`Ordner angelegt: ${response.group.label}`)
      await this.context.emitMutation?.({
        kind: 'note-group-mutated',
        refresh: {
          search: true,
          noteGroups: true,
        },
        paths: [response.group.path],
      })
    } catch (caught) {
      this.writer.setError(String(caught))
    }
  }

  createExplorerFile = async (groupKey: string, title: string): Promise<void> => {
    const cleanTitle = normalizeLabel(title)
    if (!cleanTitle) {
      return
    }

    const effectiveGroupKey = groupKey && this.context.getNoteGroupsByKey().has(groupKey) ? groupKey : ''
    const targetGroup = this.context.getNoteGroupsByKey().get(effectiveGroupKey)
    if (targetGroup?.canCreateNotes === false) {
      this.writer.setMessage('In diesem Ordner koennen keine neuen Notizen angelegt werden.')
      return
    }

    try {
      this.writer.setError('')
      const response = await apiRequest<{ noteId: string; notePath: string; title?: string; groups: NoteGroup[]; counts: VaultCounts }>(
        this.backendUrl,
        '/note-groups/add-note',
        {
          method: 'POST',
          body: JSON.stringify({ groupKey: effectiveGroupKey, title: cleanTitle, noteType: 'note', status: 'open' }),
        }
      )
      this.writer.setCounts(response.counts)
      this.writer.setNoteGroups(response.groups)
      this.writer.setMessage(`Notiz erstellt (${response.noteId}).`)
      await this.context.emitMutation?.({
        kind: 'note-created',
        noteType: 'note',
        refresh: {
          search: true,
          tasks: true,
          todos: true,
          review: true,
          noteGroups: true,
          explorerSidebar: true,
        },
        paths: [response.notePath],
      })
      await this.context.openNoteInTab(response.notePath, response.title || cleanTitle, { initialNoteType: 'note' })
    } catch (caught) {
      this.writer.setError(String(caught))
    }
  }

  createExplorerTask = async (groupKey: string, title: string): Promise<void> => {
    const cleanTitle = normalizeLabel(title)
    if (!cleanTitle) {
      return
    }

    const effectiveGroupKey = groupKey && this.context.getNoteGroupsByKey().has(groupKey) ? groupKey : ''
    const targetGroup = this.context.getNoteGroupsByKey().get(effectiveGroupKey)
    if (targetGroup?.canCreateNotes === false) {
      this.writer.setMessage('In diesem Ordner koennen keine neuen Tasks angelegt werden.')
      return
    }

    try {
      this.writer.setError('')
      const response = await apiRequest<{ noteId: string; notePath: string; title?: string; groups: NoteGroup[]; counts: VaultCounts }>(
        this.backendUrl,
        '/note-groups/add-note',
        {
          method: 'POST',
          body: JSON.stringify({ groupKey: effectiveGroupKey, title: cleanTitle, noteType: 'task', status: 'open' }),
        }
      )
      this.writer.setCounts(response.counts)
      this.writer.setNoteGroups(response.groups)
      this.writer.setMessage(`Task erstellt (${response.noteId}).`)
      await this.context.emitMutation?.({
        kind: 'note-created',
        noteType: 'task',
        refresh: {
          search: true,
          tasks: true,
          todos: true,
          review: true,
          noteGroups: true,
          explorerSidebar: true,
        },
        paths: [response.notePath],
      })
      await this.context.openNoteInTab(response.notePath, response.title || cleanTitle, { initialNoteType: 'task' })
    } catch (caught) {
      this.writer.setError(String(caught))
    }
  }

  renameExplorerFolder = async (groupKey: string, newName: string): Promise<void> => {
    const cleanName = normalizeLabel(newName)
    const group = this.context.getNoteGroupsByKey().get(groupKey)
    if (!group || !cleanName || cleanName === group.label || group.canDelete === false) {
      return
    }

    try {
      this.writer.setError('')
      const response = await apiRequest<{
        group: NoteGroup
        groups: NoteGroup[]
        counts: VaultCounts
        linkRewrite?: { paths?: string[] }
      }>(
        this.backendUrl,
        '/note-groups/rename',
        {
          method: 'POST',
          body: JSON.stringify({ groupKey, newName: cleanName }),
        }
      )
      this.writer.setNoteGroups(response.groups)
      this.writer.setCounts(response.counts)
      this.context.remapOpenNotePaths(group.path, response.group.path)
      this.writer.setMessage(`Ordner umbenannt: ${response.group.label}`)
      await this.context.emitMutation?.({
        kind: 'note-group-mutated',
        refresh: {
          search: true,
          tasks: true,
          todos: true,
          review: true,
          noteGroups: true,
          explorerSidebar: true,
        },
        paths: response.linkRewrite?.paths ?? [group.path, response.group.path],
      })
    } catch (caught) {
      this.writer.setError(String(caught))
    }
  }

  moveExplorerFolder = async (groupKey: string, targetParentKey: string): Promise<void> => {
    const sourceGroup = this.context.getNoteGroupsByKey().get(groupKey)
    if (!sourceGroup || sourceGroup.canDelete === false) {
      return
    }

    const targetParent = this.context.getNoteGroupsByKey().get(targetParentKey)
    if (targetParent?.canCreateGroups === false) {
      this.writer.setMessage('In diesen Zielordner kann nicht verschoben werden.')
      return
    }

    try {
      this.writer.setError('')
      const response = await apiRequest<{
        group: NoteGroup
        groups: NoteGroup[]
        counts: VaultCounts
        linkRewrite?: { paths?: string[] }
      }>(
        this.backendUrl,
        '/note-groups/move',
        {
          method: 'POST',
          body: JSON.stringify({ groupKey, targetParentKey }),
        }
      )
      this.writer.setNoteGroups(response.groups)
      this.writer.setCounts(response.counts)
      this.context.remapOpenNotePaths(sourceGroup.path, response.group.path)
      this.writer.setMessage(`Ordner verschoben: ${response.group.label}`)
      await this.context.emitMutation?.({
        kind: 'note-group-mutated',
        refresh: {
          search: true,
          tasks: true,
          todos: true,
          review: true,
          noteGroups: true,
          explorerSidebar: true,
        },
        paths: response.linkRewrite?.paths ?? [sourceGroup.path, response.group.path],
      })
    } catch (caught) {
      this.writer.setError(String(caught))
    }
  }

  deleteExplorerFolder = async (groupKey: string): Promise<void> => {
    const group = this.context.getNoteGroupsByKey().get(groupKey)
    if (!group || group.canDelete === false) {
      return
    }

    try {
      this.writer.setError('')
      const response = await apiRequest<{
        deleted: boolean
        groups: NoteGroup[]
        counts: VaultCounts
        linkRewrite?: { paths?: string[] }
      }>(
        this.backendUrl,
        '/note-groups/delete',
        {
          method: 'POST',
          body: JSON.stringify({ groupKey }),
        }
      )
      this.writer.setNoteGroups(response.groups)
      this.writer.setCounts(response.counts)
      const normalizedGroupPath = normalizePath(group.path).toLowerCase()
      this.writer.setOpenTabs((tabs) =>
        tabs.filter((tab) => {
          if (tab.kind !== 'note') {
            return true
          }
          const normalizedTabPath = normalizePath(tab.path).toLowerCase()
          return normalizedTabPath !== normalizedGroupPath && !normalizedTabPath.startsWith(`${normalizedGroupPath}/`)
        })
      )
      this.writer.setMessage(`Ordner geloescht: ${group.label}`)
      await this.context.emitMutation?.({
        kind: 'note-group-mutated',
        refresh: {
          search: true,
          tasks: true,
          todos: true,
          review: true,
          noteGroups: true,
          explorerSidebar: true,
        },
        paths: response.linkRewrite?.paths ?? [group.path],
      })
    } catch (caught) {
      this.writer.setError(String(caught))
    }
  }

  toggleFavoriteFolder = async (groupKey: string): Promise<void> => {
    const group = this.context.getNoteGroupsByKey().get(groupKey)
    if (!group) {
      return
    }
    if (group.favorite && isPermanentPinnedRootGroupKey(group.key)) {
      this.writer.setMessage('Die Ordner daily, tags und tasks sind immer fixiert.')
      return
    }

    try {
      this.writer.setError('')
      const endpoint = group.favorite ? '/note-groups/unfavorite' : '/note-groups/favorite'
      const response = await apiRequest<{ groups: NoteGroup[] }>(this.backendUrl, endpoint, {
        method: 'POST',
        body: JSON.stringify({ groupKey }),
      })
      this.writer.setNoteGroups(response.groups)
      this.writer.setMessage(group.favorite ? 'Fixierung aufgehoben.' : 'Ordner fixiert.')
    } catch (caught) {
      this.writer.setError(String(caught))
    }
  }

  renameExplorerFile = async (path: string, newName: string): Promise<void> => {
    const cleanName = normalizeLabel(newName)
    if (!cleanName) {
      return
    }

    try {
      this.writer.setError('')
      const response = await apiRequest<{ renamedPath: string; counts: VaultCounts; linkRewrite?: { paths?: string[] } }>(
        this.backendUrl,
        '/notes/rename',
        {
          method: 'POST',
          body: JSON.stringify({ path, newName: cleanName }),
        }
      )
      this.writer.setCounts(response.counts)
      this.context.remapOpenNotePaths(path, response.renamedPath)
      this.writer.setMessage(`Datei umbenannt: ${toNoteDisplayName(response.renamedPath)}`)
      await this.context.emitMutation?.({
        kind: 'note-renamed',
        refresh: {
          search: true,
          tasks: true,
          todos: true,
          review: true,
          noteGroups: true,
          explorerSidebar: true,
        },
        paths: [path, response.renamedPath, ...(response.linkRewrite?.paths ?? [])],
      })
    } catch (caught) {
      this.writer.setError(String(caught))
    }
  }

  moveExplorerFiles = async (paths: string[], targetGroupKey: string): Promise<void> => {
    const uniquePaths = Array.from(new Set(paths.map((item) => String(item ?? '').trim()).filter(Boolean)))
    if (uniquePaths.length === 0) {
      return
    }

    const applyMoveResult = (
      movedEntries: { fromPath: string; movedPath: string }[],
      counts: VaultCounts,
      fallbackUsed = false
    ) => {
      this.writer.setCounts(counts)

      const moveMap = new Map<string, string>()
      const changedTargets: string[] = []
      for (const entry of movedEntries) {
        const fromPath = normalizePath(String(entry?.fromPath ?? ''))
        const movedPath = normalizePath(String(entry?.movedPath ?? ''))
        if (!fromPath || !movedPath) {
          continue
        }
        moveMap.set(fromPath.toLowerCase(), movedPath)
        if (fromPath.toLowerCase() !== movedPath.toLowerCase()) {
          changedTargets.push(movedPath)
        }
      }

      if (moveMap.size > 0) {
        this.writer.setOpenTabs((tabs) =>
          tabs.map((tab) => {
            if (tab.kind !== 'note') {
              return tab
            }
            const key = normalizePath(tab.path).toLowerCase()
            const nextPath = moveMap.get(key)
            if (!nextPath || nextPath === tab.path) {
              return tab
            }
            return {
              ...tab,
              path: nextPath,
              title: toNoteDisplayName(nextPath),
            }
          })
        )
      }

      if (changedTargets.length === 1) {
        this.writer.setMessage(`Datei verschoben: ${toNoteDisplayName(changedTargets[0])}`)
      } else if (changedTargets.length > 1) {
        this.writer.setMessage(`Dateien verschoben: ${changedTargets.length}${fallbackUsed ? ' (Fallback)' : ''}`)
      } else {
        this.writer.setMessage('Keine Dateien verschoben.')
      }
    }

    try {
      this.writer.setError('')
      const response = await apiRequest<
        { movedPaths: { fromPath: string; movedPath: string }[]; counts: VaultCounts; linkRewrite?: { paths?: string[] } }
      >(this.backendUrl, '/notes/move-batch', {
        method: 'POST',
        body: JSON.stringify({ paths: uniquePaths, targetGroupKey }),
      })
      applyMoveResult(Array.isArray(response.movedPaths) ? response.movedPaths : [], response.counts)
      await this.context.emitMutation?.({
        kind: 'note-moved',
        refresh: {
          search: true,
          tasks: true,
          todos: true,
          review: true,
          noteGroups: true,
          explorerSidebar: true,
        },
        paths: [
          ...uniquePaths,
          ...(response.linkRewrite?.paths ?? []),
          ...(Array.isArray(response.movedPaths)
            ? response.movedPaths.flatMap((item) => [item.fromPath, item.movedPath]).filter(Boolean)
            : []),
        ],
      })
      return
    } catch {
      try {
        const movedEntries: { fromPath: string; movedPath: string }[] = []
        let latestCounts: VaultCounts | null = null

        for (const path of uniquePaths) {
          const response = await apiRequest<{ movedPath: string; counts: VaultCounts; linkRewrite?: { paths?: string[] } }>(
            this.backendUrl,
            '/notes/move',
            {
              method: 'POST',
              body: JSON.stringify({ path, targetGroupKey }),
            }
          )
          latestCounts = response.counts
          movedEntries.push({
            fromPath: path,
            movedPath: response.movedPath,
          })
        }

        if (latestCounts) {
          applyMoveResult(movedEntries, latestCounts, true)
        }
        await this.context.emitMutation?.({
          kind: 'note-moved',
          refresh: {
            search: true,
            tasks: true,
            todos: true,
            review: true,
            noteGroups: true,
            explorerSidebar: true,
          },
          paths: [...uniquePaths, ...movedEntries.flatMap((item) => [item.fromPath, item.movedPath])],
        })
      } catch (caught) {
        this.writer.setError(String(caught))
      }
    }
  }

  moveExplorerFile = async (path: string, targetGroupKey: string): Promise<void> => {
    await this.moveExplorerFiles([path], targetGroupKey)
  }

  deleteExplorerFile = async (path: string): Promise<void> => {
    try {
      this.writer.setError('')
      const response = await apiRequest<{ deleted: boolean; counts: VaultCounts; linkRewrite?: { paths?: string[] } }>(
        this.backendUrl,
        '/notes/delete',
        {
          method: 'POST',
          body: JSON.stringify({ path }),
        }
      )
      this.writer.setCounts(response.counts)
      this.writer.setOpenTabs((tabs) => tabs.filter((tab) => tab.path !== path))
      this.writer.setMessage(`Datei geloescht: ${toNoteDisplayName(path)}`)
      await this.context.emitMutation?.({
        kind: 'note-deleted',
        refresh: {
          search: true,
          tasks: true,
          todos: true,
          review: true,
          noteGroups: true,
          explorerSidebar: true,
        },
        paths: [path, ...(response.linkRewrite?.paths ?? [])],
      })
    } catch (caught) {
      this.writer.setError(String(caught))
    }
  }
}
