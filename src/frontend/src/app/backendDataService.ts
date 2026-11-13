import type {
  FocusDashboardAggregateStats,
  FocusDashboardAggregateResponse,
  NoteGroup,
  ReviewDashboardFilters,
  ReviewDashboardResponse,
  SearchRow,
  TaskRow,
  TodoRow,
  VaultCounts,
} from '../app/AppShared'
import type { TagGroupDefinition } from '../tags/tagTypes'
import { apiRequest, normalizeFilePathKey, toLocalIsoDate, toStorageTagGroups } from '../app/AppShared'

type ReviewWindow = ReviewDashboardFilters['window']

export const toReviewWindowDays = (windowValue: ReviewWindow): number => {
  if (windowValue === 'today') {
    return 1
  }
  if (windowValue === '7d') {
    return 7
  }
  if (windowValue === '90d') {
    return 90
  }
  return 30
}

type BackendStateWriter = {
  setTasks: (tasks: TaskRow[]) => void
  setTodos: (todos: TodoRow[]) => void
  setExplorerFiles: (files: SearchRow[]) => void
  setSearchResults: (rows: SearchRow[]) => void
  setAllNotes: (rows: SearchRow[]) => void
  setReviewDashboardData: (data: ReviewDashboardResponse | null) => void
  setFocusDashboardStats: (stats: FocusDashboardAggregateStats) => void
  setCounts: (counts: VaultCounts) => void
  setFocusMitIds: (ids: string[]) => void
  setCustomTagGroups: (groups: TagGroupDefinition[]) => void
  setNoteGroups: (groups: NoteGroup[]) => void
  setError: (message: string) => void
}

export class BackendDataService {
  private searchRequest = 0
  private readonly context: {
    getBackendUrl: () => string
    isVaultLoaded: () => boolean
    getReviewWindow: () => ReviewWindow
  }

  private readonly writers: BackendStateWriter

  constructor(context: BackendDataService['context'], writers: BackendStateWriter) {
    this.context = context
    this.writers = writers
  }

  private get backendUrl(): string {
    return this.context.getBackendUrl()
  }

  private canLoad(force: boolean): boolean {
    return force || this.context.isVaultLoaded()
  }

  private mapSearchRowsForPathMatch(rows: SearchRow[]): Set<string> {
    const next = new Set<string>()
    for (const row of rows) {
      if (!row.path) {
        continue
      }
      next.add(normalizeFilePathKey(row.path.replace(/\/+$/g, '')))
    }
    return next
  }

  async refreshTasks(force = false): Promise<void> {
    if (!this.canLoad(force)) {
      return
    }

    const response = await apiRequest<{ items: TaskRow[] }>(this.backendUrl, '/tasks?include_done=true')
    this.writers.setTasks(response.items)
  }

  async refreshTodos(force = false): Promise<void> {
    if (!this.canLoad(force)) {
      return
    }

    const response = await apiRequest<{ items: TodoRow[] }>(this.backendUrl, '/todos')
    this.writers.setTodos(response.items)
  }

  async refreshExplorerFiles(force = false): Promise<void> {
    if (!this.canLoad(force)) {
      return
    }

    try {
      const response = await apiRequest<{ items: SearchRow[] }>(this.backendUrl, '/explorer/files')
      this.writers.setExplorerFiles(response.items)
    } catch {
      // Fallback: Explorer can still render indexed rows.
    }
  }

  async runSearch(query: string, force = false): Promise<void> {
    if (!this.canLoad(force)) {
      return
    }

    const cleanQuery = query.trim()
    const request = ++this.searchRequest
    try {
      const response = await apiRequest<{ items: SearchRow[] }>(
        this.backendUrl,
        `/search?query=${encodeURIComponent(query)}`
      )
      if(request!==this.searchRequest)return
      this.writers.setSearchResults(response.items)
      if (!cleanQuery) {
        this.writers.setAllNotes(response.items)
        return
      }

    } catch (caught) {
      if(request!==this.searchRequest)return
      this.writers.setError(String(caught))
      if (!cleanQuery && request===this.searchRequest) {
        this.writers.setSearchResults([])
        this.writers.setAllNotes([])
      }
    } finally {
      if (!cleanQuery && request===this.searchRequest) {
        await this.refreshExplorerFiles(force)
      }
    }
  }

