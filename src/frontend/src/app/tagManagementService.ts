import {
  apiRequest,
  normalizeLabel,
  toStorageTagGroups,
  type VaultCounts,
} from '../app/AppShared'
import type { AppMutationEvent } from './mutationEvents'
import type { TagActionDialogAction, TagFormValues, TagGroupFormValues } from '../tags/TagActionDialogModal'
import { normalizeTagColor, normalizeTagId, type TagGroupDefinition } from '../tags/tagTypes'

type TagManagementContext = {
  getBackendUrl: () => string
  getMergedTagGroups: () => TagGroupDefinition[]
  getMergedTagGroupsById: () => Map<string, TagGroupDefinition>
  openTagGroupFormDialog: (config: {
    title: string
    message?: string
    confirmLabel: string
    initialValues: TagGroupFormValues
    colorOnly?: boolean
  }) => Promise<TagGroupFormValues | null>
  openTagFormDialog: (config: {
    title: string
    message?: string
    confirmLabel: string
    initialValues: TagFormValues
    tagGroupOptions?: Array<{ id: string; displayName: string }>
  }) => Promise<TagFormValues | null>
  askTagChoice: (title: string, message: string, actions: TagActionDialogAction[]) => Promise<string | null>
  emitMutation?: (event: AppMutationEvent) => Promise<void> | void
}

type TagManagementWriter = {
  setMessage: (message: string) => void
  setError: (error: string) => void
  setCounts: (counts: VaultCounts) => void
  setCustomTagGroups: (groups: TagGroupDefinition[]) => void
  setFolderOpen?: (folderKey: string) => void
}

export class TagManagementService {
  private readonly context: TagManagementContext
  private readonly writer: TagManagementWriter

  constructor(context: TagManagementContext, writer: TagManagementWriter) {
    this.context = context
    this.writer = writer
  }

  private get backendUrl() {
    return this.context.getBackendUrl()
  }

  private resolveTagGroupById(groupId: string): TagGroupDefinition | null {
    const clean = normalizeTagId(groupId)
    if (!clean) {
      return null
    }
    return this.context.getMergedTagGroupsById().get(clean.toLowerCase()) ?? null
  }

  createTagGroup = async (): Promise<void> => {
    const form = await this.context.openTagGroupFormDialog({
      title: 'Neue Tag-Gruppe',
      confirmLabel: 'Anlegen',
      initialValues: {
        id: 'projekt',
        displayName: 'Projekte',
        color: '#2f8cff',
      },
    })
    if (!form) {
      return
    }

    const nextGroupId = normalizeTagId(form.id)
    if (!nextGroupId) {
      this.writer.setMessage('Die Gruppen-ID ist ungueltig. Erlaubt sind Buchstaben, Zahlen und Bindestriche.')
      return
    }

    const duplicate = this.resolveTagGroupById(nextGroupId)
    if (duplicate) {
      this.writer.setMessage(`Die Tag-Gruppe "${duplicate.displayName}" (${duplicate.id}) existiert bereits.`)
      return
    }

    try {
      this.writer.setError('')
      const response = await apiRequest<{ groups: unknown }>(this.backendUrl, '/tag-groups/add-group', {
        method: 'POST',
        body: JSON.stringify({
          groupId: nextGroupId,
          displayName: normalizeLabel(form.displayName) || nextGroupId,
          color: normalizeTagColor(form.color),
        }),
      })
      this.writer.setCustomTagGroups(toStorageTagGroups(response.groups))
      this.writer.setFolderOpen?.(`tag-group-${nextGroupId}`)
      this.writer.setMessage(`Tag-Gruppe angelegt: ${form.displayName || nextGroupId}`)
      void this.context.emitMutation?.({
        kind: 'tag-mutated',
        refresh: {
          search: true,
          review: true,
          explorerSidebar: true,
        },
      })
    } catch (caught) {
      this.writer.setError(String(caught))
    }
  }

