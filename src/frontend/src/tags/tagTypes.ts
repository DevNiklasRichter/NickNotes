export type TagDefinition = {
  id: string
  displayName: string
}

export type TagGroupDefinition = {
  id: string
  displayName: string
  color: string
  tags: TagDefinition[]
}

export type TagLookupTag = TagDefinition & {
  idLower: string
}

export type TagLookupGroup = TagGroupDefinition & {
  idLower: string
  tagsByIdLower: Map<string, TagLookupTag>
}

export type TagLookup = {
  groups: TagLookupGroup[]
  groupsByIdLower: Map<string, TagLookupGroup>
}

const FALLBACK_COLOR = '#4f8cff'

function normalizeLabel(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

export function normalizeTagCandidate(raw: string): string {
  const cleanRaw = normalizeLabel(raw).replace(/^\{tag:/i, '').replace(/\}$/g, '').replace(/^#+/, '')
  if (!cleanRaw) {
    return ''
  }
  const delimiter = cleanRaw.includes(':') ? ':' : cleanRaw.includes('/') ? '/' : ''
  if (delimiter) {
    const [groupRaw, tagRaw] = cleanRaw.split(delimiter, 2)
    const group = normalizeTagId(groupRaw)
    const tag = normalizeTagId(tagRaw)
    if (!group || !tag) {
      return ''
    }
    return `${group}:${tag}`
  }
  const topic = normalizeTagId(cleanRaw)
  return topic ? `topic:${topic}` : ''
}

export function normalizeTagId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function normalizeTagColor(value: string): string {
  const input = value.trim()
  const shortHex = /^#[0-9a-fA-F]{3}$/
  const longHex = /^#[0-9a-fA-F]{6}$/
  if (shortHex.test(input) || longHex.test(input)) {
    return input.toLowerCase()
  }
  return FALLBACK_COLOR
}

function normalizeTagEntry(value: unknown): TagDefinition | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const candidate = value as Record<string, unknown>
  const rawId = typeof candidate.id === 'string' ? candidate.id : ''
  const id = normalizeTagId(rawId)
  if (!id) {
    return null
  }
  const displayNameRaw = typeof candidate.displayName === 'string' ? candidate.displayName : ''
  const displayName = normalizeLabel(displayNameRaw) || id
  return { id, displayName }
}

function normalizeGroupEntry(value: unknown): TagGroupDefinition | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const candidate = value as Record<string, unknown>
  const rawId = typeof candidate.id === 'string' ? candidate.id : ''
  const id = normalizeTagId(rawId)
  if (!id) {
    return null
  }

  const displayNameRaw = typeof candidate.displayName === 'string' ? candidate.displayName : ''
  const displayName = normalizeLabel(displayNameRaw) || id
  const color = normalizeTagColor(typeof candidate.color === 'string' ? candidate.color : '')
  const tagsSource = Array.isArray(candidate.tags) ? candidate.tags : []
  const tagsById = new Map<string, TagDefinition>()

  for (const rawTag of tagsSource) {
    const tag = normalizeTagEntry(rawTag)
    if (!tag) {
      continue
    }
    const existing = tagsById.get(tag.id)
    if (!existing || existing.displayName === existing.id) {
      tagsById.set(tag.id, tag)
    }
  }

  const tags = Array.from(tagsById.values()).sort((left, right) =>
    left.displayName.localeCompare(right.displayName, 'de')
  )

  return { id, displayName, color, tags }
}

function normalizeLegacyGroups(value: Record<string, unknown>): TagGroupDefinition[] {
  const groupsById = new Map<string, TagGroupDefinition>()

  for (const [rawGroupName, rawTags] of Object.entries(value)) {
    if (!Array.isArray(rawTags)) {
      continue
    }
    const id = normalizeTagId(rawGroupName)
    if (!id) {
      continue
    }

    const existing = groupsById.get(id)
    const tagsById = new Map<string, TagDefinition>()
    if (existing) {
      for (const tag of existing.tags) {
        tagsById.set(tag.id, tag)
      }
    }

    for (const rawTag of rawTags) {
      if (typeof rawTag !== 'string') {
        continue
      }
      const cleanDisplay = normalizeLabel(rawTag)
      const tagId = normalizeTagId(cleanDisplay)
      if (!tagId) {
        continue
      }
      if (!tagsById.has(tagId)) {
        tagsById.set(tagId, { id: tagId, displayName: cleanDisplay || tagId })
      }
    }

    groupsById.set(id, {
      id,
      displayName: normalizeLabel(rawGroupName) || id,
      color: FALLBACK_COLOR,
      tags: Array.from(tagsById.values()).sort((left, right) => left.displayName.localeCompare(right.displayName, 'de')),
    })
  }

  return Array.from(groupsById.values()).sort((left, right) => left.displayName.localeCompare(right.displayName, 'de'))
}

export function normalizeTagGroups(value: unknown): TagGroupDefinition[] {
  if (!value || typeof value !== 'object') {
    return []
  }

  const candidate = value as Record<string, unknown>
  const rawGroups = Array.isArray(candidate.tagGroups)
    ? candidate.tagGroups
    : Array.isArray(candidate.groups)
      ? candidate.groups
      : Array.isArray(value)
        ? (value as unknown[])
        : null

  if (rawGroups) {
    const groupsById = new Map<string, TagGroupDefinition>()
    for (const rawGroup of rawGroups) {
      const group = normalizeGroupEntry(rawGroup)
      if (!group) {
        continue
      }
      const existing = groupsById.get(group.id)
      if (!existing) {
        groupsById.set(group.id, group)
        continue
      }
      const tagsById = new Map<string, TagDefinition>()
      for (const tag of existing.tags) {
        tagsById.set(tag.id, tag)
      }
      for (const tag of group.tags) {
        const current = tagsById.get(tag.id)
        if (!current || current.displayName === current.id) {
          tagsById.set(tag.id, tag)
        }
      }
      groupsById.set(group.id, {
        id: group.id,
        displayName: group.displayName || existing.displayName,
        color: group.color || existing.color,
        tags: Array.from(tagsById.values()).sort((left, right) => left.displayName.localeCompare(right.displayName, 'de')),
      })
    }

    return Array.from(groupsById.values()).sort((left, right) => left.displayName.localeCompare(right.displayName, 'de'))
  }

  return normalizeLegacyGroups(candidate)
}

export function buildTagLookup(groups: TagGroupDefinition[]): TagLookup {
  const groupsByIdLower = new Map<string, TagLookupGroup>()
  const resolvedGroups = groups.map<TagLookupGroup>((group) => {
    const tagsByIdLower = new Map<string, TagLookupTag>()
    const resolvedTags = group.tags.map<TagLookupTag>((tag) => ({
      ...tag,
      idLower: tag.id.toLowerCase(),
    }))
    for (const tag of resolvedTags) {
      tagsByIdLower.set(tag.idLower, tag)
    }
    const resolvedGroup: TagLookupGroup = {
      ...group,
      idLower: group.id.toLowerCase(),
      tagsByIdLower,
    }
    groupsByIdLower.set(resolvedGroup.idLower, resolvedGroup)
    return resolvedGroup
  })

  return {
    groups: resolvedGroups,
    groupsByIdLower,
  }
}

export function findTagDefinition(
  lookup: TagLookup,
  groupId: string,
  tagId: string
): { group: TagLookupGroup; tag: TagLookupTag } | null {
  const group = lookup.groupsByIdLower.get(groupId.toLowerCase())
  if (!group) {
    return null
  }
  const tag = group.tagsByIdLower.get(tagId.toLowerCase())
  if (!tag) {
    return null
  }
  return { group, tag }
}
