import type { ParsedNoteDocument } from '../editor/noteDocument';
import type { TaskPriority, TaskStatus } from '../shared/taskDomain';
import type { ExplorerOptions, ExplorerViewState } from '../explorer/types';
import { normalizeTagGroups, type TagGroupDefinition } from '../tags/tagTypes';
import { API_CONTRACT_VERSION as BACKEND_API_CONTRACT_VERSION } from '../contracts/apiContracts';
export { normalizeTagCandidate } from '../tags/tagTypes';
export { DEFAULT_TAG_GROUP_COLOR, TAG_COLOR_PRESETS } from '../tags/tagColorPalette';
export { TASK_STATUS_OPTIONS, TASK_PRIORITY_OPTIONS, TASK_STATUS_LABELS, TASK_PRIORITY_LABELS, normalizeTaskStatusValue, taskStatusLabel, taskStatusClassName, taskStatusDotClassName, taskStatusOptionLabel, normalizeTaskPriorityValue, taskPriorityLabel, taskPriorityDotClassName, taskPriorityOptionLabel, } from '../shared/taskDomain';
import type { VaultCounts as ContractVaultCounts, SuggestionResponse as ContractSuggestionResponse, SearchRow as ContractSearchRow, SearchResponse as ContractSearchResponse, TaskRow as ContractTaskRow, TodoRow as ContractTodoRow, FocusDashboardAggregateStats as ContractFocusDashboardAggregateStats, FocusDashboardAggregateResponse as ContractFocusDashboardAggregateResponse, GraphIndexStatusResponse as ContractGraphIndexStatus, BackendStateResponse as ContractBackendState } from '../contracts/apiContracts';
export const API_CONTRACT_VERSION = BACKEND_API_CONTRACT_VERSION;
export type VaultCounts = ContractVaultCounts;
export type Suggestion = ContractSuggestionResponse;
export type SearchRow = ContractSearchRow;
export type SearchResponse = ContractSearchResponse;
export type TaskRow = ContractTaskRow;
export type TodoRow = ContractTodoRow;
export type FocusDashboardAggregateStats = ContractFocusDashboardAggregateStats;
export type FocusDashboardAggregateResponse = ContractFocusDashboardAggregateResponse;
export type GraphIndexStatus = ContractGraphIndexStatus;
export type BackendState = ContractBackendState;
export type ParsedTask = {
    title: string;
    dueDate: string | null;
    priority: string;
    status: string;
    projectTag: string | null;
    tags: string[];
    estimateMinutes?: number | null;
    completedAt?: string | null;
    blockedByIds?: string[];
    waitingFor?: string | null;
    followUpDate?: string | null;
    blockedReason?: string | null;
    nextActionHint?: string | null;
};
export type TodoGroupingMode = 'note' | 'tag' | 'tag_group' | 'updated_at';
export type TodoStatusFilterValue = 'open' | 'done';
export type TodoPromotionFilterValue = 'promoted' | 'unpromoted';
export type TodoDashboardFilters = {
    query: string;
    statuses: TodoStatusFilterValue[];
    tags: string[];
    tagGroups: string[];
    promotions: TodoPromotionFilterValue[];
    grouping: TodoGroupingMode;
};
export type TaskDueBucket = 'overdue' | 'tomorrow' | 'this_week' | 'later' | 'none';
export type TaskDashboardGroupingMode = 'status' | 'priority' | 'due_date';
export type TaskDashboardLayoutMode = 'board' | 'list';
export type TaskListSortField = 'default' | 'priority' | 'due_date';
export type TaskListSortDirection = 'asc' | 'desc';
export type TaskDashboardFilters = {
    query: string;
    statuses: TaskStatus[];
    priorities: TaskPriority[];
    dueBuckets: TaskDueBucket[];
    tagGroups: string[];
    tags: string[];
    related: string[];
    grouping: TaskDashboardGroupingMode;
    layout: TaskDashboardLayoutMode;
    listSortBy: TaskListSortField;
    listSortDirection: TaskListSortDirection;
};
export type FocusDashboardSection = 'tasks' | 'todos' | 'notes';
export type FocusDashboardScope = 'overdue' | 'today' | 'tomorrow' | 'week' | 'next7' | 'all';
export type FocusDashboardMode = 'execution' | 'planning' | 'rescue' | 'context';
export type FocusDashboardFilters = {
    query: string;
    sections: FocusDashboardSection[];
    scope: FocusDashboardScope;
    mode: FocusDashboardMode;
    maxItems: number;
};
export type MediaUploadResponse = {
    mediaPath: string;
    markdownPath: string;
    fileName: string;
};
export type ReviewDaily = {
    date: string;
    new_notes: number;
    open_tasks: number;
    done_today: number;
};
export type ReviewWeekly = {
    from: string;
    to: string;
    notes_total: number;
    tasks_open: number;
    tasks_done: number;
};
export type ReviewDashboardWindow = 'today' | '7d' | '30d' | '90d';
export type ReviewBacklogMode = 'grouped' | 'stacked';
export type ReviewDashboardFilters = {
    window: ReviewDashboardWindow;
    backlogMode: ReviewBacklogMode;
};
export type ReviewDashboardRiskLevel = 'low' | 'medium' | 'high';
export type ReviewDashboardSeriesPoint = {
    date: string;
    new_notes: number;
    new_tasks: number;
    completed_tasks: number;
    new_todos: number;
    completed_todos: number;
    open_tasks: number;
    open_todos: number;
};
export type ReviewDashboardTopNote = {
    path: string;
    title: string;
    note_type: string;
    updated_at: string;
    activity_events: number;
    note_events: number;
    todo_events: number;
};
export type ReviewDashboardTopTask = {
    path: string;
    title: string;
    updated_at: string;
    activity_events: number;
    created_events: number;
    done_events: number;
    updated_events: number;
    todo_events: number;
};
export type ReviewDashboardCompletedItemKind = 'task' | 'todo';
export type ReviewDashboardCompletedItem = {
    kind: ReviewDashboardCompletedItemKind;
    path: string;
    title: string;
    note_type: string;
    completed_at: string;
};
export type ReviewDashboardResponse = {
    period: {
        from: string;
        to: string;
        days: number;
    };
    kpis: {
        open_tasks_now: number;
        open_todos_now: number;
        open_total_now: number;
        overdue_open_tasks: number;
        new_notes_period: number;
        notes_updated_period: number;
        new_tasks_period: number;
        new_todos_period: number;
        new_work_period: number;
        done_tasks_period: number;
        done_todos_period: number;
        done_work_period: number;
        completion_ratio: number;
        backlog_start: number;
        backlog_end: number;
        backlog_delta: number;
    };
    risk: {
        level: ReviewDashboardRiskLevel;
        reasons: string[];
        backlog_delta: number;
        completion_ratio: number;
        overdue_open_tasks: number;
    };
    series: ReviewDashboardSeriesPoint[];
    top_notes: ReviewDashboardTopNote[];
    top_tasks: ReviewDashboardTopTask[];
    completed_items: ReviewDashboardCompletedItem[];
};
export type GraphNodeType = 'note' | 'task' | 'tag' | 'tagGroup';
export type GraphEdgeType = 'link' | 'tagUsage' | 'sharedTag';
export type GraphMode = 'link' | 'tag' | 'focus' | 'debug';
export type GraphViewMode = 'graph' | 'debug';
export type GraphNode = {
    id: string;
    type: GraphNodeType;
    label: string;
    path?: string;
    group?: string;
    tag?: string;
};
export type GraphEdge = {
    id: string;
    source: string;
    target: string;
    type: GraphEdgeType;
    weight: number;
    reasons: string[];
};
export type GraphFileEntry = {
    id: string;
    type: 'note' | 'task';
    title: string;
    hash: string;
    mtime: string;
    tags: string[];
    links: string[];
};
export type GraphDiagnostic = {
    type: string;
    severity: string;
    message: string;
    path?: string;
    target?: string;
    tag?: string;
};
export type OperatorNotificationSeverity = 'info' | 'warn' | 'error' | 'critical';
export type OperatorNotification = {
    id: number;
    severity: OperatorNotificationSeverity;
    message: string;
};
export type GraphIndex = {
    version: number;
    updated_at: string;
    source: {
        tag_groups_hash?: string;
        note_base_relative?: boolean;
        [key: string]: unknown;
    };
    files: Record<string, GraphFileEntry>;
    nodes: GraphNode[];
    edges: GraphEdge[];
    diagnostics: GraphDiagnostic[];
};
export type GraphFilters = {
    showNotes: boolean;
    showTasks: boolean;
    showTags: boolean;
    showLinkEdges: boolean;
    showTagUsageEdges: boolean;
    showSharedTagEdges: boolean;
    minimumEdgeWeight: number;
    searchText: string;
    searchMode: 'filter' | 'highlight';
};
export type GraphNodePosition = {
    x: number;
    y: number;
};
export type GraphViewport = {
    zoom: number;
    pan: GraphNodePosition;
};
export type GraphState = {
    version?: number;
    updated_at?: string;
    activeMode: GraphMode;
    viewMode?: GraphViewMode;
    filters: GraphFilters;
    layout?: Record<string, unknown>;
    viewport?: GraphViewport;
    positions?: Record<string, GraphNodePosition>;
};
export type ThemeMode = 'light' | 'dark';
export type ColorProfileId = string;
export type ThemeColorToken = 'text' | 'muted' | 'surface' | 'editorNoteBg' | 'surfaceStrong' | 'surfaceContrast' | 'line' | 'lineStrong' | 'accent' | 'accentStrong' | 'accentSoft' | 'codeBg' | 'tableRow' | 'bgLayer1' | 'bgLayer2' | 'bgLayer3' | 'okBg' | 'okBorder' | 'okText' | 'errorBg' | 'errorBorder' | 'errorText' | 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'highlight' | 'graphNote' | 'graphTask' | 'graphTag';
export type ColorProfile = {
    id: ColorProfileId;
    name: string;
    baseTheme: ThemeMode;
    colors: Record<ThemeColorToken, string>;
    builtin?: boolean;
};
export type SidebarView = 'vault' | 'notes' | 'todos' | 'tasks' | 'focus' | 'tags' | 'review' | 'graph';
export type NoteTabKind = 'note' | 'todo_dashboard' | 'task_dashboard' | 'focus_dashboard' | 'review_dashboard' | 'graph_dashboard';
export type NoteTab = {
    id: string;
    kind: NoteTabKind;
    revision?: string;
    conflict?: boolean;
    path: string;
    title: string;
    content: string;
    loading: boolean;
    dirty: boolean;
    readOnly?: boolean;
    noteType?: 'note' | 'task';
    parsedDocument?: ParsedNoteDocument;
};
export type EditorTabContextMenuState = {
    x: number;
    y: number;
    tabId: string;
} | null;
export type RecentNoteBase = {
    path: string;
    name: string;
};
export const LAST_NOTEBASE_STORAGE_KEY = 'nicknotes-last-notebase-path';
export const RECENT_NOTEBASES_STORAGE_KEY = 'nicknotes-recent-notebases';
export const RECENT_NOTEBASES_LIMIT = 8;
export const TODO_DASHBOARD_TAB_PATH = '__nicknotes_todo_dashboard__';
export const TASK_DASHBOARD_TAB_PATH = '__nicknotes_task_dashboard__';
export const FOCUS_DASHBOARD_TAB_PATH = '__nicknotes_focus_dashboard__';
export const REVIEW_DASHBOARD_TAB_PATH = '__nicknotes_review_dashboard__';
export const GRAPH_DASHBOARD_TAB_PATH = '__nicknotes_graph_dashboard__';
export const DEFAULT_TODO_DASHBOARD_FILTERS: TodoDashboardFilters = {
    query: '',
    statuses: ['open'],
    tags: [],
    tagGroups: [],
    promotions: ['promoted', 'unpromoted'],
    grouping: 'tag',
};
export const DEFAULT_TASK_DASHBOARD_FILTERS: TaskDashboardFilters = {
    query: '',
    statuses: [],
    priorities: [],
    dueBuckets: [],
    tagGroups: [],
    tags: [],
    related: [],
    grouping: 'status',
    layout: 'board',
    listSortBy: 'default',
    listSortDirection: 'desc',
};
export const DEFAULT_FOCUS_DASHBOARD_FILTERS: FocusDashboardFilters = {
    query: '',
    sections: [],
    scope: 'today',
    mode: 'execution',
    maxItems: 12,
};
export const DEFAULT_REVIEW_DASHBOARD_FILTERS: ReviewDashboardFilters = {
    window: '30d',
    backlogMode: 'stacked',
};
export type StatusBarPrefs = {
    showNoteBaseName: boolean;
    showOpenTasks: boolean;
    showDueToday: boolean;
    showTotalNotes: boolean;
    showStateMessage: boolean;
};
export type TaskFeatureSettings = {
    advancedTaskHandling: boolean;
    taskTimeManagement: boolean;
};
export const DEFAULT_STATUS_BAR_PREFS: StatusBarPrefs = {
    showNoteBaseName: true,
    showOpenTasks: true,
    showDueToday: false,
    showTotalNotes: false,
    showStateMessage: true,
};
export const DEFAULT_TASK_FEATURE_SETTINGS: TaskFeatureSettings = {
    advancedTaskHandling: false,
    taskTimeManagement: false,
};
export const DEFAULT_EXPLORER_OPTIONS: ExplorerOptions = {
    showHiddenFiles: false,
    showFileExtensions: true,
    sortMode: 'manual',
    sortDirection: 'asc',
    foldersFirst: true,
    showIcons: true,
    compactMode: true,
};
export const DEFAULT_EXPLORER_VIEW_STATE: ExplorerViewState = {
    expandedNodes: {},
    selectedNodeId: null,
    filterQuery: '',
    folderOrder: {},
    iconOverrides: { folders: {}, files: {} },
};
export const TASK_STATUS_COLORS: Record<TaskStatus, string> = {
    new_topic: '#4f8cff',
    open: '#cf5d5d',
    in_progress: '#d3a33a',
    on_hold: '#8a8da1',
    done: '#43a36f',
};
export const TASK_PRIORITY_COLORS: Record<TaskPriority, string> = {
    low: '#59a477',
    medium: '#cea73d',
    high: '#cf5d5d',
};
export const THEME_COLOR_TOKEN_LABELS: Record<ThemeColorToken, string> = {
    text: 'Text',
    muted: 'Sekundaertext',
    surface: 'Flaeche',
    editorNoteBg: 'Editor-Hintergrund',
    surfaceStrong: 'Starke Flaeche',
    surfaceContrast: 'Kontrastflaeche',
    line: 'Linien',
    lineStrong: 'Starke Linien',
    accent: 'Akzent',
    accentStrong: 'Starker Akzent',
    accentSoft: 'Weicher Akzent',
    codeBg: 'Code-Hintergrund',
    tableRow: 'Tabellenzeile',
    bgLayer1: 'Fensterflaeche',
    bgLayer2: 'Ebene 2',
    bgLayer3: 'Ebene 3',
    okBg: 'OK-Hintergrund',
    okBorder: 'OK-Rahmen',
    okText: 'OK-Text',
    errorBg: 'Fehler-Hintergrund',
    errorBorder: 'Fehler-Rahmen',
    errorText: 'Fehler-Text',
    success: 'Erfolg',
    warning: 'Warnung',
    danger: 'Gefahr',
    info: 'Info',
    neutral: 'Neutral',
    highlight: 'Highlight',
    graphNote: 'Graph Notiz',
    graphTask: 'Graph Task',
    graphTag: 'Graph Tag',
};
export const THEME_COLOR_TOKEN_GROUPS: Array<{
    title: string;
    tokens: ThemeColorToken[];
}> = [
    {
        title: 'Grundfarben',
        tokens: ['text', 'muted', 'surface', 'editorNoteBg', 'surfaceStrong', 'surfaceContrast', 'line', 'lineStrong'],
    },
    {
        title: 'Akzente',
        tokens: ['accent', 'accentStrong', 'accentSoft', 'highlight', 'codeBg', 'tableRow'],
    },
    {
        title: 'Zustaende',
        tokens: ['okBg', 'okBorder', 'okText', 'errorBg', 'errorBorder', 'errorText', 'success', 'warning', 'danger', 'info', 'neutral'],
    },
    {
        title: 'Graph',
        tokens: ['graphNote', 'graphTask', 'graphTag'],
    }
];
export const THEME_COLOR_CSS_VARIABLES: Record<ThemeColorToken, string> = {
    text: '--text',
    muted: '--muted',
    surface: '--surface',
    editorNoteBg: '--editor-note-bg',
    surfaceStrong: '--surface-strong',
    surfaceContrast: '--surface-contrast',
    line: '--line',
    lineStrong: '--line-strong',
    accent: '--accent',
    accentStrong: '--accent-strong',
    accentSoft: '--accent-soft',
    codeBg: '--code-bg',
    tableRow: '--table-row',
    bgLayer1: '--bg-layer-1',
    bgLayer2: '--bg-layer-2',
    bgLayer3: '--bg-layer-3',
    okBg: '--ok-bg',
    okBorder: '--ok-border',
    okText: '--ok-text',
    errorBg: '--error-bg',
    errorBorder: '--error-border',
    errorText: '--error-text',
    success: '--success',
    warning: '--warning',
    danger: '--danger',
    info: '--info',
    neutral: '--neutral',
    highlight: '--highlight',
    graphNote: '--graph-note',
    graphTask: '--graph-task',
    graphTag: '--graph-tag',
};
export const DEFAULT_LIGHT_COLOR_PROFILE: ColorProfile = {
    id: 'light',
    name: 'Light Mode',
    baseTheme: 'light',
    builtin: true,
    colors: {
        text: '#1f2328',
        muted: '#6a727f',
        surface: '#f3f4f6',
        editorNoteBg: '#f6f7f9',
        surfaceStrong: '#eceef2',
        surfaceContrast: '#fbfbfc',
        line: '#d6dae1',
        lineStrong: '#c6cbd4',
        accent: '#3d7fe0',
        accentStrong: '#2f68bc',
        accentSoft: 'rgba(61, 127, 224, 0.16)',
        codeBg: '#f2f4f8',
        tableRow: '#f7f8fa',
        bgLayer1: '#eceef2',
        bgLayer2: '#e6e8ed',
        bgLayer3: '#e0e3ea',
        okBg: '#edf4ff',
        okBorder: '#c8daf8',
        okText: '#1f355b',
        errorBg: '#fff0f1',
        errorBorder: '#efc7cc',
        errorText: '#8a2d3b',
        success: '#22c55e',
        warning: '#f59e0b',
        danger: '#ef4444',
        info: '#3b82f6',
        neutral: '#8d8fa0',
        highlight: '#facc15',
        graphNote: '#91aeca',
        graphTask: '#d4ae61',
        graphTag: '#c98989',
    },
};
export const DEFAULT_DARK_COLOR_PROFILE: ColorProfile = {
    id: 'dark',
    name: 'Dark Mode',
    baseTheme: 'dark',
    builtin: true,
    colors: {
        text: '#edf0f5',
        muted: '#a7afbd',
        surface: '#1f242d',
        editorNoteBg: '#1f242d',
        surfaceStrong: '#262c36',
        surfaceContrast: '#2b313d',
        line: '#3b4351',
        lineStrong: '#4a5466',
        accent: '#6ea7f3',
        accentStrong: '#4f8fe8',
        accentSoft: 'rgba(110, 167, 243, 0.24)',
        codeBg: '#232a35',
        tableRow: '#313949',
        bgLayer1: '#1f252f',
        bgLayer2: '#171c26',
        bgLayer3: '#1a202b',
        okBg: '#23344f',
        okBorder: '#325073',
        okText: '#d9e9ff',
        errorBg: '#4d2a33',
        errorBorder: '#7a3f4c',
        errorText: '#ffdce2',
        success: '#22c55e',
        warning: '#f59e0b',
        danger: '#ef4444',
        info: '#3b82f6',
        neutral: '#8a8da1',
        highlight: '#facc15',
        graphNote: '#91aeca',
        graphTask: '#d4ae61',
        graphTag: '#c98989',
    },
};
export const BUILTIN_COLOR_PROFILES = [DEFAULT_LIGHT_COLOR_PROFILE, DEFAULT_DARK_COLOR_PROFILE];
export type UiSettingsPayload = {
    updated_at?: string;
    app?: Record<string, unknown>;
    explorer?: Record<string, unknown>;
};
export type NoteGroup = {
    key: string;
    label: string;
    path: string;
    favorite: boolean;
    canCreateNotes: boolean;
    canCreateGroups?: boolean;
    canDelete?: boolean;
};
export function normalizeWikiLookup(value: string): string {
    return value.trim().replace(/\\/g, '/').replace(/\.md$/i, '').replace(/\s+/g, ' ').toLowerCase();
}
export function getPreferredTheme(): ThemeMode {
    if (typeof window === 'undefined') {
        return 'light';
    }
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
export { apiRequest } from './apiClient';
export function toGermanTimestamp(value: string): string {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return value;
    }
    return parsed.toLocaleString('de-DE', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    });
}
export function getFileName(path: string): string {
    const normalized = path.replace(/\\/g, '/');
    const parts = normalized.split('/');
    return parts[parts.length - 1] || path;
}
export function getPathTail(path: string): string {
    const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
    const parts = normalized.split('/');
    return parts[parts.length - 1] || path;
}
export function toNoteDisplayName(path: string): string {
    return getFileName(path).replace(/\.md$/i, '');
}
export function normalizeFilePathKey(path: string): string {
    return path.replace(/\\/g, '/').trim().toLowerCase();
}
export function normalizeNoteTypeValue(raw: unknown): 'note' | 'task' {
    return String(raw ?? '')
        .trim()
        .toLowerCase() === 'task'
        ? 'task'
        : 'note';
}
export function normalizeLabel(value: string): string {
    return value.trim().replace(/\s+/g, ' ');
}
export function normalizeRelatedCandidate(raw: string): string {
    let clean = normalizeLabel(raw);
    if (!clean) {
        return '';
    }
    if (clean.startsWith('[[') && clean.endsWith(']]')) {
        clean = clean.slice(2, -2).trim();
    }
    if (clean.includes('|')) {
        clean = clean.split('|', 1)[0]?.trim() || '';
    }
    if (clean.includes('#')) {
        clean = clean.split('#', 1)[0]?.trim() || '';
    }
    clean = clean.replace(/\\/g, '/').replace(/\.md$/i, '');
    return clean;
}
export function deriveImageAltText(fileName: string): string {
    const base = fileName.replace(/\.[^.]+$/, '');
    const label = normalizeLabel(base.replace(/[_-]+/g, ' '));
    return label || 'Image';
}
export function readFileAsBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('Bild konnte nicht gelesen werden.'));
        reader.onload = () => {
            const result = typeof reader.result === 'string' ? reader.result : '';
            const marker = 'base64,';
            const markerIndex = result.indexOf(marker);
            if (markerIndex < 0) {
                reject(new Error('Ungueltiges Bildformat.'));
                return;
            }
            resolve(result.slice(markerIndex + marker.length));
        };
        reader.readAsDataURL(file);
    });
}
export function isPermanentPinnedRootGroupKey(groupKey: string): boolean {
    const clean = groupKey.replace(/\\/g, '/').trim().replace(/^\/+|\/+$/g, '');
    if (!clean || clean.includes('/')) {
        return false;
    }
    const token = clean.toLowerCase().replace(/^\d+_/, '');
    return token === 'daily' || token === 'tags' || token === 'tasks';
}
export function toStorageTagGroups(value: unknown): TagGroupDefinition[] {
    return normalizeTagGroups(value);
}
function toRecentNoteBasePathKey(path: string): string {
    return normalizeLabel(path).replace(/\//g, '\\').toLowerCase();
}
function toRecentNoteBase(path: string): RecentNoteBase | null {
    const cleanPath = normalizeLabel(path);
    if (!cleanPath) {
        return null;
    }
    return {
        path: cleanPath,
        name: getPathTail(cleanPath) || cleanPath,
    };
}
function normalizeRecentNoteBases(value: unknown): RecentNoteBase[] {
    if (!Array.isArray(value)) {
        return [];
    }
    const next: RecentNoteBase[] = [];
    const seen = new Set<string>();
    for (const item of value) {
        const path = typeof item === 'string'
            ? item
            : item && typeof item === 'object' && 'path' in item
                ? String((item as {
                    path?: unknown;
                }).path || '')
                : '';
        const entry = toRecentNoteBase(path);
        if (!entry) {
            continue;
        }
        const key = toRecentNoteBasePathKey(entry.path);
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        next.push(entry);
        if (next.length >= RECENT_NOTEBASES_LIMIT) {
            break;
        }
    }
    return next;
}
function writeStoredRecentNoteBases(items: RecentNoteBase[]): void {
    if (typeof window === 'undefined') {
        return;
    }
    try {
        window.localStorage.setItem(RECENT_NOTEBASES_STORAGE_KEY, JSON.stringify(items));
    }
    catch {
        // Best effort.
    }
}
export function getStoredRecentNoteBases(): RecentNoteBase[] {
    if (typeof window === 'undefined') {
        return [];
    }
    try {
        return normalizeRecentNoteBases(JSON.parse(window.localStorage.getItem(RECENT_NOTEBASES_STORAGE_KEY) || '[]'));
    }
    catch {
        return [];
    }
}
export function storeRecentNoteBasePath(path: string): void {
    const entry = toRecentNoteBase(path);
    if (!entry) {
        return;
    }
    const entryKey = toRecentNoteBasePathKey(entry.path);
    const next = [
        entry,
        ...getStoredRecentNoteBases().filter((candidate) => toRecentNoteBasePathKey(candidate.path) !== entryKey)
    ].slice(0, RECENT_NOTEBASES_LIMIT);
    writeStoredRecentNoteBases(next);
}
export function removeStoredRecentNoteBasePath(path: string): void {
    const key = toRecentNoteBasePathKey(path);
    if (!key) {
        return;
    }
    const next = getStoredRecentNoteBases().filter((candidate) => toRecentNoteBasePathKey(candidate.path) !== key);
    writeStoredRecentNoteBases(next);
}
export function getStoredLastNoteBasePath(): string {
    if (typeof window === 'undefined') {
        return '';
    }
    try {
        return normalizeLabel(window.localStorage.getItem(LAST_NOTEBASE_STORAGE_KEY) || '');
    }
    catch {
        return '';
    }
}
export function storeLastNoteBasePath(path: string): void {
    if (typeof window === 'undefined') {
        return;
    }
    const cleanPath = normalizeLabel(path);
    if (!cleanPath) {
        return;
    }
    try {
        window.localStorage.setItem(LAST_NOTEBASE_STORAGE_KEY, cleanPath);
        storeRecentNoteBasePath(cleanPath);
    }
    catch {
        // Best effort.
    }
}
export function clearStoredLastNoteBasePath(): void {
    if (typeof window === 'undefined') {
        return;
    }
    try {
        window.localStorage.removeItem(LAST_NOTEBASE_STORAGE_KEY);
    }
    catch {
        // Best effort.
    }
}
export function areStatusBarPrefsEqual(left: StatusBarPrefs, right: StatusBarPrefs): boolean {
    return (left.showNoteBaseName === right.showNoteBaseName &&
        left.showOpenTasks === right.showOpenTasks &&
        left.showDueToday === right.showDueToday &&
        left.showTotalNotes === right.showTotalNotes &&
        left.showStateMessage === right.showStateMessage);
}
export function areExplorerOptionsEqual(left: ExplorerOptions, right: ExplorerOptions): boolean {
    return (left.showHiddenFiles === right.showHiddenFiles &&
        left.showFileExtensions === right.showFileExtensions &&
        left.sortMode === right.sortMode &&
        left.sortDirection === right.sortDirection &&
        left.foldersFirst === right.foldersFirst &&
        left.showIcons === right.showIcons &&
        left.compactMode === right.compactMode);
}
export function areTaskFeatureSettingsEqual(left: TaskFeatureSettings, right: TaskFeatureSettings): boolean {
    return left.advancedTaskHandling === right.advancedTaskHandling && left.taskTimeManagement === right.taskTimeManagement;
}
export function toBoolean(value: unknown, fallback: boolean): boolean {
    return typeof value === 'boolean' ? value : fallback;
}
export function toBoundedNumber(value: unknown, fallback: number, min: number, max: number): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return fallback;
    }
    return Math.max(min, Math.min(max, Math.round(value)));
}
export function toThemeMode(value: unknown, fallback: ThemeMode): ThemeMode {
    return value === 'light' || value === 'dark' ? value : fallback;
}
export function normalizeCssColor(value: unknown, fallback: string): string {
    const clean = String(value ?? '').trim();
    if (!clean) {
        return fallback;
    }
    if (/^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(clean)) {
        return clean.toLowerCase();
    }
    if (/^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}(?:\s*,\s*(?:0|1|0?\.\d+))?\s*\)$/i.test(clean)) {
        return clean;
    }
    return fallback;
}
export function normalizeColorProfile(value: unknown, fallback: ColorProfile): ColorProfile {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return { ...fallback, colors: { ...fallback.colors } };
    }
    const source = value as Record<string, unknown>;
    const rawId = String(source.id ?? '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
    const id = rawId && rawId !== 'light' && rawId !== 'dark' ? rawId : fallback.id;
    const name = normalizeLabel(String(source.name ?? '')) || fallback.name;
    const baseTheme = toThemeMode(source.baseTheme, fallback.baseTheme);
    const sourceColors = source.colors && typeof source.colors === 'object' && !Array.isArray(source.colors) ? (source.colors as Record<string, unknown>) : {};
    const colors = { ...fallback.colors };
    for (const token of Object.keys(THEME_COLOR_CSS_VARIABLES) as ThemeColorToken[]) {
        colors[token] = normalizeCssColor(sourceColors[token], colors[token]);
    }
    return { id, name, baseTheme, colors };
}
export function toColorProfilesFromSettings(value: unknown): ColorProfile[] {
    const byId = new Map<string, ColorProfile>();
    for (const profile of BUILTIN_COLOR_PROFILES) {
        byId.set(profile.id, { ...profile, colors: { ...profile.colors } });
    }
    if (Array.isArray(value)) {
        for (const rawProfile of value) {
            const baseTheme = rawProfile && typeof rawProfile === 'object' && !Array.isArray(rawProfile) ? toThemeMode((rawProfile as Record<string, unknown>).baseTheme, 'light') : 'light';
            const fallback = baseTheme === 'dark' ? DEFAULT_DARK_COLOR_PROFILE : DEFAULT_LIGHT_COLOR_PROFILE;
            const normalized = normalizeColorProfile(rawProfile, {
                ...fallback,
                id: `custom-${byId.size + 1}`,
                name: 'Eigenes Profil',
                builtin: false,
            });
            if (normalized.id === 'light' || normalized.id === 'dark') {
                continue;
            }
            byId.set(normalized.id, normalized);
        }
    }
    return [...byId.values()];
}
export function toActiveColorProfileId(value: unknown, profiles: ColorProfile[], fallbackTheme: ThemeMode): string {
    const candidate = String(value ?? '').trim();
    if (candidate && profiles.some((profile) => profile.id === candidate)) {
        return candidate;
    }
    return fallbackTheme;
}
export function applyColorProfileToDocument(profile: ColorProfile): void {
    if (typeof document === 'undefined') {
        return;
    }
    const rootStyle = document.documentElement.style;
    for (const [token, variableName] of Object.entries(THEME_COLOR_CSS_VARIABLES) as Array<[
        ThemeColorToken,
        string
    ]>) {
        rootStyle.setProperty(variableName, profile.colors[token]);
    }
}
export function areColorProfilesEqual(left: ColorProfile[], right: ColorProfile[]): boolean {
    if (left.length !== right.length) {
        return false;
    }
    for (let index = 0; index < left.length; index += 1) {
        const leftProfile = left[index];
        const rightProfile = right[index];
        if (leftProfile.id !== rightProfile.id ||
            leftProfile.name !== rightProfile.name ||
            leftProfile.baseTheme !== rightProfile.baseTheme ||
            Boolean(leftProfile.builtin) !== Boolean(rightProfile.builtin)) {
            return false;
        }
        for (const token of Object.keys(THEME_COLOR_CSS_VARIABLES) as ThemeColorToken[]) {
            if (leftProfile.colors[token] !== rightProfile.colors[token]) {
                return false;
            }
        }
    }
    return true;
}
export function toStatusBarPrefsFromSettings(value: unknown): StatusBarPrefs {
    if (!value || typeof value !== 'object') {
        return { ...DEFAULT_STATUS_BAR_PREFS };
    }
    const source = value as Partial<StatusBarPrefs>;
    return {
        showNoteBaseName: source.showNoteBaseName ?? DEFAULT_STATUS_BAR_PREFS.showNoteBaseName,
        showOpenTasks: source.showOpenTasks ?? DEFAULT_STATUS_BAR_PREFS.showOpenTasks,
        showDueToday: source.showDueToday ?? DEFAULT_STATUS_BAR_PREFS.showDueToday,
        showTotalNotes: source.showTotalNotes ?? DEFAULT_STATUS_BAR_PREFS.showTotalNotes,
        showStateMessage: source.showStateMessage ?? DEFAULT_STATUS_BAR_PREFS.showStateMessage,
    };
}
export function toTaskFeatureSettingsFromSettings(value: unknown): TaskFeatureSettings {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return { ...DEFAULT_TASK_FEATURE_SETTINGS };
    }
    const source = value as Partial<TaskFeatureSettings>;
    return {
        advancedTaskHandling: source.advancedTaskHandling ?? DEFAULT_TASK_FEATURE_SETTINGS.advancedTaskHandling,
        taskTimeManagement: source.taskTimeManagement ?? DEFAULT_TASK_FEATURE_SETTINGS.taskTimeManagement,
    };
}
export function toExplorerOptionsFromSettings(value: unknown): ExplorerOptions {
    if (!value || typeof value !== 'object') {
        return { ...DEFAULT_EXPLORER_OPTIONS };
    }
    const source = value as Partial<ExplorerOptions>;
    return {
        showHiddenFiles: source.showHiddenFiles ?? DEFAULT_EXPLORER_OPTIONS.showHiddenFiles,
        showFileExtensions: source.showFileExtensions ?? DEFAULT_EXPLORER_OPTIONS.showFileExtensions,
        sortMode: source.sortMode === 'manual' ||
            source.sortMode === 'modified' ||
            source.sortMode === 'noteCount' ||
            source.sortMode === 'name'
            ? source.sortMode
            : DEFAULT_EXPLORER_OPTIONS.sortMode,
        sortDirection: source.sortDirection === 'desc' || source.sortDirection === 'asc' ? source.sortDirection : DEFAULT_EXPLORER_OPTIONS.sortDirection,
        foldersFirst: source.foldersFirst ?? DEFAULT_EXPLORER_OPTIONS.foldersFirst,
        showIcons: source.showIcons ?? DEFAULT_EXPLORER_OPTIONS.showIcons,
        compactMode: source.compactMode ?? DEFAULT_EXPLORER_OPTIONS.compactMode,
    };
}
export function toExpandedTagGroups(value: unknown): Record<string, boolean> {
    const fallback = {
        daily: true,
        tags: true,
        other: true,
    };
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return fallback;
    }
    const source = value as Record<string, unknown>;
    const next: Record<string, boolean> = {};
    for (const [key, raw] of Object.entries(source)) {
        if (!key) {
            continue;
        }
        next[key] = Boolean(raw);
    }
    return { ...fallback, ...next };
}
export function toExplorerViewStateFromSettings(value: unknown): ExplorerViewState {
    const fallback: ExplorerViewState = { ...DEFAULT_EXPLORER_VIEW_STATE };
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return fallback;
    }
    const source = value as Record<string, unknown>;
    const expandedNodes = source.expandedNodes && typeof source.expandedNodes === 'object' && !Array.isArray(source.expandedNodes)
        ? (source.expandedNodes as Record<string, boolean>)
        : {};
    const folderOrder = source.folderOrder && typeof source.folderOrder === 'object' && !Array.isArray(source.folderOrder)
        ? (source.folderOrder as Record<string, string[]>)
        : {};
    const iconOverridesRaw = source.iconOverrides && typeof source.iconOverrides === 'object' && !Array.isArray(source.iconOverrides)
        ? (source.iconOverrides as Record<string, unknown>)
        : {};
    const iconFolders = iconOverridesRaw.folders && typeof iconOverridesRaw.folders === 'object' && !Array.isArray(iconOverridesRaw.folders)
        ? (iconOverridesRaw.folders as Record<string, string>)
        : {};
    const iconFiles = iconOverridesRaw.files && typeof iconOverridesRaw.files === 'object' && !Array.isArray(iconOverridesRaw.files)
        ? (iconOverridesRaw.files as Record<string, string>)
        : {};
    return {
        expandedNodes,
        selectedNodeId: typeof source.selectedNodeId === 'string' ? source.selectedNodeId : null,
        // Do not restore persisted explorer search text across restarts.
        filterQuery: '',
        folderOrder,
        iconOverrides: {
            folders: iconFolders,
            files: iconFiles,
        },
    };
}
function areBooleanRecordEqual(left: Record<string, boolean>, right: Record<string, boolean>): boolean {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) {
        return false;
    }
    for (const key of leftKeys) {
        if (left[key] !== right[key]) {
            return false;
        }
    }
    return true;
}
function areStringRecordEqual(left: Record<string, string>, right: Record<string, string>): boolean {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) {
        return false;
    }
    for (const key of leftKeys) {
        if (left[key] !== right[key]) {
            return false;
        }
    }
    return true;
}
function areOrderRecordEqual(left: Record<string, string[]>, right: Record<string, string[]>): boolean {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) {
        return false;
    }
    for (const key of leftKeys) {
        const leftItems = left[key] ?? [];
        const rightItems = right[key] ?? [];
        if (leftItems.length !== rightItems.length) {
            return false;
        }
        for (let index = 0; index < leftItems.length; index += 1) {
            if (leftItems[index] !== rightItems[index]) {
                return false;
            }
        }
    }
    return true;
}
export function areExplorerViewStatesEqual(left: ExplorerViewState, right: ExplorerViewState): boolean {
    return (left.selectedNodeId === right.selectedNodeId &&
        left.filterQuery === right.filterQuery &&
        areBooleanRecordEqual(left.expandedNodes, right.expandedNodes) &&
        areOrderRecordEqual(left.folderOrder, right.folderOrder) &&
        areStringRecordEqual(left.iconOverrides.folders, right.iconOverrides.folders) &&
        areStringRecordEqual(left.iconOverrides.files, right.iconOverrides.files));
}
export function toLocalIsoDate(): string {
    const now = new Date();
    const offsetMinutes = now.getTimezoneOffset();
    const local = new Date(now.getTime() - offsetMinutes * 60 * 1000);
    return local.toISOString().slice(0, 10);
}
export function getRelativeVaultPath(path: string, noteBasePath: string): string {
    const normalizedPath = path.replace(/\\/g, '/');
    const normalizedBase = noteBasePath.replace(/\\/g, '/').replace(/\/+$/, '');
    if (!normalizedBase) {
        return normalizedPath;
    }
    if (normalizedPath.toLowerCase().startsWith(`${normalizedBase.toLowerCase()}/`)) {
        return normalizedPath.slice(normalizedBase.length + 1);
    }
    return normalizedPath;
}