  createTagInExistingGroup = async (preferredGroup: string | null): Promise<void> => {
    const mergedTagGroups = this.context.getMergedTagGroups()
    if (mergedTagGroups.length === 0) {
      this.writer.setMessage('Lege zuerst eine Tag-Gruppe an.')
      return
    }

    const firstGroup = mergedTagGroups[0] ?? null
    const requestedGroup = preferredGroup ? this.resolveTagGroupById(preferredGroup) : null
    const group = requestedGroup || firstGroup
    if (!group) {
      this.writer.setMessage('Keine gueltige Tag-Gruppe gefunden.')
      return
    }

    const form = await this.context.openTagFormDialog({
      title: `Neuer Tag in "${group.displayName}"`,
      confirmLabel: 'Anlegen',
      initialValues: {
        id: 'neuer-tag',
        displayName: 'Neuer Tag',
      },
    })
    if (!form) {
      return
    }

    const tagId = normalizeTagId(form.id)
    if (!tagId) {
      this.writer.setMessage('Die Tag-ID ist ungueltig. Erlaubt sind Buchstaben, Zahlen und Bindestriche.')
      return
    }

    const duplicateTag = group.tags.find((entry) => entry.id.toLowerCase() === tagId.toLowerCase())
    if (duplicateTag) {
      this.writer.setMessage(`Der Tag "${duplicateTag.displayName}" (${duplicateTag.id}) existiert in "${group.displayName}" bereits.`)
      return
    }

    try {
      this.writer.setError('')
      const response = await apiRequest<{ groups: unknown }>(this.backendUrl, '/tag-groups/add-tag', {
        method: 'POST',
        body: JSON.stringify({
          groupId: group.id,
          tagId,
          displayName: normalizeLabel(form.displayName) || tagId,
        }),
      })
      this.writer.setCustomTagGroups(toStorageTagGroups(response.groups))
      this.writer.setFolderOpen?.(`tag-group-${group.id}`)
      this.writer.setMessage(`Tag hinzugefuegt: ${group.displayName} / ${form.displayName || tagId}`)
      void this.context.emitMutation?.({
        kind: 'tag-mutated',
        refresh: {
          search: true,
          review: true,
          explorerSidebar: true,
        },
      })
    } catch (caught) {
      this.writer.setError(String(caught))
    }
  }

  createTagFromEditorSelection = async (
    selectedText: string,
    replaceSelection: (tagSyntax: string) => void
  ): Promise<void> => {
    const displayName = normalizeLabel(selectedText)
    if (!displayName) {
      return
    }

    const mergedTagGroups = this.context.getMergedTagGroups()
    if (mergedTagGroups.length === 0) {
      this.writer.setMessage('Lege zuerst eine Tag-Gruppe an.')
      return
    }

    const firstGroup = mergedTagGroups[0]
    const form = await this.context.openTagFormDialog({
      title: 'Neuen Tag aus Auswahl erstellen',
      message: 'Waehle die Tag-Gruppe und pruefe ID sowie Anzeigename.',
      confirmLabel: 'Anlegen und einfuegen',
      initialValues: {
        groupId: firstGroup.id,
        id: normalizeTagId(displayName),
        displayName,
      },
      tagGroupOptions: mergedTagGroups.map((group) => ({ id: group.id, displayName: group.displayName })),
    })
    if (!form) {
      return
    }

    const creatingNewGroup = form.groupId === 'create-new-tag-group'
    const groupId = creatingNewGroup
      ? normalizeTagId(form.newGroupId || '')
      : normalizeTagId(form.groupId || firstGroup.id)

    const tagId = normalizeTagId(form.id)
    if (!tagId) {
      this.writer.setMessage('Die Tag-ID ist ungueltig. Erlaubt sind Buchstaben, Zahlen und Bindestriche.')
      return
    }

    const tagDisplayName = normalizeLabel(form.displayName) || displayName
    if (!groupId) {
      this.writer.setMessage('Die Gruppen-ID ist ungueltig. Erlaubt sind Buchstaben, Zahlen und Bindestriche.')
      return
    }

    const existingGroup = this.resolveTagGroupById(groupId)
    if (!creatingNewGroup && !existingGroup) {
      this.writer.setMessage(`Tag-Gruppe nicht gefunden: ${groupId}`)
      return
    }

    if (creatingNewGroup && existingGroup) {
      this.writer.setMessage(`Die Tag-Gruppe "${existingGroup.displayName}" (${existingGroup.id}) existiert bereits.`)
      return
    }

      const tagSyntax = `{tag:${groupId}/${tagId}}`
      const duplicateTag = existingGroup?.tags.find((entry) => entry.id.toLowerCase() === tagId.toLowerCase())
    if (duplicateTag && existingGroup) {
      replaceSelection(tagSyntax)
      this.writer.setMessage(`Bestehenden Tag eingefuegt: ${existingGroup.displayName} / ${duplicateTag.displayName}`)
      return
    }

    try {
      this.writer.setError('')
      let latestGroups: unknown = null
      let groupDisplayName = existingGroup?.displayName || normalizeLabel(form.newGroupDisplayName || '') || groupId

      if (creatingNewGroup) {
        const groupResponse = await apiRequest<{ groups: unknown }>(this.backendUrl, '/tag-groups/add-group', {
          method: 'POST',
          body: JSON.stringify({
            groupId,
            displayName: groupDisplayName,
            color: '#2f8cff',
          }),
        })
        latestGroups = groupResponse.groups
      }

      const response = await apiRequest<{ groups: unknown }>(this.backendUrl, '/tag-groups/add-tag', {
        method: 'POST',
        body: JSON.stringify({
          groupId,
          tagId,
          displayName: tagDisplayName,
        }),
      })
      latestGroups = response.groups ?? latestGroups
      const normalizedGroups = toStorageTagGroups(latestGroups)
      const createdGroup = normalizedGroups.find((item) => item.id.toLowerCase() === groupId.toLowerCase())
      groupDisplayName = createdGroup?.displayName || groupDisplayName
      this.writer.setCustomTagGroups(normalizedGroups)
      this.writer.setFolderOpen?.(`tag-group-${groupId}`)
      replaceSelection(tagSyntax)
      this.writer.setMessage(`Tag angelegt und eingefuegt: ${groupDisplayName} / ${tagDisplayName}`)
      void this.context.emitMutation?.({
        kind: 'tag-mutated',
        refresh: {
          search: true,
          review: true,
          explorerSidebar: true,
        },
      })
    } catch (caught) {
      this.writer.setError(String(caught))
    }
  }

