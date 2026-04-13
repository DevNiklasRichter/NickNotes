export type NoteType = 'note' | 'task'
export type TaskStatus = 'new_topic' | 'open' | 'in_progress' | 'done'

export type NoteFrontmatter = {
  id: string
  node_id: string
  title: string
  type: NoteType
  status: TaskStatus
  created_at: string
  updated_at: string
  tags: string[]
  tags_auto: string[]
  related: string[]
  related_auto: string[]
  extra: Record<string, unknown>
}

export type ParsedNoteDocument = {
  frontmatter: NoteFrontmatter
  body: string
  hadFrontmatter: boolean
}

const INLINE_TAG_PATTERN = /\{tag:([A-Za-z0-9][A-Za-z0-9_-]*)\/([A-Za-z0-9][A-Za-z0-9_-]*)\}/g
const HASHTAG_PATTERN = /(^|\s)#([A-Za-z0-9][A-Za-z0-9_/-]{1,60})/g
const WIKILINK_PATTERN = /\[\[([^[\]\n]+)\]\]/g
const TITLE_HEADING_PATTERN = /^\s{0,3}#\s+(.+?)\s*$/
const TASK_STATUS_VALUES: TaskStatus[] = ['new_topic', 'open', 'in_progress', 'done']
const KNOWN_KEYS = new Set([
  'id',
  'node_id',
  'title',
  'type',
  'status',
  'created_at',
  'updated_at',
  'tags',
  'tags_auto',
  'related',
  'related_auto',
])

function normalizeLabel(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

function slugify(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function normalizeTagKey(raw: string): string {
  const clean = normalizeLabel(raw).replace(/^#+/, '')
  if (!clean) {
    return ''
  }
  if (clean.includes(':')) {
    const [groupRaw, tagRaw] = clean.split(':', 2)
    const group = slugify(groupRaw)
    const tag = slugify(tagRaw)
    return group && tag ? `${group}:${tag}` : ''
  }
  if (clean.includes('/')) {
    const [groupRaw, tagRaw] = clean.split('/', 2)
    const group = slugify(groupRaw)
    const tag = slugify(tagRaw)
    return group && tag ? `${group}:${tag}` : ''
  }
  const slug = slugify(clean)
  return slug ? `topic:${slug}` : ''
}

function ensureListOfStrings(value: unknown): string[] {
  if (typeof value === 'string') {
    return value.trim() ? [value.trim()] : []
  }
  if (!Array.isArray(value)) {
    return []
  }
  return value
    .map((item) => String(item ?? '').trim())
    .filter(Boolean)
}

function nowIso(): string {
  return new Date().toISOString().slice(0, 19)
}

function createNodeId(noteType: NoteType): string {
  const prefix = noteType === 'task' ? 'tk' : 'nt'
  const randomPart = Math.random().toString(16).slice(2, 6)
  const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
  return `${prefix}_${ts}_${randomPart}`
}

function normalizeType(raw: unknown): NoteType {
  const clean = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[- ]+/g, '_')
  return clean === 'task' ? 'task' : 'note'
}

function normalizeStatus(raw: unknown): TaskStatus {
  const clean = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[- ]+/g, '_') as TaskStatus
  return TASK_STATUS_VALUES.includes(clean) ? clean : 'open'
}

function extractTitleFromBody(body: string): string {
  for (const line of body.split('\n')) {
    const heading = TITLE_HEADING_PATTERN.exec(line)
    if (heading) {
      return normalizeLabel(heading[1] || '')
    }
    const stripped = line.trim()
    if (stripped) {
      return normalizeLabel(stripped.slice(0, 120))
    }
  }
  return ''
}

function stripMatchingTitleHeading(body: string, title: string): string {
  const lines = body.split('\n')
  if (lines.length === 0) {
    return body
  }
  const heading = TITLE_HEADING_PATTERN.exec(lines[0] || '')
  if (!heading) {
    return body
  }
  if (normalizeLabel(heading[1] || '').toLowerCase() !== normalizeLabel(title).toLowerCase()) {
    return body
  }
  return lines.slice(1).join('\n').replace(/^\n+/, '')
}

export function extractAutoTags(body: string): string[] {
  const found = new Set<string>()

  INLINE_TAG_PATTERN.lastIndex = 0
  let inlineMatch = INLINE_TAG_PATTERN.exec(body)
  while (inlineMatch) {
    const key = normalizeTagKey(`${inlineMatch[1] || ''}:${inlineMatch[2] || ''}`)
    if (key) {
      found.add(key)
    }
    inlineMatch = INLINE_TAG_PATTERN.exec(body)
  }

  HASHTAG_PATTERN.lastIndex = 0
  let hashtagMatch = HASHTAG_PATTERN.exec(body)
  while (hashtagMatch) {
    const key = normalizeTagKey(hashtagMatch[2] || '')
    if (key) {
      found.add(key)
    }
    hashtagMatch = HASHTAG_PATTERN.exec(body)
  }

  return Array.from(found).sort((a, b) => a.localeCompare(b))
}

export function extractRelatedLinks(body: string): string[] {
  const found = new Set<string>()
  WIKILINK_PATTERN.lastIndex = 0
  let match = WIKILINK_PATTERN.exec(body)
  while (match) {
    const raw = (match[1] || '').trim()
    const target = raw.split('|', 1)[0]?.trim() || ''
    const withoutHeading = target.split('#', 1)[0]?.trim() || ''
    const clean = withoutHeading.replace(/\\/g, '/').replace(/\.md$/i, '')
    if (clean) {
      found.add(clean)
    }
    match = WIKILINK_PATTERN.exec(body)
  }
  return Array.from(found).sort((a, b) => a.localeCompare(b))
}

function parseFrontmatter(text: string): { frontmatter: Record<string, unknown>; body: string; hadFrontmatter: boolean } {
  if (!text.startsWith('---\n')) {
    return { frontmatter: {}, body: text, hadFrontmatter: false }
  }
  const lines = text.split('\n')
  const frontmatter: Record<string, unknown> = {}
  let currentListKey: string | null = null
  let endIndex = -1

  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    if (line.trim() === '---') {
      endIndex = index
      break
    }
    if (line.startsWith('  - ') && currentListKey) {
      const current = frontmatter[currentListKey]
      if (Array.isArray(current)) {
        current.push(line.slice(4).trim())
      } else {
        frontmatter[currentListKey] = [line.slice(4).trim()]
      }
      continue
    }
    const separatorIndex = line.indexOf(':')
    if (separatorIndex < 0) {
      continue
    }
    const key = line.slice(0, separatorIndex).trim()
    const value = line.slice(separatorIndex + 1).trim()
    if (!key) {
      continue
    }
    if (!value) {
      frontmatter[key] = []
      currentListKey = key
    } else {
      frontmatter[key] = value
      currentListKey = null
    }
  }

  if (endIndex < 0) {
    return { frontmatter: {}, body: text, hadFrontmatter: false }
  }

  const body = lines.slice(endIndex + 1).join('\n').replace(/^\n+/, '')
  return { frontmatter, body, hadFrontmatter: true }
}

