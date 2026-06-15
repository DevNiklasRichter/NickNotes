import { normalizeTagCandidate } from '../tags/tagTypes'
import type { TaskPriority, TaskStatus } from '../shared/taskDomain'
export type { TaskPriority, TaskStatus } from '../shared/taskDomain'
import { normalizeTaskPriorityValue, normalizeTaskStatusValue } from '../shared/taskDomain'

export type NoteType = 'note' | 'task'

export type NoteFrontmatter = {
  id: string
  node_id: string
  title: string
  type: NoteType
  status: TaskStatus
  priority: TaskPriority
  due_date: string
  estimate_minutes: number | null
  completed_at: string
  blocked_by_ids: string[]
  waiting_for: string
  follow_up_date: string
  blocked_reason: string
  next_action_hint: string
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
const WIKILINK_PATTERN = /\[\[([^[\]\n]+)\]\]/g
const TITLE_HEADING_PATTERN = /^\s{0,3}#\s+(.+?)\s*$/
const KNOWN_KEYS = new Set([
  'id',
  'node_id',
  'title',
  'type',
  'status',
  'priority',
  'due_date',
  'estimate_minutes',
  'completed_at',
  'blocked_by_ids',
  'waiting_for',
  'follow_up_date',
  'blocked_reason',
  'next_action_hint',
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

function normalizeDueDate(raw: unknown): string {
  const clean = String(raw ?? '').trim()
  if (!clean) {
    return ''
  }
  return /^\d{4}-\d{2}-\d{2}$/.test(clean) ? clean : ''
}

function normalizeIsoTimestamp(raw: unknown): string {
  const clean = String(raw ?? '').trim()
  if (!clean) {
    return ''
  }
  const normalized = clean.endsWith('Z') ? `${clean.slice(0, -1)}+00:00` : clean
  const parsed = new Date(normalized)
  if (Number.isNaN(parsed.getTime())) {
    return ''
  }
  return parsed.toISOString().slice(0, 19)
}

function normalizeEstimateMinutes(raw: unknown): number | null {
  if (raw === null || raw === undefined || typeof raw === 'boolean') {
    return null
  }
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) {
      return null
    }
    const value = Math.trunc(raw)
    return value > 0 ? Math.min(value, 10000) : null
  }
  const clean = String(raw).trim()
  if (!clean) {
    return null
  }
  const parsed = Number.parseInt(clean, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null
  }
  return Math.min(parsed, 10000)
}

function normalizeOptionalText(raw: unknown): string {
  return normalizeLabel(String(raw ?? ''))
}

function normalizeBlockedByIds(raw: unknown): string[] {
  const normalized: string[] = []
  const seen = new Set<string>()
  for (const item of ensureListOfStrings(raw)) {
    const parts = item.includes(',') ? item.split(',') : [item]
    for (const part of parts) {
      const clean = part.trim()
      if (!clean) {
        continue
      }
      const key = clean.toLowerCase()
      if (seen.has(key)) {
        continue
      }
      seen.add(key)
      normalized.push(clean)
    }
  }
  return normalized
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
    const key = normalizeTagCandidate(`${inlineMatch[1] || ''}:${inlineMatch[2] || ''}`)
    if (key) {
      found.add(key)
    }
    inlineMatch = INLINE_TAG_PATTERN.exec(body)
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
  const normalizedText = text.replace(/^\uFEFF/, '')
  if (!normalizedText.startsWith('---\n')) {
    return { frontmatter: {}, body: normalizedText, hadFrontmatter: false }
  }
  const lines = normalizedText.split('\n')
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
    return { frontmatter: {}, body: normalizedText, hadFrontmatter: false }
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
  let rawFrontmatter = parsed.frontmatter
  let rawBody = parsed.body
  const nested = parseFrontmatter(rawBody.replace(/^\uFEFF/, ''))
  if (nested.hadFrontmatter) {
    const outerTitle = String(rawFrontmatter.title || '')
      .trim()
      .toLowerCase()
    const outerType = normalizeType(rawFrontmatter.type)
    const nestedType = normalizeType(nested.frontmatter.type)
    const suspiciousOuterTitle = outerTitle === '' || outerTitle === '---' || outerTitle === 'ï»¿---' || outerTitle === '\ufeff---'
    if (suspiciousOuterTitle || (outerType === 'note' && nestedType !== outerType)) {
      rawFrontmatter = nested.frontmatter
      rawBody = nested.body
    }
  }

  const noteType = normalizeType(rawFrontmatter.type)
  const createdAt = String(rawFrontmatter.created_at || '').trim() || nowIso()
  const hasExplicitTitle = Object.prototype.hasOwnProperty.call(rawFrontmatter, 'title')
  const explicitTitleRaw = String(rawFrontmatter.title ?? '')
  const explicitTitle = normalizeLabel(explicitTitleRaw)
  const keepBlankTitle = hasExplicitTitle && explicitTitleRaw.trim() === ''
  const bodyTitle = extractTitleFromBody(rawBody)
  const nextTitle = keepBlankTitle ? '' : explicitTitle || bodyTitle || normalizeLabel(fallbackTitle) || 'New Note'
  const nextBody = stripMatchingTitleHeading(rawBody, nextTitle)

  const id = String(rawFrontmatter.id || '').trim() || createNodeId(noteType)
  const nodeId = String(rawFrontmatter.node_id || '').trim() || id
  const status = normalizeTaskStatusValue(String(rawFrontmatter.status ?? ''))
  const priority = normalizeTaskPriorityValue(String(rawFrontmatter.priority ?? ''))
  const dueDate = normalizeDueDate(rawFrontmatter.due_date)
  const estimateMinutes = normalizeEstimateMinutes(rawFrontmatter.estimate_minutes)
  const rawCompletedAt = normalizeIsoTimestamp(rawFrontmatter.completed_at)
  const completedAt = status === 'done' ? rawCompletedAt : ''
  const blockedByIds = normalizeBlockedByIds(rawFrontmatter.blocked_by_ids)
  const waitingFor = normalizeOptionalText(rawFrontmatter.waiting_for)
  const followUpDate = normalizeDueDate(rawFrontmatter.follow_up_date)
  const blockedReason = normalizeOptionalText(rawFrontmatter.blocked_reason)
  const nextActionHint = normalizeOptionalText(rawFrontmatter.next_action_hint)
  const tags = Array.from(new Set(ensureListOfStrings(rawFrontmatter.tags).map(normalizeTagCandidate).filter(Boolean))).sort((a, b) =>
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
      priority,
      due_date: dueDate,
      estimate_minutes: estimateMinutes,
      completed_at: completedAt,
      blocked_by_ids: blockedByIds,
      waiting_for: waitingFor,
      follow_up_date: followUpDate,
      blocked_reason: blockedReason,
      next_action_hint: nextActionHint,
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

  frontmatter.status = document.frontmatter.status
  frontmatter.priority = document.frontmatter.priority
  frontmatter.due_date = document.frontmatter.due_date
  if (document.frontmatter.estimate_minutes && document.frontmatter.estimate_minutes > 0) {
    frontmatter.estimate_minutes = document.frontmatter.estimate_minutes
  }
  if (document.frontmatter.status === 'done' && document.frontmatter.completed_at) {
    frontmatter.completed_at = normalizeIsoTimestamp(document.frontmatter.completed_at)
  }
  if (document.frontmatter.blocked_by_ids.length > 0) {
    frontmatter.blocked_by_ids = document.frontmatter.blocked_by_ids
  }
  if (document.frontmatter.waiting_for) {
    frontmatter.waiting_for = document.frontmatter.waiting_for
  }
  if (document.frontmatter.follow_up_date) {
    frontmatter.follow_up_date = document.frontmatter.follow_up_date
  }
  if (document.frontmatter.blocked_reason) {
    frontmatter.blocked_reason = document.frontmatter.blocked_reason
  }
  if (document.frontmatter.next_action_hint) {
    frontmatter.next_action_hint = document.frontmatter.next_action_hint
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