  renameTagGroup = async (groupName: string): Promise<void> => {
    const group = this.resolveTagGroupById(groupName)
    if (!group) {
      this.writer.setMessage(`Tag-Gruppe nicht gefunden: ${groupName}`)
      return
    }

    const form = await this.context.openTagGroupFormDialog({
      title: `Tag-Gruppe bearbeiten (${group.displayName})`,
      confirmLabel: 'Speichern',
      initialValues: {
        id: group.id,
        displayName: group.displayName,
        color: group.color || '#2f8cff',
      },
    })
    if (!form) {
      return
    }

    const newGroupId = normalizeTagId(form.id)
    if (!newGroupId) {
      this.writer.setMessage('Die Gruppen-ID ist ungueltig. Erlaubt sind Buchstaben, Zahlen und Bindestriche.')
      return
    }

    const duplicateGroup = this.resolveTagGroupById(newGroupId)
    if (duplicateGroup && duplicateGroup.id.toLowerCase() !== group.id.toLowerCase()) {
      this.writer.setMessage(`Die Tag-Gruppe "${duplicateGroup.displayName}" (${duplicateGroup.id}) existiert bereits.`)
      return
    }

    const nextDisplayName = normalizeLabel(form.displayName) || newGroupId
    const newColor = normalizeTagColor(form.color)
    const idChanged = newGroupId.toLowerCase() !== group.id.toLowerCase()
    const displayChanged = normalizeLabel(nextDisplayName) !== group.displayName
    const colorChanged = newColor !== group.color
    if (!idChanged && !displayChanged && !colorChanged) {
      return
    }

    let applyToNotes = false
    if (idChanged) {
      const applyChoice = await this.context.askTagChoice(
        'Notiz-Tags mit umbenennen?',
        `Sollen bestehende Notiz-Tags von "${group.id}:*" automatisch auf "${newGroupId}:*" umgestellt werden?`,
        [
          { id: 'apply', label: 'Ja, in Notizen aktualisieren', tone: 'primary' },
          { id: 'keep', label: 'Nein, nur Verwaltung aendern' },
        ]
      )
      if (!applyChoice) {
        return
      }
      applyToNotes = applyChoice === 'apply'
    }

    try {
      this.writer.setError('')
      const response = await apiRequest<{ groups: unknown; notesUpdated: number; counts: VaultCounts }>(
        this.backendUrl,
        '/tag-groups/rename-group',
        {
          method: 'POST',
          body: JSON.stringify({
            groupId: group.id,
            newGroupId,
            newDisplayName: normalizeLabel(nextDisplayName) || newGroupId,
            newColor,
            applyToNotes,
          }),
        }
      )
      this.writer.setCustomTagGroups(toStorageTagGroups(response.groups))
      this.writer.setCounts(response.counts)
      this.writer.setFolderOpen?.(`tag-group-${newGroupId}`)
      if (idChanged && applyToNotes) {
        this.writer.setMessage(`Tag-Gruppe umbenannt und ${response.notesUpdated} Notizen aktualisiert.`)
      } else {
        this.writer.setMessage('Tag-Gruppe aktualisiert.')
      }
      void this.context.emitMutation?.({
        kind: 'tag-mutated',
        refresh: {
          search: true,
          todos: applyToNotes,
          tasks: applyToNotes,
          review: true,
          explorerSidebar: true,
        },
      })
    } catch (caught) {
      this.writer.setError(String(caught))
    }
  }