function toFrontmatterLines(frontmatter: Record<string, unknown>): string[] {
  const lines: string[] = ['---']
  for (const [key, rawValue] of Object.entries(frontmatter)) {
    if (Array.isArray(rawValue)) {
      lines.push(`${key}:`)
      for (const item of rawValue) {
        lines.push(`  - ${String(item ?? '').trim()}`)
      }
      continue
    }
    lines.push(`${key}: ${String(rawValue ?? '').trim()}`)
  }
  lines.push('---')
  lines.push('')
  return lines
}

export function parseNoteDocument(text: string, fallbackTitle: string): ParsedNoteDocument {
  const parsed = parseFrontmatter(text)
  const rawFrontmatter = parsed.frontmatter
  const noteType = normalizeType(rawFrontmatter.type)
  const createdAt = String(rawFrontmatter.created_at || '').trim() || nowIso()
  const explicitTitle = normalizeLabel(String(rawFrontmatter.title || ''))
  const bodyTitle = extractTitleFromBody(parsed.body)
  const nextTitle = explicitTitle || bodyTitle || normalizeLabel(fallbackTitle) || 'New Note'
  const nextBody = stripMatchingTitleHeading(parsed.body, nextTitle)

  const id = String(rawFrontmatter.id || '').trim() || createNodeId(noteType)
  const nodeId = String(rawFrontmatter.node_id || '').trim() || id
  const status = noteType === 'task' ? normalizeStatus(rawFrontmatter.status) : 'open'
  const tags = Array.from(new Set(ensureListOfStrings(rawFrontmatter.tags).map(normalizeTagKey).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b)
  )
  const related = Array.from(
    new Set(
      ensureListOfStrings(rawFrontmatter.related)
        .map((item) => item.replace(/\\/g, '/').replace(/\.md$/i, '').trim())
        .filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b))
  const tagsAuto = extractAutoTags(nextBody)
  const relatedAuto = extractRelatedLinks(nextBody)

  const extra: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(rawFrontmatter)) {
    if (!KNOWN_KEYS.has(key)) {
      extra[key] = value
    }
  }

  return {
    hadFrontmatter: parsed.hadFrontmatter,
    body: nextBody,
    frontmatter: {
      id,
      node_id: nodeId,
      title: nextTitle,
      type: noteType,
      status,
      created_at: createdAt,
      updated_at: String(rawFrontmatter.updated_at || '').trim() || createdAt,
      tags,
      tags_auto: tagsAuto,
      related,
      related_auto: relatedAuto,
      extra,
    },
  }
}

export function serializeNoteDocument(document: ParsedNoteDocument): string {
  const frontmatter: Record<string, unknown> = {
    id: document.frontmatter.id,
    node_id: document.frontmatter.node_id,
    title: document.frontmatter.title,
    type: document.frontmatter.type,
    created_at: document.frontmatter.created_at,
    updated_at: document.frontmatter.updated_at,
    tags: document.frontmatter.tags,
    tags_auto: extractAutoTags(document.body),
    related: document.frontmatter.related,
    related_auto: extractRelatedLinks(document.body),
  }

  if (document.frontmatter.type === 'task') {
    frontmatter.status = document.frontmatter.status
  }
  for (const [key, value] of Object.entries(document.frontmatter.extra || {})) {
    if (!KNOWN_KEYS.has(key)) {
      frontmatter[key] = value
    }
  }

  const lines = toFrontmatterLines(frontmatter)
  lines.push(document.body.replace(/\s+$/g, ''))
  lines.push('')
  return lines.join('\n')
}

export function parseCommaSeparated(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

export function toCommaSeparated(values: string[]): string {
  return values.join(', ')
}