  async getExplorerContentMatchPathKeys(query: string, force = false): Promise<Set<string>> {
    if (!this.canLoad(force)) {
      return new Set()
    }

    const trimmed = query.trim()
    if (!trimmed) {
      return new Set()
    }

    try {
      const response = await apiRequest<{ items: SearchRow[] }>(
        this.backendUrl,
        `/search?query=${encodeURIComponent(trimmed)}`
      )
      return this.mapSearchRowsForPathMatch(response.items)
    } catch {
      return new Set()
    }
  }

  async refreshAllNotes(force = false): Promise<void> {
    if (!this.canLoad(force)) {
      return
    }

    try {
      const response = await apiRequest<{ items: SearchRow[] }>(this.backendUrl, '/search?query=')
      this.writers.setAllNotes(response.items)
    } catch (caught) {
      this.writers.setError(String(caught))
      this.writers.setAllNotes([])
    }
  }

  async refreshReview(force = false): Promise<void> {
    if (!this.canLoad(force)) {
      return
    }

    try {
      const todayIso = toLocalIsoDate()
      const reviewDays = toReviewWindowDays(this.context.getReviewWindow())
      const dashboard = await apiRequest<ReviewDashboardResponse>(
        this.backendUrl,
        `/review/dashboard?days=${reviewDays}&top=10&day=${encodeURIComponent(todayIso)}`
      )
      this.writers.setReviewDashboardData(dashboard)
    } catch (caught) {
      this.writers.setError(String(caught))
      this.writers.setReviewDashboardData(null)
    }
  }

  async refreshFocusAggregate(force = false): Promise<void> {
    if (!this.canLoad(force)) {
      return
    }

  const todayIso = toLocalIsoDate()
  const response = await apiRequest<FocusDashboardAggregateResponse>(
    this.backendUrl,
    `/focus/dashboard?date=${encodeURIComponent(todayIso)}`
  )
    this.writers.setTasks(Array.isArray(response.tasks) ? response.tasks : [])
    this.writers.setTodos(Array.isArray(response.todos) ? response.todos : [])
    this.writers.setAllNotes(Array.isArray(response.notes) ? response.notes : [])
    this.writers.setFocusMitIds(Array.isArray(response.mitIds) ? response.mitIds : [])
    this.writers.setFocusDashboardStats(response.stats)
    if (response.counts) {
      this.writers.setCounts(response.counts)
    }
  }

  async refreshTagGroups(force = false): Promise<void> {
    if (!this.canLoad(force)) {
      return
    }

    const response = await apiRequest<{ groups: unknown }>(this.backendUrl, '/tag-groups')
    this.writers.setCustomTagGroups(toStorageTagGroups(response.groups))
  }

  async refreshNoteGroups(force = false): Promise<void> {
    if (!this.canLoad(force)) {
      return
    }

    try {
      const response = await apiRequest<{ groups: NoteGroup[] }>(this.backendUrl, '/note-groups')
      this.writers.setNoteGroups(response.groups)
    } catch (caught) {
      this.writers.setError(String(caught))
      this.writers.setNoteGroups([])
    }
  }

  async refreshExplorerSidebarData(force = false): Promise<void> {
    if (!this.canLoad(force)) {
      return
    }
    await Promise.allSettled([
      this.refreshTasks(force),
      this.refreshNoteGroups(force),
      this.refreshAllNotes(force),
      this.refreshExplorerFiles(force),
    ])
  }

  async refreshWorkspaceData(searchQuery: string, force = false): Promise<void> {
    if (!this.canLoad(force)) {
      return
    }
    await Promise.allSettled([
      this.refreshFocusAggregate(force),
      this.runSearch(searchQuery, force),
      this.refreshReview(force),
      this.refreshTagGroups(force),
      this.refreshNoteGroups(force),
      ...(searchQuery.trim() ? [this.refreshExplorerFiles(force)] : []),
    ])
  }
}