  setTagGroupColor = async (groupName: string): Promise<void> => {
    const group = this.resolveTagGroupById(groupName)
    if (!group) {
      this.writer.setMessage(`Tag-Gruppe nicht gefunden: ${groupName}`)
      return
    }

    const form = await this.context.openTagGroupFormDialog({
      title: `Farbe fuer "${group.displayName}"`,
      confirmLabel: 'Speichern',
      initialValues: {
        id: group.id,
        displayName: group.displayName,
        color: group.color || '#2f8cff',
      },
      colorOnly: true,
    })
    if (!form) {
      return
    }

    const newColor = normalizeTagColor(form.color)
    if (newColor === group.color) {
      return
    }

    try {
      this.writer.setError('')
      const response = await apiRequest<{ groups: unknown; notesUpdated: number; counts: VaultCounts }>(
        this.backendUrl,
        '/tag-groups/rename-group',
        {
          method: 'POST',
          body: JSON.stringify({
            groupId: group.id,
            newGroupId: group.id,
            newDisplayName: group.displayName,
            newColor,
            applyToNotes: false,
          }),
        }
      )
      this.writer.setCustomTagGroups(toStorageTagGroups(response.groups))
      this.writer.setCounts(response.counts)
      this.writer.setMessage(`Farbe aktualisiert: ${group.displayName}`)
      void this.context.emitMutation?.({
        kind: 'tag-mutated',
        refresh: {
          search: true,
          review: true,
          explorerSidebar: true,
        },
      })
    } catch (caught) {
      this.writer.setError(String(caught))
    }
  }

  deleteTagGroup = async (groupName: string): Promise<void> => {
    const group = this.resolveTagGroupById(groupName)
    const groupLabel = group ? `${group.displayName} (${group.id})` : groupName
    const option = await this.context.askTagChoice(
      `Tag-Gruppe "${groupLabel}" loeschen`,
      'Wie sollen vorhandene Tag-Verwendungen in Notizen behandelt werden?',
      [
        { id: 'remove', label: 'Auch aus Notizen entfernen', tone: 'danger' },
        { id: 'keep', label: 'Nur aus Tag-Verwaltung loeschen' },
      ]
    )
    if (!option) {
      return
    }

    const removeFromNotes = option === 'remove'
    try {
      this.writer.setError('')
      const response = await apiRequest<{ groups: unknown; notesUpdated: number; counts: VaultCounts }>(
        this.backendUrl,
        '/tag-groups/delete-group',
        {
          method: 'POST',
          body: JSON.stringify({ groupId: groupName, removeFromNotes }),
        }
      )
      this.writer.setCustomTagGroups(toStorageTagGroups(response.groups))
      this.writer.setCounts(response.counts)
      if (removeFromNotes) {
        this.writer.setMessage(`Tag-Gruppe geloescht und Tags aus ${response.notesUpdated} Notizen entfernt.`)
      } else {
        this.writer.setMessage('Tag-Gruppe aus der Tag-Verwaltung entfernt. Historische Notiz-Tags wurden beibehalten.')
      }
      void this.context.emitMutation?.({
        kind: 'tag-mutated',
        refresh: {
          search: true,
          todos: removeFromNotes,
          tasks: removeFromNotes,
          review: true,
          explorerSidebar: true,
        },
      })
    } catch (caught) {
      this.writer.setError(String(caught))
    }
  }

  renameTag = async (groupName: string, tagName: string): Promise<void> => {
    const group = this.resolveTagGroupById(groupName)
    if (!group) {
      this.writer.setMessage(`Tag-Gruppe nicht gefunden: ${groupName}`)
      return
    }

    const tag = group.tags.find((entry) => entry.id.toLowerCase() === tagName.toLowerCase())
    if (!tag) {
      this.writer.setMessage(`Tag nicht gefunden: ${groupName}/${tagName}`)
      return
    }

    const form = await this.context.openTagFormDialog({
      title: `Tag bearbeiten (${group.displayName} / ${tag.displayName})`,
      confirmLabel: 'Speichern',
      initialValues: {
        id: tag.id,
        displayName: tag.displayName,
      },
    })
    if (!form) {
      return
    }

    const newTagId = normalizeTagId(form.id)
    if (!newTagId) {
      this.writer.setMessage('Die Tag-ID ist ungueltig. Erlaubt sind Buchstaben, Zahlen und Bindestriche.')
      return
    }

    const duplicate = group.tags.find(
      (entry) => entry.id.toLowerCase() === newTagId.toLowerCase() && entry.id.toLowerCase() !== tag.id.toLowerCase()
    )
    if (duplicate) {
      this.writer.setMessage(`Der Tag "${duplicate.displayName}" (${duplicate.id}) existiert in "${group.displayName}" bereits.`)
      return
    }

    const nextDisplayName = normalizeLabel(form.displayName) || newTagId
    const idChanged = newTagId.toLowerCase() !== tag.id.toLowerCase()
    const displayChanged = normalizeLabel(nextDisplayName) !== tag.displayName
    if (!idChanged && !displayChanged) {
      return
    }

    let applyToNotes = false
    if (idChanged) {
      const applyChoice = await this.context.askTagChoice(
        'Notiz-Tags mit umbenennen?',
        `Soll "${group.id}:${tag.id}" in allen Notizen automatisch in "${group.id}:${newTagId}" umbenannt werden?`,
        [
          { id: 'apply', label: 'Ja, in Notizen aktualisieren', tone: 'primary' },
          { id: 'keep', label: 'Nein, nur Verwaltung aendern' },
        ]
      )
      if (!applyChoice) {
        return
      }
      applyToNotes = applyChoice === 'apply'
    }

    try {
      this.writer.setError('')
      const response = await apiRequest<{ groups: unknown; notesUpdated: number; counts: VaultCounts }>(
        this.backendUrl,
        '/tag-groups/rename-tag',
        {
          method: 'POST',
          body: JSON.stringify({
            groupId: group.id,
            tagId: tag.id,
            newTagId,
            newDisplayName: normalizeLabel(nextDisplayName) || newTagId,
            applyToNotes,
          }),
        }
      )
      this.writer.setCustomTagGroups(toStorageTagGroups(response.groups))
      this.writer.setCounts(response.counts)
      if (idChanged && applyToNotes) {
        this.writer.setMessage(`Tag umbenannt und ${response.notesUpdated} Notizen aktualisiert.`)
      } else {
        this.writer.setMessage('Tag aktualisiert.')
      }
      void this.context.emitMutation?.({
        kind: 'tag-mutated',
        refresh: {
          search: true,
          todos: applyToNotes,
          tasks: applyToNotes,
          review: true,
          explorerSidebar: true,
        },
      })
    } catch (caught) {
      this.writer.setError(String(caught))
    }
  }

  deleteTag = async (groupName: string, tagName: string): Promise<void> => {
    const group = this.resolveTagGroupById(groupName)
    const tag = group?.tags.find((entry) => entry.id.toLowerCase() === tagName.toLowerCase()) ?? null
    const tagLabel = tag && group ? `${group.displayName} / ${tag.displayName}` : `${groupName}:${tagName}`
    const option = await this.context.askTagChoice(
      `Tag "${tagLabel}" loeschen`,
      'Wie sollen vorhandene Tag-Verwendungen in Notizen behandelt werden?',
      [
        { id: 'remove', label: 'Auch aus Notizen entfernen', tone: 'danger' },
        { id: 'keep', label: 'Nur aus Tag-Verwaltung loeschen' },
      ]
    )
    if (!option) {
      return
    }

    const removeFromNotes = option === 'remove'
    try {
      this.writer.setError('')
      const response = await apiRequest<{ groups: unknown; notesUpdated: number; counts: VaultCounts }>(
        this.backendUrl,
        '/tag-groups/delete-tag',
        {
          method: 'POST',
          body: JSON.stringify({ groupId: groupName, tagId: tagName, removeFromNotes }),
        }
      )
      this.writer.setCustomTagGroups(toStorageTagGroups(response.groups))
      this.writer.setCounts(response.counts)
      if (removeFromNotes) {
        this.writer.setMessage(`Tag geloescht und aus ${response.notesUpdated} Notizen entfernt.`)
      } else {
        this.writer.setMessage('Tag aus der Tag-Verwaltung entfernt. Historische Notiz-Tags wurden beibehalten.')
      }
      void this.context.emitMutation?.({
        kind: 'tag-mutated',
        refresh: {
          search: true,
          todos: removeFromNotes,
          tasks: removeFromNotes,
          review: true,
          explorerSidebar: true,
        },
      })
    } catch (caught) {
      this.writer.setError(String(caught))
    }
  }
}
