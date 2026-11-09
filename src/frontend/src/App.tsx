import {useNoteDocuments} from './workspace/useNoteDocuments';
import {useExternalChanges} from './app/useExternalChanges';
import {useCaptureDraft} from './app/useCaptureDraft';
import {COMMANDS, commandTitle, type AppCommand, type CommandId} from './app/commands';
import {useAppCommands} from './app/useAppCommands';
import {AppMenuBar} from './layout/AppMenuBar';
import {QuickOpenDialog, ShortcutHelpDialog} from './layout/CommandDialogs';
import {flushSync} from 'react-dom';


import {lazy, Suspense, useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { CodeMirrorMarkdownEditor } from './editor/CodeMirrorMarkdownEditor';
import type { MarkdownEditorApi, MarkdownLinkTarget } from './editor/CodeMirrorMarkdownEditor';
import { NotePropertiesPanel } from './editor/NotePropertiesPanel';
import { parseNoteDocument, extractAutoTags, extractRelatedLinks, type ParsedNoteDocument, type TaskPriority, type TaskStatus } from './editor/noteDocument';
import { LucideNamedIcon } from './icons/lucideCatalog';
import { ActivityRail } from './layout/ActivityRail';
import { StatusBar } from './layout/StatusBar';
import { WorkbenchSidebarContent } from './sidebar/WorkbenchSidebarContent';
const SettingsEditorPanel = lazy(() => import('./settings/SettingsEditorPanel').then(module => ({default: module.SettingsEditorPanel})));
import { TodoDashboardCanvas } from './todos/TodoDashboardCanvas';
import { TaskDashboardCanvas } from './tasks/TaskDashboardCanvas';
import { FocusDashboardCanvas } from './focus/FocusDashboardCanvas';
import { ReviewDashboardCanvas } from './review/ReviewDashboardCanvas';
const GraphDashboardCanvas = lazy(() => import('./graph/GraphDashboardCanvas').then(module => ({default: module.GraphDashboardCanvas})));
import { GraphWorkspaceProvider } from './graph/GraphWorkspaceContext';
import { EditorWorkspaceLayout, type ExternalNoteDropPayload } from './workspace/EditorWorkspaceLayout';
import { createInitialWorkspaceState, findPaneByTabId, getActiveTabIdForPane, type PaneId, workspaceReducer } from './workspace/workspaceState';
import type { ExplorerOptions, ExplorerViewState } from './explorer/types';
import { normalizeTagColor, normalizeTagId, type TagGroupDefinition } from './tags/tagTypes';
import { TagActionDialogModal, type TagActionDialogAction, type TagActionDialogResult, type TagActionDialogState, type TagFormValues, type TagGroupFormValues } from './tags/TagActionDialogModal';
import { BackendDataService } from './app/backendDataService';
import { AppLifecycleService, type NoteBaseOpenStatus } from './app/appLifecycleService';
import { AppSettingsService } from './app/appSettingsService';
import { NoteCaptureService } from './app/noteCaptureService';
import { ExplorerMutationService } from './app/explorerMutationService';
import { TagManagementService } from './app/tagManagementService';
import { useOperatorNotifications } from './app/operatorNotifications';
import { useTagMatchWorkflowState, type TagMatchCandidate } from './app/tagMatchWorkflowState';
import type { AppMutationEvent, MutationRefreshPlan } from './app/mutationEvents';
import { DEFAULT_BACKEND_URL, DEFAULT_DISPLAY_NAME, DEFAULT_NOTEBASE_NAME, EXPLORER_DEFAULT_WIDTH, CAPTURE_INLINE_HEIGHT_DEFAULT, CAPTURE_PANEL_MIN_HEIGHT, CAPTURE_PANEL_BOTTOM_OFFSET, EXPLORER_MATCH_DEBOUNCE_MS } from './app/appConfig';
import './App.css';
import { TODO_DASHBOARD_TAB_PATH, TASK_DASHBOARD_TAB_PATH, FOCUS_DASHBOARD_TAB_PATH, REVIEW_DASHBOARD_TAB_PATH, GRAPH_DASHBOARD_TAB_PATH, DEFAULT_STATUS_BAR_PREFS, DEFAULT_TASK_FEATURE_SETTINGS, DEFAULT_EXPLORER_OPTIONS, DEFAULT_EXPLORER_VIEW_STATE, DEFAULT_TODO_DASHBOARD_FILTERS, DEFAULT_TASK_DASHBOARD_FILTERS, DEFAULT_FOCUS_DASHBOARD_FILTERS, DEFAULT_REVIEW_DASHBOARD_FILTERS, TAG_COLOR_PRESETS, DEFAULT_LIGHT_COLOR_PROFILE, DEFAULT_DARK_COLOR_PROFILE, TASK_STATUS_OPTIONS, TASK_PRIORITY_OPTIONS, normalizeWikiLookup, getPreferredTheme, applyColorProfileToDocument, apiRequest, toGermanTimestamp, getPathTail, toNoteDisplayName, normalizeFilePathKey, normalizeNoteTypeValue, normalizeLabel, normalizeTagCandidate, normalizeRelatedCandidate, deriveImageAltText, readFileAsBase64, normalizeTaskStatusValue, taskStatusLabel, taskStatusClassName, taskStatusDotClassName, taskStatusOptionLabel, normalizeTaskPriorityValue, taskPriorityLabel, taskPriorityDotClassName, taskPriorityOptionLabel, toStorageTagGroups, getStoredLastNoteBasePath, getStoredRecentNoteBases, areStatusBarPrefsEqual, areTaskFeatureSettingsEqual, areExplorerOptionsEqual, areColorProfilesEqual, areExplorerViewStatesEqual, toLocalIsoDate, getRelativeVaultPath } from './app/AppShared';
import type { VaultCounts, RecentNoteBase, Suggestion, TaskRow, TodoRow, SearchRow, MediaUploadResponse, ThemeMode, SidebarView, NoteTab, TodoDashboardFilters, TaskDashboardFilters, FocusDashboardFilters, ReviewDashboardFilters, ReviewDashboardResponse, EditorTabContextMenuState, StatusBarPrefs, TaskFeatureSettings, FocusDashboardAggregateStats, NoteGroup, GraphIndexStatus, ColorProfile } from './app/AppShared';
function resolveGraphNodePath(path: string, vaultPath: string): string {
    const cleanPath = normalizeLabel(path);
    if (!cleanPath || /^[A-Za-z]:[\\/]/.test(cleanPath) || cleanPath.startsWith('\\\\')) {
        return cleanPath;
    }
    const cleanVaultPath = normalizeLabel(vaultPath).replace(/[\\/]+$/, '');
    if (!cleanVaultPath) {
        return cleanPath;
    }
    const relativePath = cleanPath.replace(/^[\\/]+/, '').replace(/\//g, '\\');
    return `${cleanVaultPath}\\${relativePath}`;
}
const EMPTY_FOCUS_DASHBOARD_STATS: FocusDashboardAggregateStats = {
    overdueCount: 0,
    blockedCount: 0,
    waitingCount: 0,
    doneToday: 0,
    doneTodayTasks: 0,
    doneTodayTodos: 0,
    openTasksWithoutEstimateCount: 0,
    waitingWithoutFollowUpCount: 0,
    unknownBlockerTaskCount: 0,
    unknownBlockerReferenceCount: 0,
};
const normalizePath = (value: string): string => value.replace(/\\/g, '/').replace(/\/+$/g, '');
const toNoteId = (path: string): string => normalizePath(path).toLowerCase();

function App() {
    const autoOpenTriedRef = useRef(false);
    const explorerRecoveryRef = useRef(false);
    const uiSettingsReadyRef = useRef(false);
    const settingsDirtyRef = useRef(false);
    const explorerViewSaveTimerRef = useRef<number | null>(null);
    const appLayoutSaveTimerRef = useRef<number | null>(null);
    const workspaceGridRef = useRef<HTMLDivElement | null>(null);
    const capturePreviewRequestSeqRef = useRef(0);
    const capturePreviewLastTextRef = useRef('');
    const [backendUrl, setBackendUrl] = useState(window.nicknotes?.getBackendUrl?'':DEFAULT_BACKEND_URL);
    const [theme, setTheme] = useState<ThemeMode>(getPreferredTheme);
    const [activeColorProfileId, setActiveColorProfileId] = useState<string>(getPreferredTheme());
    const [colorProfiles, setColorProfiles] = useState<ColorProfile[]>([
        { ...DEFAULT_LIGHT_COLOR_PROFILE, colors: { ...DEFAULT_LIGHT_COLOR_PROFILE.colors } },
        { ...DEFAULT_DARK_COLOR_PROFILE, colors: { ...DEFAULT_DARK_COLOR_PROFILE.colors } }
    ]);
    const [vaultPath, setVaultPath] = useState(getStoredLastNoteBasePath);
    const [recentNoteBases, setRecentNoteBases] = useState<RecentNoteBase[]>(getStoredRecentNoteBases);
    const [vaultLoaded, setVaultLoaded] = useState(false);
    const [noteBaseOpenStatus, setNoteBaseOpenStatus] = useState<NoteBaseOpenStatus | null>(null);
    const [counts, setCounts] = useState<VaultCounts>({ notes: 0, openTasks: 0, doneTasks: 0 });
    const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
    const [selectedTagKeys, setSelectedTagKeys] = useState<string[]>([]);
    const [ignoredCaptureTagKeys, setIgnoredCaptureTagKeys] = useState<string[]>([]);
    const [tasks, setTasks] = useState<TaskRow[]>([]);
    const [todos, setTodos] = useState<TodoRow[]>([]);
    const [taskDashboardFilters, setTaskDashboardFilters] = useState<TaskDashboardFilters>({ ...DEFAULT_TASK_DASHBOARD_FILTERS });
    const [todoDashboardFilters, setTodoDashboardFilters] = useState<TodoDashboardFilters>({ ...DEFAULT_TODO_DASHBOARD_FILTERS });
    const [focusDashboardFilters, setFocusDashboardFilters] = useState<FocusDashboardFilters>({ ...DEFAULT_FOCUS_DASHBOARD_FILTERS });
    const [reviewDashboardFilters, setReviewDashboardFilters] = useState<ReviewDashboardFilters>({ ...DEFAULT_REVIEW_DASHBOARD_FILTERS });
    const [reviewDashboardData, setReviewDashboardData] = useState<ReviewDashboardResponse | null>(null);
    const [focusMitIds, setFocusMitIds] = useState<string[]>([]);
    const [focusDashboardStats, setFocusDashboardStats] = useState<FocusDashboardAggregateStats>(EMPTY_FOCUS_DASHBOARD_STATS);
    const [searchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<SearchRow[]>([]);
    const [allNotes, setAllNotes] = useState<SearchRow[]>([]);
    const [explorerFiles, setExplorerFiles] = useState<SearchRow[]>([]);
    const [explorerFilterQuery, setExplorerFilterQuery] = useState('');
    const [storedExplorerContentMatchPathKeys, setExplorerContentMatchPathKeys] = useState<Set<string>>(new Set());
    const [sidebarView, setSidebarView] = useState<SidebarView>('notes');
    const [sidebarOpen, setSidebarOpen] = useState(true);
    const [displayName, setDisplayName] = useState(DEFAULT_DISPLAY_NAME);
    const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
    const [createNoteBaseDialogOpen, setCreateNoteBaseDialogOpen] = useState(false);
    const [createNoteBaseParentPath, setCreateNoteBaseParentPath] = useState('');
    const [createNoteBaseName, setCreateNoteBaseName] = useState('');
    const [createNoteBaseDisplayName, setCreateNoteBaseDisplayName] = useState(DEFAULT_NOTEBASE_NAME);
    const [createNoteBasePending, setCreateNoteBasePending] = useState(false);
    const [statusBarPrefs, setStatusBarPrefs] = useState<StatusBarPrefs>({ ...DEFAULT_STATUS_BAR_PREFS });
    const [taskFeatureSettings, setTaskFeatureSettings] = useState<TaskFeatureSettings>({ ...DEFAULT_TASK_FEATURE_SETTINGS });
    const [explorerOptions, setExplorerOptions] = useState<ExplorerOptions>({ ...DEFAULT_EXPLORER_OPTIONS });
    const [savedTheme, setSavedTheme] = useState<ThemeMode>(getPreferredTheme);
    const [savedActiveColorProfileId, setSavedActiveColorProfileId] = useState<string>(getPreferredTheme());
    const [savedColorProfiles, setSavedColorProfiles] = useState<ColorProfile[]>([
        { ...DEFAULT_LIGHT_COLOR_PROFILE, colors: { ...DEFAULT_LIGHT_COLOR_PROFILE.colors } },
        { ...DEFAULT_DARK_COLOR_PROFILE, colors: { ...DEFAULT_DARK_COLOR_PROFILE.colors } }
    ]);
    const [savedDisplayName, setSavedDisplayName] = useState(DEFAULT_DISPLAY_NAME);
    const [savedSidebarOpen, setSavedSidebarOpen] = useState(true);
    const [savedStatusBarPrefs, setSavedStatusBarPrefs] = useState<StatusBarPrefs>({ ...DEFAULT_STATUS_BAR_PREFS });
    const [savedTaskFeatureSettings, setSavedTaskFeatureSettings] = useState<TaskFeatureSettings>({ ...DEFAULT_TASK_FEATURE_SETTINGS });
    const [savedExplorerOptions, setSavedExplorerOptions] = useState<ExplorerOptions>({ ...DEFAULT_EXPLORER_OPTIONS });
    const [explorerWidth, setExplorerWidth] = useState(EXPLORER_DEFAULT_WIDTH);
    const [editorPanelOpen, setEditorPanelOpen] = useState(true);
    const [capturePanelOpen, setCapturePanelOpen] = useState(true);
    const [capturePinned, setCapturePinned] = useState(true);
    const [captureInlineHeight, setCaptureInlineHeight] = useState(CAPTURE_INLINE_HEIGHT_DEFAULT);
    const [captureResizing, setCaptureResizing] = useState(false);
    const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({
        daily: true,
        tags: true,
        other: true,
    });
    const [explorerViewState, setExplorerViewState] = useState<ExplorerViewState>({ ...DEFAULT_EXPLORER_VIEW_STATE });
    const explorerViewStateRef = useRef<ExplorerViewState>({ ...DEFAULT_EXPLORER_VIEW_STATE });
    const [explorerViewSeed, setExplorerViewSeed] = useState<ExplorerViewState | null>(null);
    const [explorerViewSeedId, setExplorerViewSeedId] = useState(0);
    const [explorerRevealPath, setExplorerRevealPath] = useState('');
    const [explorerRevealRequestId, setExplorerRevealRequestId] = useState(0);
    const [customTagGroups, setCustomTagGroups] = useState<TagGroupDefinition[]>([]);
    const [noteGroups, setNoteGroups] = useState<NoteGroup[]>([]);
    const [graphUpdateToken, setGraphUpdateToken] = useState(0);
    const [latestGraphStatus, setLatestGraphStatus] = useState<GraphIndexStatus | null>(null);
    const [openTabs, setOpenTabs] = useState<NoteTab[]>([]);
    const [quickOpen, setQuickOpen] = useState(false);
    const [shortcutHelp, setShortcutHelp] = useState(false);
    const openTabsRef = useRef<NoteTab[]>([]);
    const [workspaceState, dispatchWorkspace] = useReducer(workspaceReducer, undefined, createInitialWorkspaceState);
    const workspaceStateRef = useRef(workspaceState);
    const tabIdCounterRef = useRef(0);
    const [tabContextMenu, setTabContextMenu] = useState<EditorTabContextMenuState>(null);
    const [tagActionDialog, setTagActionDialog] = useState<TagActionDialogState | null>(null);
    const tagActionDialogRef = useRef<TagActionDialogState | null>(null);
    const { tagMatchWorkflow, visibleTagMatchItems, activeTagMatch, openTagMatchWorkflowLoading, resolveTagMatchWorkflowCandidates, stopTagMatchWorkflowLoading, closeTagMatchWorkflow, moveTagMatchCursor, skipTagMatch, setTagMatchApplying, removeAppliedTagMatches, } = useTagMatchWorkflowState();
    const [propertyTagInputOpenByPath, setPropertyTagInputOpenByPath] = useState<Record<string, boolean>>({});
    const [propertyTagDraftByPath, setPropertyTagDraftByPath] = useState<Record<string, string>>({});
    const [propertyRelatedInputOpenByPath, setPropertyRelatedInputOpenByPath] = useState<Record<string, boolean>>({});
    const [propertyRelatedDraftByPath, setPropertyRelatedDraftByPath] = useState<Record<string, string>>({});
    const [propertyTaskFieldErrorsByPath, setPropertyTaskFieldErrorsByPath] = useState<Record<string, {
        estimate_minutes?: string;
        follow_up_date?: string;
    }>>({});
    const leftEditorRef = useRef<MarkdownEditorApi | null>(null);
    const rightEditorRef = useRef<MarkdownEditorApi | null>(null);
    const captureEditorRef = useRef<MarkdownEditorApi | null>(null);
    const { latestOperatorNotification, launchOperatorNotifications, setMessage, setWarnMessage, setError, setCriticalMessage, } = useOperatorNotifications();
    const [captureText,setCaptureText]=useCaptureDraft(setError);
    const [workspaceReady,setWorkspaceReady]=useState(false);
    const initialCaptureActivated=useRef(false);
    useEffect(() => {
        explorerViewStateRef.current = explorerViewState;
    }, [explorerViewState]);
    useLayoutEffect(() => {
        openTabsRef.current = openTabs;
        workspaceStateRef.current = workspaceState;
    }, [openTabs, workspaceState]);
    const createTabId = useCallback(() => {
        tabIdCounterRef.current += 1;
        return `tab-${Date.now()}-${tabIdCounterRef.current}`;
    }, []);
    const isTagOverviewPath = (path: string): boolean => {
        const normalized = normalizePath(path).toLowerCase();
        return /\/(tags|02_tags)\//.test(normalized) && normalized.endsWith('/overview.md');
    };
    const isTagIndexFrontmatter = (content: string): boolean => {
        const normalized = content.replace(/^\uFEFF/, '');
        if (!normalized.startsWith('---')) {
            return false;
        }
        const frontmatterEnd = normalized.indexOf('\n---', 3);
        const frontmatter = frontmatterEnd >= 0 ? normalized.slice(0, frontmatterEnd) : normalized.slice(0, 2000);
        return /(^|\n)\s*type\s*:\s*tag_index\s*($|\n)/i.test(frontmatter);
    };
    const isTagOverviewReadOnly = (path: string, content: string): boolean => isTagOverviewPath(path) || isTagIndexFrontmatter(content);
    const parseTagReference = (rawTag: string): {
        groupId: string;
        tagId: string;
    } | null => {
        const cleanRaw = normalizeLabel(rawTag).replace(/^\{tag:/i, '').replace(/\}$/g, '').replace(/^#+/, '');
        if (!cleanRaw) {
            return null;
        }
        const delimiter = cleanRaw.includes(':') ? ':' : cleanRaw.includes('/') ? '/' : '';
        if (!delimiter) {
            return null;
        }
        const [groupRaw, tagRaw] = cleanRaw.split(delimiter, 2);
        const groupId = groupRaw.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
        const tagId = tagRaw.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
        if (!groupId || !tagId) {
            return null;
        }
        return { groupId, tagId };
    };
    const findTabByPath = (path: string, tabs: NoteTab[] = openTabsRef.current): NoteTab | null => {
        const targetKey = toNoteId(path);
        for (const tab of tabs) {
            if (toNoteId(tab.path) === targetKey) {
                return tab;
            }
        }
        return null;
    };
    useEffect(() => {
        if (!captureResizing) {
            return;
        }
        const onPointerMove = (event: PointerEvent) => {
            const host = workspaceGridRef.current;
            if (!host) {
                return;
            }
            const rect = host.getBoundingClientRect();
            const nextHeight = Math.round(rect.bottom - event.clientY);
            const bounded = Math.max(CAPTURE_PANEL_MIN_HEIGHT, Math.min(rect.height - CAPTURE_PANEL_BOTTOM_OFFSET, nextHeight));
            setCaptureInlineHeight(bounded);
        };
        const onPointerUp = () => {
            setCaptureResizing(false);
        };
        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp);
        return () => {
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerup', onPointerUp);
        };
    }, [captureResizing]);
    useEffect(() => {
        tagActionDialogRef.current = tagActionDialog;
    }, [tagActionDialog]);
    useEffect(() => {
        document.title = '';
        window.dispatchEvent(new Event('nicknotes:app-mounted'));
    }, []);
    useEffect(() => {
        let active = true;
        const init = async () => {
            try {
                if (window.nicknotes?.getBackendUrl) {
                    const url = await window.nicknotes.getBackendUrl();
                    if (active && url) {
                        setBackendUrl(url);
                    }
                }
            }
            catch {
                // Fallback to default URL.
            }
        };
        void init();
        return () => {
            active = false;
        };
    }, []);
    useEffect(() => () => {
        if (explorerViewSaveTimerRef.current) {
            window.clearTimeout(explorerViewSaveTimerRef.current);
        }
        if (appLayoutSaveTimerRef.current) {
            window.clearTimeout(appLayoutSaveTimerRef.current);
        }
    }, []);
    useEffect(() => {
        document.documentElement.setAttribute('data-theme', theme);
        const activeProfile = colorProfiles.find((profile) => profile.id === activeColorProfileId) ?? colorProfiles.find((profile) => profile.id === theme);
        if (activeProfile) {
            applyColorProfileToDocument(activeProfile);
        }
        if (window.nicknotes?.setWindowTheme) {
            void window.nicknotes.setWindowTheme(theme).catch(() => {
                // Best effort bridge for desktop titlebar.
            });
        }
    }, [activeColorProfileId, colorProfiles, theme]);
    const settingsDirty = useMemo(() => theme !== savedTheme ||
        activeColorProfileId !== savedActiveColorProfileId ||
        !areColorProfilesEqual(colorProfiles, savedColorProfiles) ||
        displayName !== savedDisplayName ||
        sidebarOpen !== savedSidebarOpen ||
        !areStatusBarPrefsEqual(statusBarPrefs, savedStatusBarPrefs) ||
        !areTaskFeatureSettingsEqual(taskFeatureSettings, savedTaskFeatureSettings) ||
        !areExplorerOptionsEqual(explorerOptions, savedExplorerOptions), [
        displayName,
        explorerOptions,
        savedDisplayName,
        savedActiveColorProfileId,
        savedColorProfiles,
        savedExplorerOptions,
        savedSidebarOpen,
        savedStatusBarPrefs,
        savedTaskFeatureSettings,
        savedTheme,
        sidebarOpen,
        statusBarPrefs,
        taskFeatureSettings,
        theme,
        activeColorProfileId,
        colorProfiles
    ]);
    useLayoutEffect(() => {
        settingsDirtyRef.current = settingsDirty;
    }, [settingsDirty]);
    const hasUnsavedChanges = useMemo(() => settingsDirty || openTabs.some((tab) => tab.kind === 'note' && tab.dirty), [openTabs, settingsDirty]);
    const tabsById = useMemo<Record<string, NoteTab>>(() => {
        const map: Record<string, NoteTab> = {};
        for (const tab of openTabs) {
            map[tab.id] = tab;
        }
        return map;
    }, [openTabs]);
    const {saveTab, openNoteInTab, refreshOpenTabsFromDisk} = useNoteDocuments({
 workspaceStateRef, leftEditorRef, rightEditorRef, findTabByPath, setMessage, setError, backendUrl, setCounts, setCustomTagGroups,
 setLatestGraphStatus, setGraphUpdateToken, remapOpenNotePaths:(from,to)=>remapOpenNotePaths(from,to), setOpenTabs, emitMutationEvent:event=>emitMutationEvent(event), toNoteId,
 confirmCloseTab:(id)=>confirmCloseTab(id), openTabsRef, isTagOverviewPath, dispatchWorkspace, setEditorPanelOpen, createTabId, isTagOverviewReadOnly,
});

    const explorerContentMatchPathKeys = useMemo(() => vaultLoaded && explorerFilterQuery.trim() ? storedExplorerContentMatchPathKeys : new Set<string>(), [vaultLoaded, explorerFilterQuery, storedExplorerContentMatchPathKeys]);
    const tabRegistryKey = useMemo(() => openTabs
        .map((tab) => `${tab.id}\u0000${toNoteId(tab.path)}`)
        .sort((left, right) => left.localeCompare(right))
        .join('\n'), [openTabs]);
    useEffect(() => {
        const registry = openTabs.map((tab) => ({
            id: tab.id,
            noteId: toNoteId(tab.path),
        }));
        dispatchWorkspace({ type: 'REGISTER_TABS', tabs: registry });
        // tabRegistryKey intentionally excludes content/title-only updates.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tabRegistryKey]);
    const paneTabs = useMemo<Record<PaneId, NoteTab[]>>(() => {
        const leftTabs = workspaceState.panes.left.tabIds.map((tabId) => tabsById[tabId]).filter(Boolean) as NoteTab[];
        const rightTabs = workspaceState.panes.right.tabIds.map((tabId) => tabsById[tabId]).filter(Boolean) as NoteTab[];
        return {
            left: leftTabs,
            right: rightTabs,
        };
    }, [tabsById, workspaceState.panes.left.tabIds, workspaceState.panes.right.tabIds]);
    const paneActiveTabs = useMemo<Record<PaneId, NoteTab | null>>(() => {
        const leftActiveId = getActiveTabIdForPane(workspaceState, 'left');
        const rightActiveId = getActiveTabIdForPane(workspaceState, 'right');
        return {
            left: leftActiveId ? tabsById[leftActiveId] ?? null : null,
            right: rightActiveId ? tabsById[rightActiveId] ?? null : null,
        };
    }, [tabsById, workspaceState]);
    const activePaneId = workspaceState.lastFocusedPane;
    const activeTab = paneActiveTabs[activePaneId] ?? null;
    const openTagActionDialog = useCallback((config: {
        kind: 'input' | 'choice' | 'group-form' | 'tag-form' | 'color-form';
        title: string;
        message?: string;
        placeholder?: string;
        initialValue?: string;
        initialGroupValues?: TagGroupFormValues;
        initialTagValues?: TagFormValues;
        tagGroupOptions?: Array<{
            id: string;
            displayName: string;
        }>;
        actions: TagActionDialogAction[];
    }): Promise<TagActionDialogResult> => {
        return new Promise((resolve) => {
            setTagActionDialog({
                kind: config.kind,
                title: config.title,
                message: config.message,
                placeholder: config.placeholder,
                value: config.initialValue ?? '',
                groupValues: config.initialGroupValues,
                tagValues: config.initialTagValues,
                tagGroupOptions: config.tagGroupOptions,
                actions: config.actions,
                resolve,
            });
        });
    }, [setTagActionDialog]);
    const backendDataService = useMemo(() => new BackendDataService({
        getBackendUrl: () => backendUrl,
        isVaultLoaded: () => vaultLoaded,
        getReviewWindow: () => reviewDashboardFilters.window,
    }, {
        setTasks,
        setTodos,
        setExplorerFiles,
        setSearchResults,
        setAllNotes,
        setReviewDashboardData,
        setFocusDashboardStats,
        setCounts,
        setFocusMitIds,
        setCustomTagGroups,
        setNoteGroups,
        setError,
    }), [backendUrl, vaultLoaded, reviewDashboardFilters.window, setError]);
    const refreshTasks = useCallback((force = false) => backendDataService.refreshTasks(force), [backendDataService]);
    const refreshTodos = useCallback((force = false) => backendDataService.refreshTodos(force), [backendDataService]);
    const runSearch = useCallback((query: string, force = false) => backendDataService.runSearch(query, force), [backendDataService]);
    const refreshReview = useCallback((force = false) => backendDataService.refreshReview(force), [backendDataService]);
    const refreshFocusAggregate = useCallback((force = false) => backendDataService.refreshFocusAggregate(force), [backendDataService]);
    const refreshNoteGroups = useCallback((force = false) => backendDataService.refreshNoteGroups(force), [backendDataService]);
    const refreshExplorerSidebarData = useCallback((force = false) => backendDataService.refreshExplorerSidebarData(force), [backendDataService]);
    const refreshWorkspaceData = useCallback((force = false) => backendDataService.refreshWorkspaceData(searchQuery, force), [backendDataService, searchQuery]);
    const emitMutationEvent = useCallback(async (event: AppMutationEvent): Promise<void> => {
        if (!vaultLoaded) {
            return;
        }
        const defaultRefresh: MutationRefreshPlan = (() => {
            if (event.refresh) {
                return event.refresh;
            }
            switch (event.kind) {
                case 'note-saved':
                    return {
                        search: true,
                        tasks: event.noteType === 'task',
                        todos: true,
                        review: true,
                        noteGroups: true,
                        explorerSidebar: true,
                    };
                case 'note-created':
                case 'note-renamed':
                case 'note-moved':
                case 'note-deleted':
                    return {
                        search: true,
                        tasks: true,
                        todos: true,
                        review: true,
                        noteGroups: true,
                        explorerSidebar: true,
                    };
                case 'note-group-mutated':
                    return {
                        search: true,
                        noteGroups: true,
                        explorerSidebar: true,
                    };
                case 'notes-batch-updated':
                    return {
                        search: true,
                        tasks: true,
                        todos: true,
                        review: true,
                        explorerSidebar: true,
                    };
                case 'tag-mutated':
                    return {
                        search: true,
                        review: true,
                    };
                case 'capture-saved':
                    return {
                        search: true,
                        todos: true,
                        review: true,
                        noteGroups: true,
                        explorerSidebar: true,
                    };
                case 'todo-updated':
                    return {
                        search: true,
                        tasks: true,
                        todos: true,
                        review: true,
                    };
                case 'focus-updated':
                    return {
                        focusAggregate: true,
                        review: true,
                    };
                case 'import-completed':
                    return {
                        search: true,
                        tasks: true,
                        todos: true,
                        review: true,
                        noteGroups: true,
                        explorerSidebar: true,
                    };
                default:
                    return {};
            }
        })();
        const shouldRefreshGraph = (() => {
            if (event.graphStatus) {
                return true;
            }
            switch (event.kind) {
                case 'note-saved':
                case 'note-created':
                case 'note-renamed':
                case 'note-moved':
                case 'note-deleted':
                case 'note-group-mutated':
                case 'notes-batch-updated':
                case 'tag-mutated':
                case 'capture-saved':
                case 'import-completed':
                    return true;
                default:
                    return false;
            }
        })();
        if (shouldRefreshGraph) {
            if (event.graphStatus) {
                setLatestGraphStatus(event.graphStatus);
            }
            setGraphUpdateToken((current) => current + 1);
        }
        const refreshTasksList: Promise<unknown>[] = [];
        const pushRefresh = (refresh: () => Promise<void> | void) => {
            const next = refresh();
            if (next && typeof (next as Promise<unknown>).then === 'function') {
                refreshTasksList.push(next as Promise<unknown>);
            }
        };
        const refresh = {
            search: defaultRefresh.search ?? false,
            tasks: defaultRefresh.tasks ?? false,
            todos: defaultRefresh.todos ?? false,
            review: defaultRefresh.review ?? false,
            noteGroups: defaultRefresh.noteGroups ?? false,
            explorerSidebar: defaultRefresh.explorerSidebar ?? false,
            focusAggregate: defaultRefresh.focusAggregate ?? false,
        };
        if (refresh.search) {
            pushRefresh(() => runSearch(searchQuery));
        }
        if (refresh.tasks) {
            pushRefresh(() => refreshTasks());
        }
        if (refresh.todos) {
            pushRefresh(() => refreshTodos());
        }
        if (refresh.review) {
            pushRefresh(() => refreshReview());
        }
        if (refresh.noteGroups) {
            pushRefresh(() => refreshNoteGroups());
        }
        if (refresh.focusAggregate) {
            pushRefresh(() => refreshFocusAggregate());
        }
        if (refresh.explorerSidebar) {
            pushRefresh(() => refreshExplorerSidebarData());
        }
        const normalizedPaths = Array.from(new Set((event.paths ?? []).map(normalizeFilePathKey).filter(Boolean)));
        if (normalizedPaths.length > 0) {
            const byPath = new Map<string, string>();
            for (const value of event.paths ?? []) {
                const normalizedPath = normalizeFilePathKey(value);
                if (normalizedPath && !byPath.has(normalizedPath)) {
                    byPath.set(normalizedPath, value);
                }
            }
            pushRefresh(() => refreshOpenTabsFromDisk(Array.from(byPath.values())));
        }
        if (refreshTasksList.length > 0) {
            await Promise.allSettled(refreshTasksList);
        }
    }, [
        refreshExplorerSidebarData,
        refreshFocusAggregate,
        refreshNoteGroups,
        refreshOpenTabsFromDisk,
        refreshReview,
        refreshTasks,
        refreshTodos,
        runSearch,
        searchQuery,
        vaultLoaded
    ]);
    const clearAppStateForClosedNoteBase = () => {
        setCounts({ notes: 0, openTasks: 0, doneTasks: 0 });
        setTasks([]);
        setTodos([]);
        setFocusMitIds([]);
        setFocusDashboardStats(EMPTY_FOCUS_DASHBOARD_STATS);
        setSearchResults([]);
        setSuggestions([]);
        setSelectedTagKeys([]);
        setOpenTabs([]);
        setAllNotes([]);
        setExplorerFiles([]);
        setTabContextMenu(null);
        dispatchWorkspace({ type: 'RESET' });
        setCustomTagGroups([]);
        setNoteGroups([]);
        setExplorerViewState({ ...DEFAULT_EXPLORER_VIEW_STATE });
        setExplorerViewSeed(null);
        setExplorerViewSeedId((prev) => prev + 1);
    };
    useEffect(() => {
        const query = explorerFilterQuery.trim();
        if (!vaultLoaded || !query) return;
        let cancelled = false;
        const timeout = window.setTimeout(() => {
            void backendDataService
                .getExplorerContentMatchPathKeys(query)
                .then((response) => {
                if (cancelled) {
                    return;
                }
                setExplorerContentMatchPathKeys(response);
            })
                .catch(() => {
                if (!cancelled) {
                    setExplorerContentMatchPathKeys(new Set());
                }
            });
        }, EXPLORER_MATCH_DEBOUNCE_MS);
        return () => {
            cancelled = true;
            window.clearTimeout(timeout);
        };
    }, [backendDataService, explorerFilterQuery, vaultLoaded]);
    useEffect(() => {
        if (!vaultLoaded) {
            return;
        }
        void refreshReview();
    }, [vaultLoaded, reviewDashboardFilters.window, refreshReview]);
    // Lifecycle and settings services share deferred save callbacks. Their
    // snapshots are rebuilt each render; memoizing them cannot break that cycle.
    // The constructor only stores these callbacks; it never invokes them in render.
    // eslint-disable-next-line react-hooks/refs
    const appLifecycleService = new AppLifecycleService({
        getBackendUrl: () => backendUrl,
        snapshot: {
            getTheme: () => theme,
            getActiveColorProfileId: () => activeColorProfileId,
            getColorProfiles: () => colorProfiles,
            getDisplayName: () => displayName,
            getVaultPath: () => vaultPath,
            isSidebarOpen: () => sidebarOpen,
            getStatusBarPrefs: () => statusBarPrefs,
            getTaskFeatureSettings: () => taskFeatureSettings,
            getExplorerOptions: () => explorerOptions,
            getExplorerWidth: () => explorerWidth,
            isEditorPanelOpen: () => editorPanelOpen,
            isCapturePanelOpen: () => capturePanelOpen,
            isCapturePinned: () => capturePinned,
            getExpandedFolders: () => expandedFolders,
            getWorkspaceLayoutMode: () => workspaceState.layoutMode,
            getWorkspaceSplitRatio: () => workspaceState.splitRatio,
            isCreateNoteBasePending: () => createNoteBasePending,
            getCreateNoteBaseParentPath: () => createNoteBaseParentPath,
            getCreateNoteBaseDisplayName: () => createNoteBaseDisplayName,
            getCreateNoteBaseName: () => createNoteBaseName,
        },
        writer: {
            setTheme,
            setActiveColorProfileId,
            setColorProfiles,
            setDisplayName,
            setSidebarOpen,
            setStatusBarPrefs,
            setTaskFeatureSettings,
            setExplorerOptions,
            setSavedTheme,
            setSavedActiveColorProfileId,
            setSavedColorProfiles,
            setSavedDisplayName,
            setSavedSidebarOpen,
            setSavedStatusBarPrefs,
            setSavedTaskFeatureSettings,
            setSavedExplorerOptions,
            setExplorerWidth,
            setEditorPanelOpen,
            setCapturePanelOpen,
            setCapturePinned,
            setExpandedFolders,
            setExplorerViewState,
            setExplorerViewSeed,
            setExplorerViewSeedId,
            setExplorerFilterQuery,
            setUiSettingsReady: (ready) => {
                uiSettingsReadyRef.current = ready;
                setWorkspaceReady(ready);
                if(ready)window.nicknotes?.startupMark?.('workspace-ready');
            },
            setVaultLoaded,
            setNoteBaseOpenStatus,
            setMessage,
            setError,
            setWarnMessage,
            setCriticalMessage,
            setCounts,
            setCustomTagGroups,
            setVaultPath,
            setRecentNoteBases,
            setFocusMitIds,
            setOpenTabs,
            setCreateNoteBaseDialogOpen,
            setCreateNoteBaseParentPath,
            setCreateNoteBaseDisplayName,
            setCreateNoteBaseName,
            setCreateNoteBasePending,
        },
        pickDirectory: async () => {
            if (!window.nicknotes?.selectDirectory) {
                return window.prompt('Bitte absoluten Pfad eingeben:') || null;
            }
            return window.nicknotes.selectDirectory();
        },
        dispatchWorkspace,
        refreshWorkspaceData: (force) => refreshWorkspaceData(force),
        openTagActionDialog,
        requestSaveBeforeNoteBaseSwitch,
        refreshSearch: (force = false) => runSearch(searchQuery, force),
        refreshFocusAggregate: (force = false) => refreshFocusAggregate(force),
        refreshReview: (force = false) => refreshReview(force),
        refreshNoteGroups: (force = false) => refreshNoteGroups(force),
        resetWorkspaceForClosedVault: () => {
            setVaultPath('');
            clearAppStateForClosedNoteBase();
        },
        isNoteBaseOpenActive: () => !!noteBaseOpenStatus?.active,
        isAutoOpenTried: () => autoOpenTriedRef.current,
        setAutoOpenTried: (value) => {
            autoOpenTriedRef.current = value;
        },
    });
    const saveUiSettingsPatch = appLifecycleService.saveUiSettingsPatch;
    const buildFullAppUiSettings = appLifecycleService.buildFullAppUiSettings;
    const buildLayoutUiSettings = appLifecycleService.buildLayoutUiSettings;
    const loadState = appLifecycleService.loadState;
    const createVault = appLifecycleService.openCreateNoteBaseDialog;
    const closeCreateNoteBaseDialog = appLifecycleService.closeCreateNoteBaseDialog;
    const chooseCreateNoteBaseParentDirectory = appLifecycleService.chooseCreateNoteBaseParentDirectory;
    const submitCreateNoteBaseDialog = appLifecycleService.submitCreateNoteBaseDialog;
    const pickAndOpenVault = appLifecycleService.pickAndOpenVault;
    const renameNoteBase = appLifecycleService.renameNoteBase;
    const deleteNoteBase = appLifecycleService.deleteNoteBase;
    // The constructor only stores these callbacks; refs are read by later actions.
    // eslint-disable-next-line react-hooks/refs
    const noteCaptureService = useMemo(() => new NoteCaptureService({
        getBackendUrl: () => backendUrl,
        isVaultLoaded: () => vaultLoaded,
        getCaptureText: () => captureText,
        getIgnoredCaptureTagKeys: () => ignoredCaptureTagKeys,
        getSelectedTagKeys: () => selectedTagKeys,
        getCapturePreviewSeq: () => capturePreviewRequestSeqRef.current,
        setCapturePreviewSeq: (value) => {
            capturePreviewRequestSeqRef.current = value;
        },
        getCapturePreviewLastText: () => capturePreviewLastTextRef.current,
        setCapturePreviewLastText: (value) => {
            capturePreviewLastTextRef.current = value;
        },
        emitMutation: emitMutationEvent,
    }, {
        setSuggestions,
        setSelectedTagKeys,
        setIgnoredCaptureTagKeys,
        setCaptureText,
        setMessage,
        setError,
        setCounts,
    }), [
        backendUrl,
        captureText,
        emitMutationEvent,
        ignoredCaptureTagKeys,
        selectedTagKeys,
        setCaptureText,
        setError,
        setMessage,
        vaultLoaded
    ]);
    const previewCapture = noteCaptureService.previewCapture;
    const toggleCaptureTag = noteCaptureService.toggleCaptureTag;
    const rejectCaptureTag = noteCaptureService.rejectCaptureTag;
    const saveCapture = noteCaptureService.saveCapture;
    const appSettingsService = new AppSettingsService({
        snapshot: {
            getTheme: () => theme,
            getActiveColorProfileId: () => activeColorProfileId,
            getColorProfiles: () => colorProfiles,
            getDisplayName: () => displayName,
            isSidebarOpen: () => sidebarOpen,
            getStatusBarPrefs: () => statusBarPrefs,
            getTaskFeatureSettings: () => taskFeatureSettings,
            getExplorerOptions: () => explorerOptions,
            getSavedTheme: () => savedTheme,
            getSavedActiveColorProfileId: () => savedActiveColorProfileId,
            getSavedColorProfiles: () => savedColorProfiles,
            getSavedDisplayName: () => savedDisplayName,
            getSavedSidebarOpen: () => savedSidebarOpen,
            getSavedStatusBarPrefs: () => savedStatusBarPrefs,
            getSavedTaskFeatureSettings: () => savedTaskFeatureSettings,
            getSavedExplorerOptions: () => savedExplorerOptions,
        },
        writer: {
            setTheme,
            setActiveColorProfileId,
            setColorProfiles,
            setDisplayName,
            setSidebarOpen,
            setStatusBarPrefs,
            setTaskFeatureSettings,
            setExplorerOptions,
            setSavedTheme,
            setSavedActiveColorProfileId,
            setSavedColorProfiles,
            setSavedDisplayName,
            setSavedSidebarOpen,
            setSavedStatusBarPrefs,
            setSavedTaskFeatureSettings,
            setSavedExplorerOptions,
            setMessage,
            setError,
        },
        isVaultLoaded: () => vaultLoaded,
        setSettingsDialogOpen,
        saveUiSettingsPatch,
        buildFullAppUiSettings,
    });
    const saveSettings = appSettingsService.saveSettings;
    const discardSettings = appSettingsService.discardSettings;
    const requestSaveSettings = appSettingsService.requestSaveSettings;
    const setSettingsDisplayName = appSettingsService.setDisplayName;
    const setSettingsColorProfiles = appSettingsService.setColorProfiles;
    const handleActiveColorProfileChange = appSettingsService.handleActiveColorProfileChange;
    const openSettingsDialog = appSettingsService.openSettingsDialog;
    const closeSettingsDialog = appSettingsService.closeSettingsDialog;
    const toggleThemeMode = appSettingsService.toggleThemeMode;
  const persistLayout = useEffectEvent(() => saveUiSettingsPatch({ app: buildLayoutUiSettings() }));
  useEffect(() => {
    if (!vaultLoaded || !uiSettingsReadyRef.current) {
      return
    }
    if (appLayoutSaveTimerRef.current) {
      window.clearTimeout(appLayoutSaveTimerRef.current)
    }
    appLayoutSaveTimerRef.current = window.setTimeout(() => {
      void persistLayout().catch(() => {
        // Best effort.
      })
    }, 250)
    return () => {
      if (appLayoutSaveTimerRef.current) {
        window.clearTimeout(appLayoutSaveTimerRef.current)
        appLayoutSaveTimerRef.current = null
      }
    }
  }, [
    backendUrl,
    vaultPath,
    capturePanelOpen,
    capturePinned,
    editorPanelOpen,
    expandedFolders,
    explorerWidth,
    vaultLoaded,
    workspaceState.layoutMode,
    workspaceState.splitRatio,
  ])

    const bootstrapConnection = useEffectEvent(() => {void loadState()});
    useEffect(() => {if(backendUrl)bootstrapConnection()}, [backendUrl]);
    const activateStartupCapture=useEffectEvent(()=>{
        if(initialCaptureActivated.current||!vaultLoaded||!workspaceReady)return;
        initialCaptureActivated.current=true;
        if(captureText){setCapturePanelOpen(true);setCapturePinned(true);window.requestAnimationFrame(()=>window.requestAnimationFrame(()=>captureEditorRef.current?.focus()))}
    });
    useEffect(()=>{
        const frame=window.requestAnimationFrame(()=>activateStartupCapture());
        return()=>window.cancelAnimationFrame(frame);
    },[vaultLoaded,workspaceReady]);
    useEffect(() => {
        if (!tabContextMenu) {
            return;
        }
        const onPointerDown = (event: PointerEvent) => {
            const target = event.target;
            if (target instanceof HTMLElement && target.closest('.editor-tab-context-menu')) {
                return;
            }
            setTabContextMenu(null);
        };
        window.addEventListener('pointerdown', onPointerDown);
        return () => {
            window.removeEventListener('pointerdown', onPointerDown);
        };
    }, [tabContextMenu]);
    useEffect(() => {
        if (!vaultLoaded) {
            return;
        }
        void previewCapture(captureText);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [captureText, vaultLoaded]);
    const sortedNotes = useMemo(() => {
        return [...searchResults].sort((left, right) => {
            const leftTime = new Date(left.updated_at).getTime();
            const rightTime = new Date(right.updated_at).getTime();
            return rightTime - leftTime;
        });
    }, [searchResults]);
    const linkIndexRows = useMemo(() => {
        const source = allNotes.length > 0 ? allNotes : sortedNotes;
        const deduped = new Map<string, SearchRow>();
        for (const row of source) {
            deduped.set(row.path, row);
        }
        return Array.from(deduped.values());
    }, [allNotes, sortedNotes]);
    const liveNoteTypeKey = useMemo(() => {
        const entries: string[] = [];
        for (const tab of openTabs) {
            if (tab.kind !== 'note' || !tab.noteType) {
                continue;
            }
            entries.push(`${normalizeFilePathKey(tab.path)}\u0000${normalizeNoteTypeValue(tab.noteType)}`);
        }
        entries.sort((left, right) => left.localeCompare(right));
        return entries.join('\n');
    }, [openTabs]);
    const liveNoteTypeByPath = useMemo(() => {
        const map = new Map<string, 'note' | 'task'>();
        if (!liveNoteTypeKey) {
            return map;
        }
        for (const entry of liveNoteTypeKey.split('\n')) {
            const [pathKey, noteTypeRaw] = entry.split('\u0000', 2);
            if (!pathKey) {
                continue;
            }
            map.set(pathKey, normalizeNoteTypeValue(noteTypeRaw));
        }
        return map;
    }, [liveNoteTypeKey]);
    const explorerRows = useMemo(() => {
        const deduped = new Map<string, SearchRow>();
        for (const row of linkIndexRows) {
            deduped.set(row.path, row);
        }
        for (const row of explorerFiles) {
            if (!deduped.has(row.path)) {
                deduped.set(row.path, row);
            }
        }
        return Array.from(deduped.values()).map((row) => {
            const liveType = liveNoteTypeByPath.get(normalizeFilePathKey(row.path));
            if (!liveType) {
                return row;
            }
            return {
                ...row,
                note_type: liveType,
            };
        });
    }, [explorerFiles, linkIndexRows, liveNoteTypeByPath]);
    useEffect(() => {
        if (!vaultLoaded) {
            explorerRecoveryRef.current = false;
            return;
        }
        if (noteGroups.length > 0 || explorerRows.length > 0) {
            explorerRecoveryRef.current = false;
            return;
        }
        if (explorerRecoveryRef.current) {
            return;
        }
        explorerRecoveryRef.current = true;
        void (async () => {
            try {
                await apiRequest(backendUrl, '/notebase/reindex', { method: 'POST' });
            }
            catch {
                // Best effort reindex.
            }
            await refreshExplorerSidebarData(true);
            explorerRecoveryRef.current = false;
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [backendUrl, vaultLoaded, noteGroups.length, explorerRows.length]);
    const noteGroupsByKey = useMemo(() => {
        const byKey = new Map<string, NoteGroup>();
        for (const group of noteGroups) {
            byKey.set(group.key, group);
        }
        return byKey;
    }, [noteGroups]);
    const mergedTagGroups = useMemo(() => toStorageTagGroups({ tagGroups: customTagGroups }), [customTagGroups]);
    const propertyTagOptions = useMemo(() => {
        const items: string[] = [];
        for (const group of mergedTagGroups) {
            for (const tag of group.tags) {
                items.push(`${group.id}:${tag.id}`);
            }
        }
        return Array.from(new Set(items)).sort((left, right) => left.localeCompare(right, 'de', { sensitivity: 'base' }));
    }, [mergedTagGroups]);
    const tagVisualByKey = useMemo(() => {
        const map = new Map<string, {
            label: string;
            color: string;
        }>();
        for (const group of mergedTagGroups) {
            const color = normalizeTagColor(group.color || '');
            for (const tag of group.tags) {
                map.set(`${group.id}:${tag.id}`.toLowerCase(), {
                    label: tag.displayName || tag.id,
                    color,
                });
            }
        }
        return map;
    }, [mergedTagGroups]);
    const mergedTagGroupsById = useMemo(() => {
        const map = new Map<string, TagGroupDefinition>();
        for (const group of mergedTagGroups) {
            map.set(group.id.toLowerCase(), group);
        }
        return map;
    }, [mergedTagGroups]);
    const explorerFileIconOverrides = useMemo(() => {
        const map = new Map<string, string>();
        const source = explorerViewState.iconOverrides.files;
        for (const [rawPath, rawIcon] of Object.entries(source)) {
            const iconName = typeof rawIcon === 'string' ? rawIcon.trim() : '';
            if (!iconName) {
                continue;
            }
            map.set(normalizeFilePathKey(rawPath), iconName);
        }
        return map;
    }, [explorerViewState.iconOverrides.files]);
    const explorerNoteTypeByPath = useMemo(() => {
        const map = new Map<string, 'note' | 'task'>();
        for (const row of explorerRows) {
            map.set(normalizeFilePathKey(row.path), normalizeNoteTypeValue(row.note_type));
        }
        return map;
    }, [explorerRows]);
    const dirtyPathKey = useMemo(() => {
        return openTabs
            .filter((tab) => tab.kind === 'note' && tab.dirty)
            .map((tab) => tab.path)
            .sort((left, right) => left.localeCompare(right))
            .join('\n');
    }, [openTabs]);
    const dirtyFilePaths = useMemo(() => {
        const next = new Set<string>();
        if (!dirtyPathKey) {
            return next;
        }
        for (const path of dirtyPathKey.split('\n')) {
            if (path) {
                next.add(path);
            }
        }
        return next;
    }, [dirtyPathKey]);
    const noteBaseName = useMemo(() => (vaultPath ? getPathTail(vaultPath) : 'Keine NoteBase'), [vaultPath]);
    const tabContextTarget = tabContextMenu ? tabsById[tabContextMenu.tabId] ?? null : null;
    const resolveNoteTabIconName = (tab: NoteTab): string => {
        if (tab.kind !== 'note') {
            if (tab.kind === 'todo_dashboard') {
                return 'ListTodo';
            }
            if (tab.kind === 'task_dashboard') {
                return 'LayoutDashboard';
            }
            if (tab.kind === 'focus_dashboard') {
                return 'Target';
            }
            if (tab.kind === 'review_dashboard') {
                return 'BarChart3';
            }
            if (tab.kind === 'graph_dashboard') {
                return 'Network';
            }
            return 'Circle';
        }
        const pathKey = normalizeFilePathKey(tab.path);
        const customIcon = explorerFileIconOverrides.get(pathKey);
        if (customIcon) {
            return customIcon;
        }
        const knownType = tab.noteType ?? explorerNoteTypeByPath.get(pathKey);
        if (knownType) {
            return knownType === 'task' ? 'CheckSquare' : 'FileText';
        }
        const parsedType = normalizeNoteTypeValue((tab.parsedDocument ?? parseNoteDocument(tab.content, tab.title || toNoteDisplayName(tab.path))).frontmatter.type);
        return parsedType === 'task' ? 'CheckSquare' : 'FileText';
    };
    const getTabTooltip = (tab: NoteTab): string => {
        if (tab.kind !== 'note') {
            return tab.title;
        }
        const relativePath = getRelativeVaultPath(tab.path, vaultPath).replace(/\.md$/i, '');
        if (relativePath) {
            return relativePath;
        }
        return tab.title.replace(/\.md$/i, '');
    };
    const dueTodayCount = useMemo(() => {
        const today = toLocalIsoDate();
        return tasks.filter((task) => task.status !== 'done' && task.due_date === today).length;
    }, [tasks]);
    const toWikiTargetForRow = useCallback((row: SearchRow): string => {
        return getRelativeVaultPath(row.path, vaultPath).replace(/\.md$/i, '') || toNoteDisplayName(row.path);
    }, [vaultPath]);
    const propertyRelatedOptions = useMemo(() => {
        const values = new Set<string>();
        for (const row of linkIndexRows) {
            const target = normalizeRelatedCandidate(toWikiTargetForRow(row));
            if (target) {
                values.add(target);
            }
        }
        return Array.from(values).sort((left, right) => left.localeCompare(right, 'de', { sensitivity: 'base' }));
    }, [linkIndexRows, toWikiTargetForRow]);
    const markdownLinkTargets = useMemo<MarkdownLinkTarget[]>(() => {
        return explorerRows
            .map((row) => {
            const relativePath = getRelativeVaultPath(row.path, vaultPath).replace(/\.md$/i, '');
            return {
                path: row.path,
                title: normalizeLabel(row.title) || toNoteDisplayName(row.path),
                target: toWikiTargetForRow(row),
                relativePath: relativePath || toNoteDisplayName(row.path),
                noteType: normalizeNoteTypeValue(row.note_type),
            };
        })
            .sort((left, right) => left.relativePath.localeCompare(right.relativePath, 'de', { sensitivity: 'base' }));
    }, [explorerRows, toWikiTargetForRow, vaultPath]);
    const openTodoDashboardTab = () => {
        if (vaultLoaded) {
            void refreshTodos();
        }
        const existing = findTabByPath(TODO_DASHBOARD_TAB_PATH, openTabs);
        const targetPane = workspaceStateRef.current.lastFocusedPane;
        if (existing) {
            setEditorPanelOpen(true);
            dispatchWorkspace({
                type: 'OPEN_TAB',
                paneId: targetPane,
                tabId: existing.id,
                activate: true,
            });
            return;
        }
        const nextTabId = createTabId();
        setOpenTabs((prev) => [
            ...prev,
            {
                id: nextTabId,
                kind: 'todo_dashboard',
                path: TODO_DASHBOARD_TAB_PATH,
                title: 'Todo Dashboard',
                content: '',
                loading: false,
                dirty: false,
            }
        ]);
        setEditorPanelOpen(true);
        dispatchWorkspace({
            type: 'OPEN_TAB',
            paneId: targetPane,
            tabId: nextTabId,
            activate: true,
        });
    };
    const openTaskDashboardTab = () => {
        if (vaultLoaded) {
            void refreshTasks();
        }
        const existing = findTabByPath(TASK_DASHBOARD_TAB_PATH, openTabs);
        const targetPane = workspaceStateRef.current.lastFocusedPane;
        if (existing) {
            setEditorPanelOpen(true);
            dispatchWorkspace({
                type: 'OPEN_TAB',
                paneId: targetPane,
                tabId: existing.id,
                activate: true,
            });
            return;
        }
        const nextTabId = createTabId();
        setOpenTabs((prev) => [
            ...prev,
            {
                id: nextTabId,
                kind: 'task_dashboard',
                path: TASK_DASHBOARD_TAB_PATH,
                title: 'Task Dashboard',
                content: '',
                loading: false,
                dirty: false,
            }
        ]);
        setEditorPanelOpen(true);
        dispatchWorkspace({
            type: 'OPEN_TAB',
            paneId: targetPane,
            tabId: nextTabId,
            activate: true,
        });
    };
    const openFocusDashboardTab = () => {
        if (vaultLoaded) {
            void Promise.allSettled([refreshFocusAggregate(), refreshReview()]);
        }
        const existing = findTabByPath(FOCUS_DASHBOARD_TAB_PATH, openTabs);
        const targetPane = workspaceStateRef.current.lastFocusedPane;
        if (existing) {
            setEditorPanelOpen(true);
            dispatchWorkspace({
                type: 'OPEN_TAB',
                paneId: targetPane,
                tabId: existing.id,
                activate: true,
            });
            return;
        }
        const nextTabId = createTabId();
        setOpenTabs((prev) => [
            ...prev,
            {
                id: nextTabId,
                kind: 'focus_dashboard',
                path: FOCUS_DASHBOARD_TAB_PATH,
                title: 'Focus Dashboard',
                content: '',
                loading: false,
                dirty: false,
            }
        ]);
        setEditorPanelOpen(true);
        dispatchWorkspace({
            type: 'OPEN_TAB',
            paneId: targetPane,
            tabId: nextTabId,
            activate: true,
        });
    };
    const openReviewDashboardTab = () => {
        if (vaultLoaded) {
            void refreshReview();
        }
        const existing = findTabByPath(REVIEW_DASHBOARD_TAB_PATH, openTabs);
        const targetPane = workspaceStateRef.current.lastFocusedPane;
        if (existing) {
            setEditorPanelOpen(true);
            dispatchWorkspace({
                type: 'OPEN_TAB',
                paneId: targetPane,
                tabId: existing.id,
                activate: true,
            });
            return;
        }
        const nextTabId = createTabId();
        setOpenTabs((prev) => [
            ...prev,
            {
                id: nextTabId,
                kind: 'review_dashboard',
                path: REVIEW_DASHBOARD_TAB_PATH,
                title: 'Review Dashboard',
                content: '',
                loading: false,
                dirty: false,
            }
        ]);
        setEditorPanelOpen(true);
        dispatchWorkspace({
            type: 'OPEN_TAB',
            paneId: targetPane,
            tabId: nextTabId,
            activate: true,
        });
    };
    const openGraphDashboardTab = () => {
        const existing = findTabByPath(GRAPH_DASHBOARD_TAB_PATH, openTabs);
        const targetPane = workspaceStateRef.current.lastFocusedPane;
        if (existing) {
            setEditorPanelOpen(true);
            dispatchWorkspace({
                type: 'OPEN_TAB',
                paneId: targetPane,
                tabId: existing.id,
                activate: true,
            });
            return;
        }
        const nextTabId = createTabId();
        setOpenTabs((prev) => [
            ...prev,
            {
                id: nextTabId,
                kind: 'graph_dashboard',
                path: GRAPH_DASHBOARD_TAB_PATH,
                title: 'Graph Preview',
                content: '',
                loading: false,
                dirty: false,
            }
        ]);
        setEditorPanelOpen(true);
        dispatchWorkspace({
            type: 'OPEN_TAB',
            paneId: targetPane,
            tabId: nextTabId,
            activate: true,
        });
    };
    const openGraphNodePath = (path: string, title: string, noteType: 'note' | 'task') => {
        const cleanPath = normalizeLabel(path);
        if (!cleanPath) {
            return;
        }
        const resolvedPath = resolveGraphNodePath(cleanPath, vaultPath);
        void openNoteInTab(resolvedPath, title, { initialNoteType: noteType });
    };
    const revealGraphNodePath = (path: string) => {
        const cleanPath = normalizeLabel(path);
        if (!cleanPath) {
            return;
        }
        setSidebarView('notes');
        setSidebarOpen(true);
        setExplorerRevealPath(resolveGraphNodePath(cleanPath, vaultPath));
        setExplorerRevealRequestId((prev) => prev + 1);
    };


    const openOrCreateTodayDaily = async (): Promise<void> => {
        const todayIso = toLocalIsoDate();
        try {
            const response = await apiRequest<{
                date: string;
                notePath: string;
                title?: string;
                created: boolean;
                counts: VaultCounts;
            }>(backendUrl, `/daily/open-today?date=${encodeURIComponent(todayIso)}`, { method: 'POST' });
            setCounts(response.counts);
            setMessage(response.created ? `Daily Note erstellt: ${response.date}` : `Daily Note geoeffnet: ${response.date}`);
            setError('');
            await emitMutationEvent({
                kind: response.created ? 'note-created' : 'note-saved',
                noteType: 'note',
                paths: [response.notePath],
                refresh: {
                    search: true,
                    tasks: false,
                    todos: true,
                    review: true,
                    noteGroups: true,
                    explorerSidebar: true,
                },
            });
            await openNoteInCurrentEditor(response.notePath, response.title || response.date);
        }
        catch (caught) {
            setError(String(caught));
        }
    };
    const saveFocusMit = async (nextMitIds: string[]): Promise<string[]> => {
        const todayIso = toLocalIsoDate();
        const response = await apiRequest<{
            mitIds: string[];
            counts: VaultCounts;
        }>(backendUrl, '/focus/mit', {
            method: 'POST',
            body: JSON.stringify({
                date: todayIso,
                mitIds: nextMitIds,
            }),
        });
        setFocusMitIds(Array.isArray(response.mitIds) ? response.mitIds : []);
        setCounts(response.counts);
        await emitMutationEvent({
            kind: 'focus-updated',
            refresh: {
                focusAggregate: true,
                review: true,
            },
        });
        return Array.isArray(response.mitIds) ? response.mitIds : [];
    };
    const quickCaptureFocusTodo = async (rawText: string): Promise<void> => {
        const text = rawText.trim();
        if (!text) {
            return;
        }
        const todayIso = toLocalIsoDate();
        const response = await apiRequest<{
            notePath: string;
            todoText: string;
            counts: VaultCounts;
        }>(backendUrl, '/focus/quick-capture', {
            method: 'POST',
            body: JSON.stringify({
                text,
                date: todayIso,
            }),
        });
        setCounts(response.counts);
        setMessage(`Todo fuer heute erfasst: ${response.todoText}`);
        await emitMutationEvent({
            kind: 'focus-updated',
            refresh: {
                focusAggregate: true,
                review: true,
            },
        });
    };
    const toggleTodo = async (todoId: string, checked?: boolean) => {
        try {
            await apiRequest<{
                todo?: TodoRow;
            }>(backendUrl, `/todos/${encodeURIComponent(todoId)}/toggle`, {
                method: 'POST',
                body: JSON.stringify(typeof checked === 'boolean' ? { checked } : {}),
            });
            setMessage(`Todo aktualisiert (${todoId}).`);
            await emitMutationEvent({
                kind: 'todo-updated',
                refresh: {
                    search: true,
                    tasks: true,
                    todos: true,
                    review: true,
                },
            });
        }
        catch (caught) {
            setError(String(caught));
        }
    };
    const promoteTodo = async (todoId: string) => {
        try {
            const response = await apiRequest<{
                taskId: string;
                taskPath?: string;
                created?: boolean;
            }>(backendUrl, `/todos/${encodeURIComponent(todoId)}/promote`, {
                method: 'POST',
            });
            const verb = response.created === false ? 'bereits verknuepft' : 'zu Task promoted';
            setMessage(`Todo ${verb}: ${response.taskId}`);
            await emitMutationEvent({
                kind: 'todo-updated',
                refresh: {
                    search: true,
                    tasks: true,
                    todos: true,
                    review: true,
                },
            });
            if (response.taskPath) {
                await openNoteInTab(response.taskPath, undefined, { initialNoteType: 'task' });
            }
        }
        catch (caught) {
            setError(String(caught));
        }
    };
    const openTodoOrigin = async (notePath: string, title?: string) => {
        await openNoteInTab(notePath, title, { initialNoteType: 'note' });
    };


    const openTagOverviewByReference = useCallback(async (rawTag: string, options?: {
        targetPane?: PaneId;
    }) => {
        const parsed = parseTagReference(rawTag);
        if (!parsed) {
            return;
        }
        try {
            setError('');
            const response = await apiRequest<{
                path: string;
                title?: string;
            }>(backendUrl, `/tags/overview?groupId=${encodeURIComponent(parsed.groupId)}&tagId=${encodeURIComponent(parsed.tagId)}`);
            await openNoteInTab(response.path, response.title || `${parsed.groupId}:${parsed.tagId}`, {
                targetPane: options?.targetPane ?? workspaceStateRef.current.lastFocusedPane,
                initialNoteType: 'note',
            });
        }
        catch (caught) {
            setError(String(caught));
        }
    }, [backendUrl, openNoteInTab, setError]);
    const confirmCloseTab = async (tabId: string): Promise<boolean> => {
        const tab = openTabsRef.current.find((candidate) => candidate.id === tabId);
        if (!tab) {
            return true;
        }
        if (tab.kind !== 'note' || !tab.dirty) {
            return true;
        }
        const decision = await askTagChoice(`Ungespeicherte Aenderungen in "${tab.title}"`, 'Was soll passieren?', [
            { id: 'save', label: 'Speichern', tone: 'primary' },
            { id: 'discard', label: 'Verwerfen', tone: 'danger' }
        ]);
        if (!decision) {
            return false;
        }
        if (decision === 'save') {
            return await saveTab(tab.path);
        }
        if (decision === 'discard') {
            return true;
        }
        return false;
    };
    const closeEditorTab = async (tabId: string) => {
        await closeEditorTabs([tabId]);
    };
    const closeEditorTabs = async (tabIds: string[]): Promise<boolean> => {
        flushSync(()=>{leftEditorRef.current?.flushChanges();rightEditorRef.current?.flushChanges()});
        if (tabIds.length === 0) {
            return true;
        }
        const openTabIdSet = new Set(openTabsRef.current.map((tab) => tab.id));
        const uniqueTabIds: string[] = [];
        for (const tabId of tabIds) {
            if (!openTabIdSet.has(tabId) || uniqueTabIds.includes(tabId)) {
                continue;
            }
            uniqueTabIds.push(tabId);
        }
        if (uniqueTabIds.length === 0) {
            return true;
        }
        for (const tabId of uniqueTabIds) {
            const canClose = await confirmCloseTab(tabId);
            if (!canClose) {
                return false;
            }
        }
        const closeSet = new Set(uniqueTabIds);
        setOpenTabs((prev) => prev.filter((tab) => !closeSet.has(tab.id)));
        for (const tabId of uniqueTabIds) {
            dispatchWorkspace({ type: 'CLOSE_TAB', tabId });
        }
        setTabContextMenu(null);
        return true;
    };
    const closeAllEditorTabs = async (): Promise<boolean> => {
        return await closeEditorTabs(openTabsRef.current.map((tab) => tab.id));
    };
    const closeOtherEditorTabs = async (keepTabId: string): Promise<boolean> => {
        return await closeEditorTabs(openTabsRef.current.filter((tab) => tab.id !== keepTabId).map((tab) => tab.id));
    };
    const openNoteInCurrentEditor = async (path: string, suggestedTitle?: string) => {
        const focusedPane = workspaceStateRef.current.lastFocusedPane;
        const focusedTabId = getActiveTabIdForPane(workspaceStateRef.current, focusedPane);
        const currentTab = focusedTabId ? openTabsRef.current.find((tab) => tab.id === focusedTabId) ?? null : null;
        const currentNoteTab = currentTab?.kind === 'note' ? currentTab : null;
        const currentPath = currentNoteTab?.path ?? '';
        if (currentNoteTab && toNoteId(currentPath) !== toNoteId(path)) {
            const canCloseCurrent = await confirmCloseTab(currentNoteTab.id);
            if (!canCloseCurrent) {
                return;
            }
        }
        await openNoteInTab(path, suggestedTitle, {
            targetPane: focusedPane,
            replacePath: currentPath && toNoteId(currentPath) !== toNoteId(path) ? currentPath : '',
        });
    };
    const openWikiLinkInEditor = useCallback((rawTarget: string, paneId?: PaneId) => {
        const normalizedTarget = normalizeRelatedCandidate(rawTarget);
        if (!normalizedTarget) {
            return;
        }
        const lookup = normalizeWikiLookup(normalizedTarget);
        const relativeMatches = explorerRows.filter((row) => {
            const relativePath = getRelativeVaultPath(row.path, vaultPath).replace(/\.md$/i, '');
            return normalizeWikiLookup(relativePath) === lookup;
        });
        const titleMatches = relativeMatches.length > 0
            ? relativeMatches
            : explorerRows.filter((row) => normalizeWikiLookup(toNoteDisplayName(row.path)) === lookup);
        if (titleMatches.length === 0) {
            setWarnMessage(`Wiki-Link nicht gefunden: ${normalizedTarget}`);
            return;
        }
        if (titleMatches.length > 1) {
            setWarnMessage(`Wiki-Link ist nicht eindeutig: ${normalizedTarget}`);
            return;
        }
        const match = titleMatches[0];
        if (!match) {
            return;
        }
        void openNoteInTab(match.path, match.title || toNoteDisplayName(match.path), {
            initialNoteType: normalizeNoteTypeValue(match.note_type),
            targetPane: paneId ?? workspaceStateRef.current.lastFocusedPane,
        });
    }, [explorerRows, openNoteInTab, setWarnMessage, vaultPath]);
    const revealActiveNoteInExplorer = () => {
        if (!activeTab || activeTab.kind !== 'note') {
            return;
        }
        setSidebarView('notes');
        setSidebarOpen(true);
        setExplorerRevealPath(activeTab.path);
        setExplorerRevealRequestId((prev) => prev + 1);
    };
    const showNoteInSplitView = (path: string) => {
        const tab = findTabByPath(path);
        if (!tab) {
            return;
        }
        const sourcePane = findPaneByTabId(workspaceStateRef.current, tab.id) ?? 'left';
        const targetPane: PaneId = sourcePane === 'left' ? 'right' : 'left';
        dispatchWorkspace({ type: 'INITIALIZE_SPLIT_LAYOUT' });
        dispatchWorkspace({
            type: 'MOVE_TAB_TO_OTHER_PANE',
            fromPaneId: sourcePane,
            toPaneId: targetPane,
            tabId: tab.id,
        });
        setTabContextMenu(null);
    };
    const updateNoteDocumentByPath = (tabPath: string, updater: (document: ParsedNoteDocument) => ParsedNoteDocument) => {
        setOpenTabs((prev) => {
            const targetIndex = prev.findIndex((tab) => tab.path === tabPath && tab.kind === 'note');
            if (targetIndex < 0) {
                return prev;
            }
            const targetTab = prev[targetIndex];
            if (!targetTab || targetTab.kind !== 'note') {
                return prev;
            }
            if (targetTab.readOnly) {
                return prev;
            }
            const parsed = targetTab.parsedDocument ?? parseNoteDocument(targetTab.content, targetTab.title || toNoteDisplayName(targetTab.path));
            const nextDocument = updater(parsed);
            if (nextDocument === parsed) {
                return prev;
            }
            const nextAutoTags = extractAutoTags(nextDocument.body);
            const nextAutoRelated = extractRelatedLinks(nextDocument.body);
            const normalizedDocument: ParsedNoteDocument = {
                ...nextDocument,
                frontmatter: {
                    ...nextDocument.frontmatter,
                    tags_auto: nextAutoTags,
                    related_auto: nextAutoRelated,
                },
            };
            const next = prev.slice();
            next[targetIndex] = {
                ...targetTab,
                title: normalizedDocument.frontmatter.title || targetTab.title,
                dirty: true,
                noteType: normalizeNoteTypeValue(normalizedDocument.frontmatter.type),
                parsedDocument: normalizedDocument,
            };
            return next;
        });
    };
    const updateNoteContentByPath = (tabPath: string, nextBody: string) => {
        updateNoteDocumentByPath(tabPath, (document) => (document.body === nextBody ? document : { ...document, body: nextBody }));
    };
    const updateNoteTitleByPath = (tabPath: string, nextTitle: string) => {
        const sanitizedTitle = nextTitle.replace(/[\r\n]+/g, ' ');
        updateNoteDocumentByPath(tabPath, (document) => {
            if (document.frontmatter.title === sanitizedTitle) {
                return document;
            }
            return {
                ...document,
                frontmatter: {
                    ...document.frontmatter,
                    title: sanitizedTitle,
                },
            };
        });
    };
    const updateNoteTypeByPath = (tabPath: string, nextType: 'note' | 'task') => {
        updateNoteDocumentByPath(tabPath, (document) => ({
            ...document,
            frontmatter: {
                ...document.frontmatter,
                type: nextType,
                // Keep task metadata stable across type toggles so values survive note <-> task switches.
                status: normalizeTaskStatusValue(document.frontmatter.status),
                priority: normalizeTaskPriorityValue(document.frontmatter.priority),
                due_date: document.frontmatter.due_date,
            },
        }));
    };
    const updateNoteStatusByPath = (tabPath: string, nextStatus: TaskStatus) => {
        updateNoteDocumentByPath(tabPath, (document) => ({
            ...document,
            frontmatter: {
                ...document.frontmatter,
                status: nextStatus,
            },
        }));
    };
    const updateNotePriorityByPath = (tabPath: string, nextPriority: TaskPriority) => {
        updateNoteDocumentByPath(tabPath, (document) => ({
            ...document,
            frontmatter: {
                ...document.frontmatter,
                priority: nextPriority,
            },
        }));
    };
    const updateNoteDueDateByPath = (tabPath: string, nextDueDate: string) => {
        const clean = normalizeLabel(nextDueDate);
        const normalized = clean && /^\d{4}-\d{2}-\d{2}$/.test(clean) ? clean : '';
        updateNoteDocumentByPath(tabPath, (document) => ({
            ...document,
            frontmatter: {
                ...document.frontmatter,
                due_date: normalized,
            },
        }));
    };
    const setTaskFieldErrorByPath = (tabPath: string, field: 'estimate_minutes' | 'follow_up_date', message: string) => {
        setPropertyTaskFieldErrorsByPath((prev) => {
            const current = prev[tabPath] || {};
            const nextForPath = { ...current, [field]: message || undefined };
            if (!nextForPath.estimate_minutes && !nextForPath.follow_up_date) {
                if (!(tabPath in prev)) {
                    return prev;
                }
                const next = { ...prev };
                delete next[tabPath];
                return next;
            }
            return { ...prev, [tabPath]: nextForPath };
        });
    };
    const updateNoteEstimateMinutesByPath = (tabPath: string, rawEstimateMinutes: string) => {
        const clean = normalizeLabel(rawEstimateMinutes);
        if (!clean) {
            setTaskFieldErrorByPath(tabPath, 'estimate_minutes', '');
            updateNoteDocumentByPath(tabPath, (document) => ({
                ...document,
                frontmatter: {
                    ...document.frontmatter,
                    estimate_minutes: null,
                },
            }));
            return;
        }
        const parsed = Number.parseInt(clean, 10);
        if (!Number.isFinite(parsed) || parsed <= 0) {
            setTaskFieldErrorByPath(tabPath, 'estimate_minutes', 'Bitte eine positive Zahl eingeben.');
            return;
        }
        setTaskFieldErrorByPath(tabPath, 'estimate_minutes', '');
        updateNoteDocumentByPath(tabPath, (document) => ({
            ...document,
            frontmatter: {
                ...document.frontmatter,
                estimate_minutes: Math.min(parsed, 10000),
            },
        }));
    };
    const updateNoteBlockedByIdsByPath = (tabPath: string, rawBlockedByIds: string) => {
        updateNoteDocumentByPath(tabPath, (document) => ({
            ...document,
            frontmatter: {
                ...document.frontmatter,
                blocked_by_ids: Array.from(new Set(rawBlockedByIds
                    .split(/[,\n;]+/)
                    .map((entry) => normalizeLabel(entry))
                    .filter(Boolean)
                    .filter((entry) => entry.toLowerCase() !== document.frontmatter.id.trim().toLowerCase()))),
            },
        }));
    };
    const updateNoteWaitingForByPath = (tabPath: string, rawWaitingFor: string) => {
        const normalized = rawWaitingFor.trim();
        updateNoteDocumentByPath(tabPath, (document) => ({
            ...document,
            frontmatter: {
                ...document.frontmatter,
                waiting_for: normalized,
            },
        }));
    };
    const updateNoteFollowUpDateByPath = (tabPath: string, rawFollowUpDate: string) => {
        const clean = normalizeLabel(rawFollowUpDate);
        if (!clean) {
            setTaskFieldErrorByPath(tabPath, 'follow_up_date', '');
            updateNoteDocumentByPath(tabPath, (document) => ({
                ...document,
                frontmatter: {
                    ...document.frontmatter,
                    follow_up_date: '',
                },
            }));
            return;
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(clean)) {
            setTaskFieldErrorByPath(tabPath, 'follow_up_date', 'Bitte ein gueltiges ISO-Datum eingeben.');
            return;
        }
        setTaskFieldErrorByPath(tabPath, 'follow_up_date', '');
        updateNoteDocumentByPath(tabPath, (document) => ({
            ...document,
            frontmatter: {
                ...document.frontmatter,
                follow_up_date: clean,
            },
        }));
    };
    const updateNoteBlockedReasonByPath = (tabPath: string, rawBlockedReason: string) => {
        const normalized = rawBlockedReason.trim();
        updateNoteDocumentByPath(tabPath, (document) => ({
            ...document,
            frontmatter: {
                ...document.frontmatter,
                blocked_reason: normalized,
            },
        }));
    };
    const updateNoteNextActionHintByPath = (tabPath: string, rawNextActionHint: string) => {
        const normalized = rawNextActionHint.trim();
        updateNoteDocumentByPath(tabPath, (document) => ({
            ...document,
            frontmatter: {
                ...document.frontmatter,
                next_action_hint: normalized,
            },
        }));
    };
    const addNoteTagByPath = (tabPath: string, rawTag: string) => {
        const normalized = normalizeTagCandidate(rawTag);
        if (!normalized) {
            return;
        }
        updateNoteDocumentByPath(tabPath, (document) => ({
            ...document,
            frontmatter: {
                ...document.frontmatter,
                tags: Array.from(new Set([...document.frontmatter.tags, normalized])).sort((left, right) => left.localeCompare(right, 'de', { sensitivity: 'base' })),
            },
        }));
    };
    const removeNoteTagByPath = (tabPath: string, tag: string) => {
        updateNoteDocumentByPath(tabPath, (document) => ({
            ...document,
            frontmatter: {
                ...document.frontmatter,
                tags: document.frontmatter.tags.filter((item) => item !== tag),
            },
        }));
    };
    const addNoteRelatedByPath = (tabPath: string, rawRelated: string) => {
        const normalized = normalizeRelatedCandidate(rawRelated);
        if (!normalized) {
            return;
        }
        updateNoteDocumentByPath(tabPath, (document) => ({
            ...document,
            frontmatter: {
                ...document.frontmatter,
                related: Array.from(new Set([...document.frontmatter.related, normalized])).sort((left, right) => left.localeCompare(right, 'de', { sensitivity: 'base' })),
            },
        }));
    };
    const removeNoteRelatedByPath = (tabPath: string, related: string) => {
        updateNoteDocumentByPath(tabPath, (document) => ({
            ...document,
            frontmatter: {
                ...document.frontmatter,
                related: document.frontmatter.related.filter((item) => item !== related),
            },
        }));
    };
    const openPropertyTagInput = (tabPath: string) => {
        setPropertyTagInputOpenByPath((prev) => ({ ...prev, [tabPath]: true }));
    };
    const closePropertyTagInput = (tabPath: string) => {
        setPropertyTagInputOpenByPath((prev) => ({ ...prev, [tabPath]: false }));
        setPropertyTagDraftByPath((prev) => ({ ...prev, [tabPath]: '' }));
    };
    const commitPropertyTagInput = (tabPath: string) => {
        const draft = propertyTagDraftByPath[tabPath] || '';
        if (!normalizeLabel(draft)) {
            closePropertyTagInput(tabPath);
            return;
        }
        addNoteTagByPath(tabPath, draft);
        closePropertyTagInput(tabPath);
    };
    const openPropertyRelatedInput = (tabPath: string) => {
        setPropertyRelatedInputOpenByPath((prev) => ({ ...prev, [tabPath]: true }));
    };
    const closePropertyRelatedInput = (tabPath: string) => {
        setPropertyRelatedInputOpenByPath((prev) => ({ ...prev, [tabPath]: false }));
        setPropertyRelatedDraftByPath((prev) => ({ ...prev, [tabPath]: '' }));
    };
    const commitPropertyRelatedInput = (tabPath: string) => {
        const draft = propertyRelatedDraftByPath[tabPath] || '';
        if (!normalizeLabel(draft)) {
            closePropertyRelatedInput(tabPath);
            return;
        }
        addNoteRelatedByPath(tabPath, draft);
        closePropertyRelatedInput(tabPath);
    };
    const renderNoteProperties = (tabPath: string, document: ParsedNoteDocument, compact = false) => {
        const tagDraft = propertyTagDraftByPath[tabPath] ?? '';
        const relatedDraft = propertyRelatedDraftByPath[tabPath] ?? '';
        const tagInputOpen = propertyTagInputOpenByPath[tabPath] ?? false;
        const relatedInputOpen = propertyRelatedInputOpenByPath[tabPath] ?? false;
        const taskFieldErrors = propertyTaskFieldErrorsByPath[tabPath] || {};
        const relatedOptionsForPath = propertyRelatedOptions.filter((item) => normalizeWikiLookup(item) !== normalizeWikiLookup(toNoteDisplayName(tabPath)));
        const currentTaskId = normalizeLabel(document.frontmatter.id).toLowerCase();
        const taskIdOptions = tasks
            .map((task) => normalizeLabel(task.id))
            .filter((taskId) => taskId && taskId.toLowerCase() !== currentTaskId)
            .sort((left, right) => left.localeCompare(right, 'de', { sensitivity: 'base' }));
        return (<NotePropertiesPanel tabPath={tabPath} document={document} compact={compact} taskStatusOptions={TASK_STATUS_OPTIONS} taskPriorityOptions={TASK_PRIORITY_OPTIONS} taskStatusDotClassName={taskStatusDotClassName} taskPriorityDotClassName={taskPriorityDotClassName} taskStatusOptionLabel={taskStatusOptionLabel} taskPriorityOptionLabel={taskPriorityOptionLabel} propertyTagOptions={propertyTagOptions} relatedOptions={relatedOptionsForPath} taskIdOptions={taskIdOptions} tagVisualByKey={tagVisualByKey} tagInputOpen={tagInputOpen} tagDraft={tagDraft} relatedInputOpen={relatedInputOpen} relatedDraft={relatedDraft} taskAdvancedHandlingEnabled={taskFeatureSettings.advancedTaskHandling} taskTimeManagementEnabled={taskFeatureSettings.taskTimeManagement} taskFieldErrors={taskFieldErrors} formatTimestamp={toGermanTimestamp} onTitleChange={(nextTitle) => {
                updateNoteTitleByPath(tabPath, nextTitle);
            }} onTitleBlur={(nextTitle) => {
                void syncNotePathWithTitle(tabPath, nextTitle);
            }} onTypeChange={(nextType) => {
                updateNoteTypeByPath(tabPath, nextType);
            }} onStatusChange={(nextStatus) => {
                updateNoteStatusByPath(tabPath, nextStatus);
            }} onPriorityChange={(nextPriority) => {
                updateNotePriorityByPath(tabPath, nextPriority);
            }} onDueDateChange={(nextDueDate) => {
                updateNoteDueDateByPath(tabPath, nextDueDate);
            }} onRemoveDueDate={() => {
                updateNoteDueDateByPath(tabPath, '');
            }} onEstimateMinutesChange={(nextEstimateMinutes) => {
                updateNoteEstimateMinutesByPath(tabPath, nextEstimateMinutes);
            }} onBlockedByIdsChange={(nextBlockedByIds) => {
                updateNoteBlockedByIdsByPath(tabPath, nextBlockedByIds);
            }} onWaitingForChange={(nextWaitingFor) => {
                updateNoteWaitingForByPath(tabPath, nextWaitingFor);
            }} onFollowUpDateChange={(nextFollowUpDate) => {
                updateNoteFollowUpDateByPath(tabPath, nextFollowUpDate);
            }} onBlockedReasonChange={(nextBlockedReason) => {
                updateNoteBlockedReasonByPath(tabPath, nextBlockedReason);
            }} onNextActionHintChange={(nextActionHint) => {
                updateNoteNextActionHintByPath(tabPath, nextActionHint);
            }} onOpenTagOverview={(rawTag) => {
                void openTagOverviewByReference(rawTag);
            }} onRemoveTag={(tag) => {
                removeNoteTagByPath(tabPath, tag);
            }} onOpenTagInput={() => {
                openPropertyTagInput(tabPath);
            }} onTagDraftChange={(value) => {
                setPropertyTagDraftByPath((prev) => ({ ...prev, [tabPath]: value }));
            }} onCommitTagInput={() => {
                commitPropertyTagInput(tabPath);
            }} onCloseTagInput={() => {
                closePropertyTagInput(tabPath);
            }} onRemoveRelated={(related) => {
                removeNoteRelatedByPath(tabPath, related);
            }} onOpenRelatedInput={() => {
                openPropertyRelatedInput(tabPath);
            }} onRelatedDraftChange={(value) => {
                setPropertyRelatedDraftByPath((prev) => ({ ...prev, [tabPath]: value }));
            }} onCommitRelatedInput={() => {
                commitPropertyRelatedInput(tabPath);
            }} onCloseRelatedInput={() => {
                closePropertyRelatedInput(tabPath);
            }}/>);
    };
    const syncNotePathWithTitle = async (tabPath: string, rawTitleOverride?: string) => {
        const tab = openTabsRef.current.find((entry) => entry.path === tabPath && entry.kind === 'note');
        if (!tab || tab.loading) {
            return;
        }
        const document = tab.parsedDocument ?? parseNoteDocument(tab.content, tab.title || toNoteDisplayName(tab.path));
        const typedTitle = normalizeLabel(rawTitleOverride ?? document.frontmatter.title);
        const targetTitle = typedTitle || 'Untitled';
        if (!typedTitle) {
            updateNoteTitleByPath(tabPath, targetTitle);
        }
        const currentStem = normalizeLabel(toNoteDisplayName(tab.path));
        if (currentStem.toLowerCase() === targetTitle.toLowerCase()) {
            return;
        }
        await renameExplorerFile(tab.path, targetTitle);
    };
    const uploadImageForNote = async (notePath: string, file: File): Promise<string | null> => {
        if (!notePath || !file) {
            return null;
        }
        try {
            const encoded = await readFileAsBase64(file);
            const response = await apiRequest<MediaUploadResponse>(backendUrl, '/notes/media/add', {
                method: 'POST',
                body: JSON.stringify({
                    path: notePath,
                    fileName: file.name || 'image',
                    contentType: file.type || '',
                    dataBase64: encoded,
                }),
            });
            const altText = deriveImageAltText(file.name || response.fileName);
            return `![${altText}](${response.markdownPath})`;
        }
        catch (caught) {
            setError(String(caught));
            return null;
        }
    };
    const toggleFolder = (folderKey: string) => {
        setExpandedFolders((prev) => ({ ...prev, [folderKey]: !prev[folderKey] }));
    };
    const setFolderOpen = useCallback((folderKey: string) => {
        setExpandedFolders((prev) => ({ ...prev, [folderKey]: true }));
    }, []);
    const handleExplorerViewStateChange = useCallback((nextState: ExplorerViewState) => {
        if (areExplorerViewStatesEqual(explorerViewStateRef.current, nextState)) {
            return;
        }
        explorerViewStateRef.current = nextState;
        setExplorerViewState(nextState);
        if (!vaultLoaded || !uiSettingsReadyRef.current) {
            return;
        }
        if (explorerViewSaveTimerRef.current) {
            window.clearTimeout(explorerViewSaveTimerRef.current);
        }
        explorerViewSaveTimerRef.current = window.setTimeout(() => {
            void saveUiSettingsPatch({ explorer: nextState }).catch(() => {
                // Best effort.
            });
        }, 250);
    }, [saveUiSettingsPatch, vaultLoaded]);
    const remapOpenNotePaths = useCallback((fromPrefix: string, toPrefix: string) => {
        const cleanFrom = normalizePath(fromPrefix);
        const cleanTo = normalizePath(toPrefix);
        if (!cleanFrom || !cleanTo || cleanFrom === cleanTo) {
            return;
        }
        const rewritePath = (path: string): string => {
            if (!path) {
                return path;
            }
            const normalized = normalizePath(path);
            const lower = normalized.toLowerCase();
            const fromLower = cleanFrom.toLowerCase();
            if (lower !== fromLower && !lower.startsWith(`${fromLower}/`)) {
                return path;
            }
            return `${cleanTo}${normalized.slice(cleanFrom.length)}`;
        };
        setOpenTabs((prev) => prev.map((tab) => {
            if (tab.kind !== 'note') {
                return tab;
            }
            const nextPath = rewritePath(tab.path);
            if (nextPath === tab.path) {
                return tab;
            }
            return {
                ...tab,
                path: nextPath,
                title: toNoteDisplayName(nextPath),
            };
        }));
    }, []);
    const closeTagActionDialog = (actionId: string) => {
        const current = tagActionDialogRef.current;
        if (!current) {
            return;
        }
        const payload: TagActionDialogResult = {
            actionId,
            value: current.value,
            groupValues: current.groupValues,
            tagValues: current.tagValues,
        };
        // Complete the action before the next input event can issue it again.
        // A timer leaves a closed dialog's command temporarily marked as running.
        tagActionDialogRef.current = null;
        setTagActionDialog(null);
        current.resolve(payload);
    };
    const askTagChoice = useCallback(async (title: string, message: string, actions: TagActionDialogAction[]): Promise<string | null> => {
        const result = await openTagActionDialog({
            kind: 'choice',
            title,
            message,
            actions: [...actions, { id: 'cancel', label: 'Abbrechen' }],
        });
        if (result.actionId === 'cancel') {
            return null;
        }
        return result.actionId;
    }, [openTagActionDialog]);
    async function requestSaveBeforeNoteBaseSwitch(): Promise<boolean> {
        const dirtyTabs = openTabsRef.current.filter((tab) => tab.kind === 'note' && tab.dirty);
        if (!settingsDirtyRef.current && dirtyTabs.length === 0) {
            return true;
        }
        const decision = await askTagChoice('Ungespeicherte Aenderungen', 'Vor dem Wechsel der NoteBase speichern?', [
            { id: 'save', label: 'Speichern', tone: 'primary' },
            { id: 'discard', label: 'Nicht speichern', tone: 'danger' }
        ]);
        if (!decision) {
            return false;
        }
        if (decision === 'discard') {
            return true;
        }
        if (decision !== 'save') {
            return false;
        }
        if (settingsDirtyRef.current) {
            const settingsSaved = await saveSettings();
            if (!settingsSaved) {
                return false;
            }
        }
        for (const tab of dirtyTabs) {
            const saved = await saveTab(tab.path);
            if (!saved) {
                return false;
            }
        }
        return true;
    }
    const prepareCloseState = useEffectEvent(async ():Promise<boolean> => {
        const captureDraft=captureEditorRef.current?.getMarkdown()??captureText;
        flushSync(()=>{leftEditorRef.current?.flushChanges();rightEditorRef.current?.flushChanges();captureEditorRef.current?.flushChanges()});
        try{
            await window.nicknotes?.writeCaptureDraft?.(captureDraft);
        }catch(error){
            setError('Schnellerfassungsentwurf konnte vor dem Schließen nicht lokal gesichert werden: '+String(error));
            throw error;
        }
        return settingsDirtyRef.current||openTabsRef.current.some(tab=>tab.kind==='note'&&tab.dirty);
    });
    const requestSaveBeforeAppClose = useEffectEvent(async (): Promise<boolean> => {
        await prepareCloseState();
        if (settingsDirtyRef.current) {
            const settingsSaved = await saveSettings();
            if (!settingsSaved) {
                return false;
            }
        }
        const dirtyTabs = openTabsRef.current.filter((tab) => tab.kind === 'note' && tab.dirty);
        for (const tab of dirtyTabs) {
            const saved = await saveTab(tab.path);
            if (!saved) {
                return false;
            }
        }
        const remainingChanges=await prepareCloseState();
        if(remainingChanges)setWarnMessage('Es gibt neuere ungespeicherte Änderungen. Das Fenster bleibt geöffnet.');
        return !remainingChanges;
    });
    useEffect(() => {
        window.nicknotes?.setUnsavedChanges?.(hasUnsavedChanges);
    }, [hasUnsavedChanges]);
    useEffect(() => {
        const register = window.nicknotes?.onRequestSaveBeforeClose;
        if (!register) {
            return;
        }
        const cleanupCheck=window.nicknotes?.onRequestCloseState?.(requestId=>{
            void prepareCloseState().then(hasChanges=>{
                window.nicknotes?.respondCloseState?.(requestId,hasChanges);
            }).catch(()=>{
                // A failed capture write needs the same explicit save/discard choice.
                window.nicknotes?.respondCloseState?.(requestId,true);
            });
        });
        const cleanup = register((requestId) => {
            void requestSaveBeforeAppClose()
                .then((ok) => {
                window.nicknotes?.respondSaveBeforeClose?.(requestId,ok);
            })
                .catch(() => {
                window.nicknotes?.respondSaveBeforeClose?.(requestId,false);
            });
        });
        window.nicknotes?.setCloseGuardReady?.(true);
        return () => {
            window.nicknotes?.setCloseGuardReady?.(false);
            cleanupCheck?.();
            if (typeof cleanup === 'function') {
                cleanup();
            }
        };
    }, []);
    const openTagGroupFormDialog = useCallback(async (config: {
        title: string;
        message?: string;
        confirmLabel: string;
        initialValues: TagGroupFormValues;
        colorOnly?: boolean;
    }): Promise<TagGroupFormValues | null> => {
        const kind = config.colorOnly ? 'color-form' : 'group-form';
        const result = await openTagActionDialog({
            kind,
            title: config.title,
            message: config.message,
            initialGroupValues: config.initialValues,
            actions: [
                { id: 'confirm', label: config.confirmLabel, tone: 'primary' },
                { id: 'cancel', label: 'Abbrechen' }
            ],
        });
        if (result.actionId !== 'confirm' || !result.groupValues) {
            return null;
        }
        return {
            id: normalizeTagId(result.groupValues.id),
            displayName: normalizeLabel(result.groupValues.displayName),
            color: normalizeTagColor(result.groupValues.color),
        };
    }, [openTagActionDialog]);
    const openTagFormDialog = useCallback(async (config: {
        title: string;
        message?: string;
        confirmLabel: string;
        initialValues: TagFormValues;
        tagGroupOptions?: Array<{
            id: string;
            displayName: string;
        }>;
    }): Promise<TagFormValues | null> => {
        const result = await openTagActionDialog({
            kind: 'tag-form',
            title: config.title,
            message: config.message,
            initialTagValues: config.initialValues,
            tagGroupOptions: config.tagGroupOptions,
            actions: [
                { id: 'confirm', label: config.confirmLabel, tone: 'primary' },
                { id: 'cancel', label: 'Abbrechen' }
            ],
        });
        if (result.actionId !== 'confirm' || !result.tagValues) {
            return null;
        }
        return {
            groupId: result.tagValues.groupId ? normalizeTagId(result.tagValues.groupId) : undefined,
            newGroupId: result.tagValues.newGroupId ? normalizeTagId(result.tagValues.newGroupId) : undefined,
            newGroupDisplayName: normalizeLabel(result.tagValues.newGroupDisplayName ?? ''),
            id: normalizeTagId(result.tagValues.id),
            displayName: normalizeLabel(result.tagValues.displayName),
        };
    }, [openTagActionDialog]);
    // The service stores callbacks without mutating them; keep their manual memoization.
    /* eslint-disable react-hooks/preserve-manual-memoization */
    const tagManagementService = useMemo(() => new TagManagementService({
        getBackendUrl: () => backendUrl,
        getMergedTagGroups: () => mergedTagGroups,
        getMergedTagGroupsById: () => mergedTagGroupsById,
        openTagGroupFormDialog,
        openTagFormDialog,
        askTagChoice,
        emitMutation: emitMutationEvent,
    }, {
        setMessage,
        setError,
        setCounts,
        setCustomTagGroups,
        setFolderOpen,
    }), [
        backendUrl,
        emitMutationEvent,
        mergedTagGroups,
        mergedTagGroupsById,
        openTagGroupFormDialog,
        openTagFormDialog,
        askTagChoice,
        setCustomTagGroups,
        setError,
        setFolderOpen,
        setMessage
    ]);
    const createTagGroup = tagManagementService.createTagGroup;
    /* eslint-enable react-hooks/preserve-manual-memoization */
    const createTagInExistingGroup = tagManagementService.createTagInExistingGroup;
    const createTagFromEditorSelection = tagManagementService.createTagFromEditorSelection;
    const renameTagGroup = tagManagementService.renameTagGroup;
    const setTagGroupColor = tagManagementService.setTagGroupColor;
    const deleteTagGroup = tagManagementService.deleteTagGroup;
    const renameTag = tagManagementService.renameTag;
    const deleteTag = tagManagementService.deleteTag;
    const openTagMatchWorkflow = async () => {
        if (!vaultLoaded) {
            return;
        }
        openTagMatchWorkflowLoading();
        try {
            setError('');
            const response = await apiRequest<{
                items: TagMatchCandidate[];
                total: number;
            }>(backendUrl, '/tag-groups/match-candidates');
            resolveTagMatchWorkflowCandidates(response.items);
            setMessage(response.total > 0 ? `${response.total} moegliche Tag-Fundstellen gefunden.` : 'Keine offenen Tag-Fundstellen gefunden.');
        }
        catch (caught) {
            stopTagMatchWorkflowLoading();
            setError(String(caught));
        }
    };
    const skipActiveTagMatch = () => {
        skipTagMatch(activeTagMatch);
    };
    const applyTagMatches = async (matches: TagMatchCandidate[]) => {
        const uniqueMatches = Array.from(new Map(matches.map((item) => [item.id, item])).values());
        if (uniqueMatches.length === 0) {
            return;
        }
        const targetPathKeys = new Set(uniqueMatches.map((item) => normalizeFilePathKey(item.path)));
        const dirtyTargets = openTabsRef.current.filter((tab) => tab.kind === 'note' && tab.dirty && targetPathKeys.has(normalizeFilePathKey(tab.path)));
        if (dirtyTargets.length > 0) {
            setError('Bitte speichere offene geaenderte Notizen, bevor Tag-Fundstellen darin uebernommen werden.');
            return;
        }
        setTagMatchApplying(true);
        try {
            setError('');
            const response = await apiRequest<{
                applied: number;
                notesUpdated: number;
                paths: string[];
                counts: VaultCounts;
                tagGroups?: unknown;
            }>(backendUrl, '/tag-groups/apply-matches', {
                method: 'POST',
                body: JSON.stringify({ matches: uniqueMatches }),
            });
            setCounts(response.counts);
            if (response.tagGroups) {
                setCustomTagGroups(toStorageTagGroups(response.tagGroups));
            }
            setOpenTabs((tabs) => tabs.map((tab) => {
                if (tab.kind !== 'note' || !response.paths.some((path) => normalizeFilePathKey(path) === normalizeFilePathKey(tab.path))) {
                    return tab;
                }
                return { ...tab, dirty: false, loading: true };
            }));
            await emitMutationEvent({
                kind: 'notes-batch-updated',
                refresh: {
                    search: true,
                    tasks: true,
                    todos: true,
                    review: true,
                    noteGroups: true,
                    explorerSidebar: true,
                    focusAggregate: true,
                },
                paths: response.paths,
            });
            removeAppliedTagMatches(uniqueMatches);
            setMessage(`${response.applied} Fundstellen in ${response.notesUpdated} Notizen uebernommen.`);
        }
        catch (caught) {
            setTagMatchApplying(false);
            setError(String(caught));
        }
    };
    const applyActiveTagMatch = () => {
        if (activeTagMatch) {
            void applyTagMatches([activeTagMatch]);
        }
    };
    const applyActiveTagEverywhere = () => {
        if (!activeTagMatch) {
            return;
        }
        const matches = visibleTagMatchItems.filter((item) => item.groupId.toLowerCase() === activeTagMatch.groupId.toLowerCase() &&
            item.tagId.toLowerCase() === activeTagMatch.tagId.toLowerCase());
        void applyTagMatches(matches);
    };
    const applyAllTagMatches = () => {
        void applyTagMatches(visibleTagMatchItems);
    };

    useExternalChanges({backendUrl, vaultLoaded, tabs: openTabsRef, setTabs: setOpenTabs, setCounts,
        warn: setWarnMessage,
        refresh: async () => {
            setGraphUpdateToken(current => current + 1);
            await emitMutationEvent({kind: 'note-saved', refresh: {search: true, tasks: true, todos: true, review: true, noteGroups: true, explorerSidebar: true, focusAggregate: true}});
        },
    });
    const handleWorkspaceExternalDrop = (paneId: PaneId, payload: ExternalNoteDropPayload) => {
        void openNoteInTab(payload.path, payload.title, {
            targetPane: paneId,
        });
    };
    const handleActivatePaneTab = (paneId: PaneId, tabId: string) => {
        dispatchWorkspace({
            type: 'ACTIVATE_TAB',
            paneId,
            tabId,
        });
        setEditorPanelOpen(true);
    };
    const handleFocusPane = (paneId: PaneId, tabId?: string | null) => {
        dispatchWorkspace({
            type: 'SET_LAST_FOCUSED_PANE',
            paneId,
            tabId: tabId ?? null,
        });
    };
    const handleMoveTabWithinPane = (paneId: PaneId, fromIndex: number, toIndex: number) => {
        dispatchWorkspace({
            type: 'MOVE_TAB_WITHIN_PANE',
            paneId,
            fromIndex,
            toIndex,
        });
    };
    const handleMoveTabToOtherPane = (fromPaneId: PaneId, toPaneId: PaneId, tabId: string) => {
        dispatchWorkspace({
            type: 'MOVE_TAB_TO_OTHER_PANE',
            fromPaneId,
            toPaneId,
            tabId,
        });
    };
    const toggleSplitView = () => {
        dispatchWorkspace({ type: 'TOGGLE_SPLIT_MODE' });
    };
    const toggleEditorPanel = () => {
        setEditorPanelOpen((previous) => !previous);
    };
    const closeCapturePanel = () => {
        setCapturePanelOpen(false);
    };
    const openCaptureFromDock = () => {
        setCapturePinned(true);
        setCapturePanelOpen(true);
    };
    const handleOneNoteImportComplete = (response: {
        counts?: VaultCounts;
        tagGroups?: unknown;
        groups?: NoteGroup[];
        import?: {
            importedPages?: number;
            reportPath?: string;
        };
    }) => {
        if (response.counts) {
            setCounts(response.counts);
        }
        if (response.tagGroups) {
            setCustomTagGroups(toStorageTagGroups(response.tagGroups));
        }
        if (response.groups) {
            setNoteGroups(response.groups);
        }
        const importedPages = response.import?.importedPages ?? 0;
        setMessage(`OneNote-Import abgeschlossen: ${importedPages} Seiten importiert.`);
        setError('');
        void emitMutationEvent({
            kind: 'import-completed',
            refresh: {
                search: true,
                tasks: true,
                todos: true,
                review: true,
                noteGroups: true,
                explorerSidebar: true,
            },
        });
    };
    const openSidebarView = (view: SidebarView) => {
        if (sidebarView === view) {
            setSidebarOpen((prev) => !prev);
            return;
        }
        setSidebarView(view);
        setSidebarOpen(true);
    };
    const renderWorkspacePaneContent = (paneId: PaneId, paneTab: NoteTab | null) => {
        if (!paneTab) {
            return null;
        }
        if (paneTab.loading) {
            return <p className="empty-copy">Lade Notiz ...</p>;
        }
        if (paneTab.kind === 'todo_dashboard') {
            return (<TodoDashboardCanvas todos={todos} tasks={tasks} tagGroups={mergedTagGroups} filters={todoDashboardFilters} onToggleTodo={(todoId, checked) => {
                    void toggleTodo(todoId, checked);
                }} onOpenOrigin={(path, title) => {
                    void openTodoOrigin(path, title);
                }} onOpenTagOverview={(tagKey) => {
                    void openTagOverviewByReference(tagKey);
                }} onPromoteTodo={(todoId) => {
                    void promoteTodo(todoId);
                }} onOpenTaskPath={(path, title) => {
                    if (!path) {
                        return;
                    }
                    void openNoteInTab(path, title, { initialNoteType: 'task' });
                }}/>);
        }
        if (paneTab.kind === 'task_dashboard') {
            return (<TaskDashboardCanvas tasks={tasks} filters={taskDashboardFilters} tagGroups={mergedTagGroups} onFiltersChange={setTaskDashboardFilters} onOpenTaskPath={(path, title) => {
                    if (!path) {
                        return;
                    }
                    void openNoteInTab(path, title, { initialNoteType: 'task' });
                }} taskStatusClassName={taskStatusClassName} taskStatusLabel={taskStatusLabel} taskPriorityDotClassName={taskPriorityDotClassName} taskPriorityLabel={taskPriorityLabel} toGermanTimestamp={toGermanTimestamp}/>);
        }
        if (paneTab.kind === 'focus_dashboard') {
            return (<FocusDashboardCanvas tasks={tasks} todos={todos} notes={allNotes} noteBasePath={vaultPath} filters={focusDashboardFilters} mitIds={focusMitIds} focusStats={focusDashboardStats} taskFeatureSettings={taskFeatureSettings} onFiltersChange={setFocusDashboardFilters} onSaveMit={saveFocusMit} onQuickCaptureTodo={quickCaptureFocusTodo} onOpenTaskPath={(path, title) => {
                    if (!path) {
                        return;
                    }
                    void openNoteInTab(path, title, { initialNoteType: 'task' });
                }} onOpenTodoOrigin={(path, title) => {
                    if (!path) {
                        return;
                    }
                    void openNoteInTab(path, title, { initialNoteType: 'note' });
                }} onOpenNotePath={(path, title, noteType) => {
                    if (!path) {
                        return;
                    }
                    void openNoteInTab(path, title, { initialNoteType: noteType === 'task' ? 'task' : 'note' });
                }} toGermanTimestamp={toGermanTimestamp}/>);
        }
        if (paneTab.kind === 'review_dashboard') {
            return (<ReviewDashboardCanvas data={reviewDashboardData} filters={reviewDashboardFilters} onFiltersChange={setReviewDashboardFilters} onOpenNotePath={(path, title, noteType) => {
                    if (!path) {
                        return;
                    }
                    void openNoteInTab(path, title, { initialNoteType: noteType === 'task' ? 'task' : 'note' });
                }}/>);
        }
        if (paneTab.kind === 'graph_dashboard') {
            return <Suspense fallback={<p>Graph wird geladen ...</p>}><GraphDashboardCanvas /></Suspense>;
        }
        const document = paneTab.parsedDocument ?? parseNoteDocument(paneTab.content, paneTab.title || toNoteDisplayName(paneTab.path));
        const isReadOnlyNote = Boolean(paneTab.readOnly);
        const readOnlyTitle = normalizeLabel(document.frontmatter.title) || paneTab.title || toNoteDisplayName(paneTab.path);
        return (<div className="note-editor-shell" data-note-path={paneTab.path} data-note-revision={paneTab.revision}>
        <div className={`note-flow-content ${workspaceState.layoutMode === 'split' ? 'split-note-flow-content' : ''}`}>
          {isReadOnlyNote ? (<section className={`note-readonly-banner ${workspaceState.layoutMode === 'split' ? 'split-note-readonly-banner' : ''}`}>
              <h2>{readOnlyTitle}</h2>
              <p>Diese Notiz wird automatisch aus allen Tag-Verwendungen generiert und kann nicht manuell bearbeitet werden.</p>
            </section>) : (renderNoteProperties(paneTab.path, document, workspaceState.layoutMode === 'split'))}
          <CodeMirrorMarkdownEditor key={`editor-${paneId}-${paneTab.id}`} className={`note-body-editor ${workspaceState.layoutMode === 'split' ? 'split-note-body-editor' : ''}`} embeddedInScroll value={document.body} theme={theme} notePath={paneTab.path} backendUrl={backendUrl} readOnly={isReadOnlyNote} tagGroups={mergedTagGroups} linkTargets={markdownLinkTargets} searchHighlightQuery={explorerFilterQuery} onChange={(nextContent) => {
                if (isReadOnlyNote) {
                    return;
                }
                dispatchWorkspace({
                    type: 'SET_LAST_FOCUSED_PANE',
                    paneId,
                    tabId: paneTab.id,
                });
                updateNoteContentByPath(paneTab.path, nextContent);
            }} onInsertImageAsset={(file) => {
                if (isReadOnlyNote) {
                    return Promise.resolve(null);
                }
                return uploadImageForNote(paneTab.path, file);
            }} onOpenWikiLink={(target) => {
                openWikiLinkInEditor(target, paneId);
            }} onOpenTagReference={(groupId, tagId) => {
                void openTagOverviewByReference(`${groupId}:${tagId}`, { targetPane: paneId });
            }} onCreateTagFromSelection={(selectedText, replaceSelection) => {
                void createTagFromEditorSelection(selectedText, replaceSelection);
            }} editorApiRef={paneId === 'left' ? leftEditorRef : rightEditorRef}/>
        </div>
      </div>);
    };
    const showCaptureInline = capturePanelOpen && capturePinned;
    const workspaceGridClassName = [
        'workspace-grid',
        showCaptureInline ? 'with-capture-column' : ''
    ]
        .filter(Boolean)
        .join(' ');
    const workspaceGridStyle = {
        ...(showCaptureInline ? { '--capture-inline-height': `${captureInlineHeight}px` } : {}),
    } as CSSProperties;
    const createNoteBaseDialog = createNoteBaseDialogOpen ? (<div className="modal-overlay" onClick={() => {
            closeCreateNoteBaseDialog();
        }}>
      <aside className="create-notebase-modal" onClick={(event) => {
            event.stopPropagation();
        }} onKeyDown={(event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                closeCreateNoteBaseDialog();
            }
        }}>
        <header className="sidebar-header-row">
          <h3>Neue NoteBase erstellen</h3>
        </header>
        <p className="muted-copy">Lege Name, Speicherort und Anrede fuer die neue NoteBase fest.</p>
        <form className="create-notebase-form" onSubmit={(event) => {
            event.preventDefault();
            void submitCreateNoteBaseDialog();
        }}>
          <label className="create-notebase-label" htmlFor="create-notebase-display-name">
            Anrede
          </label>
          <input id="create-notebase-display-name" value={createNoteBaseDisplayName} onChange={(event) => {
            setCreateNoteBaseDisplayName(normalizeLabel(event.target.value));
        }} placeholder={`z. B. ${DEFAULT_DISPLAY_NAME}`} autoFocus/>

          <label className="create-notebase-label" htmlFor="create-notebase-name">
            NoteBase-Name
          </label>
          <input id="create-notebase-name" value={createNoteBaseName} onChange={(event) => {
            setCreateNoteBaseName(normalizeLabel(event.target.value));
        }} placeholder={`z. B. ${DEFAULT_NOTEBASE_NAME}`}/>

          <label className="create-notebase-label" htmlFor="create-notebase-parent-path">
            Speicherort
          </label>
          <div className="create-notebase-path-row">
            <input id="create-notebase-parent-path" value={createNoteBaseParentPath} onChange={(event) => {
            setCreateNoteBaseParentPath(event.target.value);
        }} placeholder="Ordner fuer die neue NoteBase"/>
            <button type="button" onClick={() => {
            void chooseCreateNoteBaseParentDirectory();
        }} disabled={createNoteBasePending}>
              Ordner waehlen
            </button>
          </div>

          <div className="create-notebase-modal-actions">
            <button type="button" onClick={closeCreateNoteBaseDialog} disabled={createNoteBasePending}>
              Abbrechen
            </button>
            <button type="submit" className="primary" disabled={createNoteBasePending}>
              {createNoteBasePending ? 'Wird erstellt ...' : 'NoteBase erstellen'}
            </button>
          </div>
        </form>
      </aside>
    </div>) : null;
    const settingsDialog = settingsDialogOpen ? (<Suspense fallback={<p role="status">Einstellungen werden geladen ...</p>}><SettingsEditorPanel displayName={displayName} theme={theme} activeColorProfileId={activeColorProfileId} colorProfiles={colorProfiles} backendUrl={backendUrl} vaultLoaded={vaultLoaded} sidebarOpen={sidebarOpen} explorerOptions={explorerOptions} statusBarPrefs={statusBarPrefs} taskFeatureSettings={taskFeatureSettings} settingsDirty={settingsDirty} onClose={closeSettingsDialog} setSidebarOpen={setSidebarOpen} setExplorerOptions={setExplorerOptions} setStatusBarPrefs={setStatusBarPrefs} setTaskFeatureSettings={setTaskFeatureSettings} onDisplayNameChange={setSettingsDisplayName} onActiveColorProfileChange={handleActiveColorProfileChange} onColorProfilesChange={setSettingsColorProfiles} onSave={requestSaveSettings} onDiscard={discardSettings} onOneNoteImportComplete={handleOneNoteImportComplete}/></Suspense>) : null;
    const renderTagMatchPreview = (match: TagMatchCandidate, mode: 'before' | 'after') => (<div className="tag-match-editor-preview">
      <span className="tag-match-context">{match.before}</span>
      {mode === 'before' ? (<mark className="tag-match-highlight">{match.matchedText}</mark>) : (<span className="cm-md-inline-tag-chip tag-match-chip" style={{ '--cm-md-tag-color': match.groupColor } as CSSProperties} title={`${match.groupDisplayName} / ${match.tagDisplayName}`}>
          {match.tagDisplayName}
        </span>)}
      <span className="tag-match-context">{match.after}</span>
    </div>);
    const tagMatchWorkflowModal = tagMatchWorkflow.open ? (<div className="modal-overlay tag-match-overlay" onClick={() => {
            closeTagMatchWorkflow();
        }}>
      <aside className="tag-match-modal" onClick={(event) => {
            event.stopPropagation();
        }} onKeyDown={(event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                closeTagMatchWorkflow();
            }
            if (event.key === 'ArrowRight') {
                event.preventDefault();
                moveTagMatchCursor(1);
            }
            if (event.key === 'ArrowLeft') {
                event.preventDefault();
                moveTagMatchCursor(-1);
            }
        }}>
        <header className="tag-match-header">
          <div>
            <h3>Tag-Fundstellen pruefen</h3>
            <p>
              {tagMatchWorkflow.loading
            ? 'NoteBase wird durchsucht ...'
            : activeTagMatch
                ? `${activeTagMatch.relativePath} - Zeile ${activeTagMatch.line}`
                : 'Keine offenen Fundstellen.'}
            </p>
          </div>
          <button className="icon-button compact muted" onClick={closeTagMatchWorkflow} title="Schliessen">
            <LucideNamedIcon name="X" size={14}/>
          </button>
        </header>

        {tagMatchWorkflow.loading ? <div className="tag-match-empty">Suche laeuft ...</div> : null}

        {!tagMatchWorkflow.loading && activeTagMatch ? (<>
            <div className="tag-match-summary-row">
              <span>
                Treffer {Math.min(tagMatchWorkflow.cursor + 1, visibleTagMatchItems.length)} von {visibleTagMatchItems.length}
              </span>
              <span>
                {activeTagMatch.groupDisplayName} / {activeTagMatch.tagDisplayName}
              </span>
            </div>

            <div className="tag-match-compare-grid">
              <section>
                <h4>Vorher</h4>
                {renderTagMatchPreview(activeTagMatch, 'before')}
              </section>
              <section>
                <h4>Nachher</h4>
                {renderTagMatchPreview(activeTagMatch, 'after')}
              </section>
            </div>

            <footer className="tag-match-actions">
              <div className="tag-match-nav-actions">
                <button type="button" onClick={() => moveTagMatchCursor(-1)} disabled={visibleTagMatchItems.length <= 1}>
                  <LucideNamedIcon name="ChevronLeft" size={14}/>
                </button>
                <button type="button" onClick={() => moveTagMatchCursor(1)} disabled={visibleTagMatchItems.length <= 1}>
                  <LucideNamedIcon name="ChevronRight" size={14}/>
                </button>
              </div>
              <div className="tag-match-apply-actions">
                <button type="button" onClick={skipActiveTagMatch} disabled={tagMatchWorkflow.applying}>
                  Ueberspringen
                </button>
                <button type="button" onClick={applyActiveTagEverywhere} disabled={tagMatchWorkflow.applying}>
                  Diesen Tag ueberall
                </button>
                <button type="button" onClick={applyAllTagMatches} disabled={tagMatchWorkflow.applying}>
                  Alle uebernehmen
                </button>
                <button type="button" className="primary" onClick={applyActiveTagMatch} disabled={tagMatchWorkflow.applying}>
                  Uebernehmen
                </button>
              </div>
            </footer>
          </>) : null}

        {!tagMatchWorkflow.loading && !activeTagMatch ? (<div className="tag-match-empty">
            <p>Keine Fundstellen mehr offen.</p>
            <button type="button" onClick={closeTagMatchWorkflow}>
              Fertig
            </button>
          </div>) : null}
      </aside>
    </div>) : null;
    // The service stores callbacks without mutating them; keep their manual memoization.
    /* eslint-disable react-hooks/preserve-manual-memoization */
    const explorerMutationService = useMemo(() => new ExplorerMutationService({
        getBackendUrl: () => backendUrl,
        getVaultLoaded: () => vaultLoaded,
        getNoteGroupsByKey: () => noteGroupsByKey,
        openNoteInTab: (path, title, options) => openNoteInTab(path, title, options),
        emitMutation: emitMutationEvent,
        remapOpenNotePaths,
    }, {
        setMessage,
        setError,
        setCounts,
        setNoteGroups,
        setOpenTabs,
        setCustomTagGroups,
    }), [
        backendUrl,
        emitMutationEvent,
        noteGroupsByKey,
        openNoteInTab,
        remapOpenNotePaths,
        setError,
        setMessage,
        vaultLoaded
    ]);
    const createExplorerFolder = explorerMutationService.createExplorerFolder;
    /* eslint-enable react-hooks/preserve-manual-memoization */
    const createExplorerFile = explorerMutationService.createExplorerFile;
    const createExplorerTask = explorerMutationService.createExplorerTask;
    const renameExplorerFolder = explorerMutationService.renameExplorerFolder;
    const moveExplorerFolder = explorerMutationService.moveExplorerFolder;
    const deleteExplorerFolder = explorerMutationService.deleteExplorerFolder;
    const toggleFavoriteFolder = explorerMutationService.toggleFavoriteFolder;
    const renameExplorerFile = explorerMutationService.renameExplorerFile;
    const moveExplorerFiles = explorerMutationService.moveExplorerFiles;
    const moveExplorerFile = explorerMutationService.moveExplorerFile;
    const deleteExplorerFile = explorerMutationService.deleteExplorerFile;
    const [editorFocusRequest,setEditorFocusRequest]=useState<{pane:PaneId}|null>(null);
    const focusEditorSoon = (pane:PaneId=workspaceStateRef.current.lastFocusedPane) => setEditorFocusRequest({pane});
    useEffect(()=>{
        if(!editorFocusRequest||!editorPanelOpen)return;
        const {pane}=editorFocusRequest,tab=paneActiveTabs[pane];
        if(tab?.loading)return;
        const frame=window.requestAnimationFrame(()=>{
            const editor=pane==='left'?leftEditorRef.current:rightEditorRef.current;
            if(editor)editor.focus();else document.querySelector<HTMLElement>(`[data-pane-id="${pane}"]`)?.focus();
            setEditorFocusRequest(current=>current===editorFocusRequest?null:current);
        });
        return()=>window.cancelAnimationFrame(frame);
    },[editorFocusRequest,editorPanelOpen,paneActiveTabs]);
    const focusPane = (paneId:PaneId) => {
        setEditorPanelOpen(true);
        if (paneId==='right' && workspaceStateRef.current.layoutMode!=='split') dispatchWorkspace({type:'TOGGLE_SPLIT_MODE',enabled:true});
        dispatchWorkspace({type:'SET_LAST_FOCUSED_PANE',paneId,tabId:workspaceStateRef.current.panes[paneId].activeTabId});
        focusEditorSoon(paneId);
    };
    const focusedEditor = () => document.activeElement?.closest('.capture-markdown-editor') ? captureEditorRef.current : (activePaneId==='left'?leftEditorRef.current:rightEditorRef.current) ?? captureEditorRef.current;
    const editText = async (action:'undo'|'redo'|'cut'|'copy'|'paste'|'selectAll') => {
        if(document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement) {
            await window.nicknotes?.editText?.(action);
        } else await focusedEditor()?.edit(action);
    };
    const createDocument = async (kind:'note'|'task') => {
        const relative=activeTab?.kind==='note'?getRelativeVaultPath(activeTab.path,vaultPath):'';
        const folder=relative.includes('/')?relative.slice(0,relative.lastIndexOf('/')):'';
        const group=noteGroupsByKey.get(folder)?.canCreateNotes===false?'':folder;
        const base=kind==='note'?'Neue Notiz':'Neuer Task';
        const titles=new Set(explorerRows.map(row=>row.title.toLocaleLowerCase()));
        let title=base;let number=2;
        while(titles.has(title.toLocaleLowerCase()))title=`${base} ${number++}`;
        setEditorPanelOpen(true);
        await (kind==='note'?createExplorerFile:createExplorerTask)(group,title);
        focusEditorSoon();
    };
    const saveAllDocuments = async () => {
        flushSync(()=>{leftEditorRef.current?.flushChanges();rightEditorRef.current?.flushChanges()});
        if(settingsDirtyRef.current && !await saveSettings())return;
        for(const tab of openTabsRef.current.filter(tab=>tab.kind==='note'&&tab.dirty&&!tab.readOnly)) {
            if(!await saveTab(tab.path))return; // A conflict must leave all remaining drafts intact.
        }
    };
    const deleteCurrentDocument = async () => {
        const tab=activeTab;
        if(!tab||tab.kind!=='note'||tab.readOnly)return;
        const choice=await askTagChoice('Datei löschen',`„${tab.title}“ wirklich löschen?${tab.dirty?' Auch die ungespeicherten Änderungen werden verworfen.':''}`, [{id:'delete',label:'Datei löschen',tone:'danger'}]);
        if(choice==='delete')await deleteExplorerFile(tab.path);
    };
    const selectAdjacentTab = (direction:number) => {
        const pane=workspaceStateRef.current.lastFocusedPane;
        const state=workspaceStateRef.current.panes[pane];
        const index=state.tabIds.indexOf(state.activeTabId??'');
        const next=state.tabIds[(index+direction+state.tabIds.length)%state.tabIds.length];
        if(next)dispatchWorkspace({type:'ACTIVATE_TAB',paneId:pane,tabId:next});
        focusEditorSoon(pane);
    };
    const showSidebar = (view:SidebarView) => {setSidebarView(view);setSidebarOpen(true)};
    const focusCapture = () => {setCapturePinned(true);setCapturePanelOpen(true);window.requestAnimationFrame(()=>window.requestAnimationFrame(()=>captureEditorRef.current?.focus()))};
    const commandHandlers:Record<CommandId,()=>unknown> = {
        newNote:()=>createDocument('note'),newTask:()=>createDocument('task'),
        openNote:()=>vaultLoaded?setQuickOpen(true):pickAndOpenVault(),openVault:pickAndOpenVault,newVault:createVault,daily:openOrCreateTodayDaily,
        save:()=>settingsDialogOpen?saveSettings():activeTab?saveTab(activeTab.path):undefined,saveAll:saveAllDocuments,deleteNote:deleteCurrentDocument,
        closeTab:()=>activeTab?closeEditorTab(activeTab.id):undefined,settings:openSettingsDialog,
        quit:()=>{flushSync(()=>{leftEditorRef.current?.flushChanges();rightEditorRef.current?.flushChanges()});window.nicknotes?.setUnsavedChanges?.(settingsDirtyRef.current||openTabsRef.current.some(tab=>tab.dirty));return window.nicknotes?.windowAction?.('close')},
        undo:()=>editText('undo'),redo:()=>editText('redo'),cut:()=>editText('cut'),copy:()=>editText('copy'),paste:()=>editText('paste'),selectAll:()=>editText('selectAll'),
        find:()=>focusedEditor()?.find(),format:()=>focusedEditor()?.openCommandPalette(),
        search:()=>{showSidebar('notes');window.requestAnimationFrame(()=>document.querySelector<HTMLInputElement>('.explorer-toolbar-search input')?.focus())},
        closeOthers:()=>activeTab?closeOtherEditorTabs(activeTab.id):undefined,closeAll:closeAllEditorTabs,
        split:()=>{setEditorPanelOpen(true);toggleSplitView()},leftPane:()=>focusPane('left'),rightPane:()=>focusPane('right'),switchPane:()=>focusPane(activePaneId==='left'?'right':'left'),
        nextTab:()=>selectAdjacentTab(1),previousTab:()=>selectAdjacentTab(-1),sidebar:()=>setSidebarOpen(value=>!value),editor:toggleEditorPanel,
        capture:()=>{setCapturePinned(true);setCapturePanelOpen(value=>!value)},focusCapture,
        notes:()=>showSidebar('notes'),todos:()=>{showSidebar('todos');openTodoDashboardTab()},tasks:()=>{showSidebar('tasks');openTaskDashboardTab()},
        focus:()=>{showSidebar('focus');openFocusDashboardTab()},tags:()=>showSidebar('tags'),review:()=>{showSidebar('review');openReviewDashboardTab()},graph:()=>{showSidebar('graph');openGraphDashboardTab()},vault:()=>showSidebar('vault'),
        fullscreen:()=>window.nicknotes?.windowAction?.('fullscreen'),help:()=>setShortcutHelp(true),
    };
    const appCommands:AppCommand[]=COMMANDS.map(spec=>{
        let enabled=vaultLoaded;
        if(['openNote','openVault','newVault'].includes(spec.id))enabled=!noteBaseOpenStatus?.active;
        if(['quit','fullscreen','help'].includes(spec.id))enabled=true;
        if(['closeTab','closeOthers','nextTab','previousTab'].includes(spec.id))enabled=Boolean(activeTab);
        if(spec.id==='closeAll')enabled=openTabs.length>0;
        if(spec.id==='switchPane')enabled=vaultLoaded&&workspaceState.layoutMode==='split';
        if(spec.id==='save')enabled=settingsDialogOpen||Boolean(activeTab?.kind==='note'&&!activeTab.readOnly&&!activeTab.loading);
        if(spec.id==='saveAll')enabled=settingsDirty||openTabs.some(tab=>tab.kind==='note'&&!tab.readOnly);
        if(spec.id==='deleteNote')enabled=Boolean(activeTab?.kind==='note'&&!activeTab.readOnly&&!activeTab.loading);
        if(['find','format'].includes(spec.id))enabled=Boolean(activeTab?.kind==='note'&&editorPanelOpen)||capturePanelOpen&&vaultLoaded;
        const checked=spec.id==='split'?workspaceState.layoutMode==='split':spec.id==='capture'?capturePanelOpen:spec.id==='sidebar'?sidebarOpen:spec.id==='editor'?editorPanelOpen:undefined;
        return {...spec,enabled,checked,run:commandHandlers[spec.id]};
    });
    const executeCommand=useAppCommands(appCommands,setError,settingsDialogOpen);
    const commandDialogs=<>{quickOpen&&<QuickOpenDialog backendUrl={backendUrl} vaultPath={vaultPath} onClose={()=>setQuickOpen(false)} onOpen={async(path,title)=>{setEditorPanelOpen(true);await openNoteInTab(path,title);focusEditorSoon()}}/>}{shortcutHelp&&<ShortcutHelpDialog onClose={()=>setShortcutHelp(false)}/>}</>;
    const windowTitlebar = (<div className="window-titlebar">
      <div className="window-titlebar-brand" aria-label="NickNotes"><span className="window-titlebar-logo">NN</span><span className="window-titlebar-title">NickNotes</span></div>
      <AppMenuBar commands={appCommands} execute={executeCommand}/>
    </div>);
    const noteBaseProgressTotal = noteBaseOpenStatus?.total ?? 0;
    const noteBaseProgressProcessed = noteBaseOpenStatus?.processed ?? 0;
    const noteBaseProgressPercent = noteBaseProgressTotal > 0 ? Math.min(100, Math.round((noteBaseProgressProcessed / noteBaseProgressTotal) * 100)) : 0;
    const noteBaseProgressLabel = noteBaseOpenStatus && noteBaseProgressTotal > 0
        ? `${noteBaseProgressProcessed} von ${noteBaseProgressTotal} Dateien`
        : 'Fortschritt wird ermittelt ...';
    const noteBaseProgressPath = noteBaseOpenStatus?.currentPath
        ? getRelativeVaultPath(noteBaseOpenStatus.currentPath, vaultPath)
        : '';
    if (!vaultLoaded) {
        return (<div className="window-frame">
        {windowTitlebar}
        <div className="window-content">
          <div className="launch-shell">
            <div className="launch-card">
              <h1>Hallo {displayName}</h1>
              <p>Waehle eine NoteBase aus und wir laden sie direkt automatisch.</p>

              <label htmlFor="launch-display-name" className="field-label">
                Anrede
              </label>
              <input id="launch-display-name" value={displayName} onChange={(event) => setSettingsDisplayName(event.target.value)} placeholder={`z. B. ${DEFAULT_DISPLAY_NAME}`}/>

              <div className="launch-actions">
                <button onClick={() => void pickAndOpenVault()} disabled={noteBaseOpenStatus?.active}>
                  NoteBase laden
                </button>
                <button onClick={() => void createVault()} disabled={noteBaseOpenStatus?.active}>
                  NoteBase erstellen
                </button>
                <button onClick={toggleThemeMode}>
                  {theme === 'light' ? 'Dark Mode' : 'Light Mode'}
                </button>
              </div>
              <label htmlFor="launch-capture-draft" className="field-label">Schnellerfassungsentwurf</label>
              <textarea id="launch-capture-draft" data-launch-capture value={captureText} onChange={event=>setCaptureText(event.target.value)} rows={7} placeholder="Gedanken festhalten, während die NoteBase geladen wird …"/>
              <small>Der Entwurf bleibt lokal erhalten. Nach dem Laden einer NoteBase kannst du ihn über Quick Capture absenden.</small>

              {noteBaseOpenStatus?.active || noteBaseOpenStatus?.done ? (<div className="launch-progress" role="status" aria-live="polite">
                  <div className="launch-progress-header">
                    <span>{noteBaseOpenStatus.phase || 'NoteBase wird geladen ...'}</span>
                    <strong>{noteBaseProgressTotal > 0 ? `${noteBaseProgressPercent}%` : ''}</strong>
                  </div>
                  <div className={`launch-progress-track ${noteBaseProgressTotal > 0 ? '' : 'indeterminate'}`} aria-label="NoteBase-Ladefortschritt" aria-valuemin={0} aria-valuemax={100} aria-valuenow={noteBaseProgressTotal > 0 ? noteBaseProgressPercent : undefined} role="progressbar">
                    <span style={{ width: noteBaseProgressTotal > 0 ? `${noteBaseProgressPercent}%` : '42%' }}/>
                  </div>
                  <p className="launch-progress-meta">{noteBaseProgressLabel}</p>
                  {noteBaseProgressPath ? <p className="launch-progress-path">{noteBaseProgressPath}</p> : null}
                </div>) : null}

              {launchOperatorNotifications.length > 0 ? (<div className="launch-notifications">
                  {launchOperatorNotifications.map((notification) => (<p key={notification.id} className={`launch-notification ${notification.severity}`}>
                      {notification.message}
                    </p>))}
                </div>) : null}
            </div>
          </div>
        </div>
        {createNoteBaseDialog}
        {commandDialogs}
      </div>);
    }
    return (<div className="window-frame">
      {windowTitlebar}
      {commandDialogs}
      <div className="window-content">
        <GraphWorkspaceProvider enabled={sidebarView === 'graph' || openTabs.some(tab => tab.kind === 'graph_dashboard')} backendUrl={backendUrl} vaultLoaded={vaultLoaded} graphUpdateToken={graphUpdateToken} latestGraphStatus={latestGraphStatus} onOpenNodePath={openGraphNodePath} onRevealNodePath={revealGraphNodePath}>
        <div className="workbench-shell">
      <ActivityRail sidebarView={sidebarView} onOpenSidebarView={openSidebarView} onOpenSettings={openSettingsDialog}/>

      {sidebarOpen ? (<aside className="left-sidebar" style={{ width: `${explorerWidth}px` }}>
          <WorkbenchSidebarContent sidebarView={sidebarView} noteBaseName={noteBaseName} vaultLoaded={vaultLoaded} recentNoteBases={recentNoteBases} explorerWidth={explorerWidth} onExplorerWidthChange={setExplorerWidth} onRenameNoteBase={() => {
                void renameNoteBase();
            }} onDeleteNoteBase={() => {
                void deleteNoteBase();
            }} onPickAndOpenVault={() => {
                void pickAndOpenVault();
            }} onCreateVault={() => {
                void createVault();
            }} onOpenRecentNoteBase={(path) => {
                void appLifecycleService.openVaultAtPath(path, 'NoteBase gewechselt.');
            }} onRenameRecentNoteBase={(path) => {
                void appLifecycleService.renameRecentNoteBase(path);
            }} onDeleteRecentNoteBase={(path) => {
                void appLifecycleService.deleteNoteBase(path);
            }} onRemoveRecentNoteBase={(path) => {
                appLifecycleService.removeRecentNoteBase(path);
            }} onOpenNoteBaseInExplorer={(path) => {
                void appLifecycleService.openNoteBaseInFileExplorer(path);
            }} tasks={tasks} taskFilters={taskDashboardFilters} todoFilters={todoDashboardFilters} focusFilters={focusDashboardFilters} onTaskFiltersChange={setTaskDashboardFilters} onTodoFiltersChange={setTodoDashboardFilters} onFocusFiltersChange={setFocusDashboardFilters} onRefreshTasks={() => {
                void refreshTasks();
            }} onRefreshTodos={() => {
                void refreshTodos();
            }} onRefreshFocusData={() => {
                void Promise.allSettled([refreshFocusAggregate(), refreshReview()]);
            }} onOpenTodoDashboard={() => {
                openTodoDashboardTab();
            }} onOpenTaskDashboard={() => {
                openTaskDashboardTab();
            }} onOpenFocusDashboard={() => {
                openFocusDashboardTab();
            }} onOpenReviewDashboard={() => {
                openReviewDashboardTab();
            }} onOpenGraphDashboard={() => {
                openGraphDashboardTab();
            }} reviewFilters={reviewDashboardFilters} onReviewFiltersChange={setReviewDashboardFilters} onRefreshReview={() => {
                void refreshReview();
            }} mergedTagGroups={mergedTagGroups} expandedFolders={expandedFolders} onToggleFolder={toggleFolder} onCreateTagGroup={() => {
                void createTagGroup();
            }} onCreateTagInExistingGroup={(groupName) => {
                void createTagInExistingGroup(groupName);
            }} onRenameTagGroup={(groupName) => {
                void renameTagGroup(groupName);
            }} onSetTagGroupColor={(groupName) => {
                void setTagGroupColor(groupName);
            }} onDeleteTagGroup={(groupName) => {
                void deleteTagGroup(groupName);
            }} onRenameTag={(groupName, tagName) => {
                void renameTag(groupName, tagName);
            }} onDeleteTag={(groupName, tagName) => {
                void deleteTag(groupName, tagName);
            }} onOpenTagOverview={(groupName, tagName) => {
                void openTagOverviewByReference(`${groupName}:${tagName}`);
            }} onOpenTagMatchWorkflow={() => {
                void openTagMatchWorkflow();
            }} noteGroups={noteGroups} explorerRows={explorerRows} activeNotePath={activeTab?.kind === 'note' ? activeTab.path : ''} dirtyFilePaths={dirtyFilePaths} vaultPath={vaultPath} onOpenNoteInTab={openNoteInTab} onOpenNoteInCurrentEditor={openNoteInCurrentEditor} onOpenOrCreateTodayDaily={openOrCreateTodayDaily} onCreateExplorerFile={createExplorerFile} onCreateExplorerTask={createExplorerTask} onCreateExplorerFolder={createExplorerFolder} onRenameExplorerFile={renameExplorerFile} onRenameExplorerFolder={renameExplorerFolder} onDeleteExplorerFile={deleteExplorerFile} onDeleteExplorerFolder={deleteExplorerFolder} onMoveExplorerFile={moveExplorerFile} onMoveExplorerFiles={moveExplorerFiles} onMoveExplorerFolder={moveExplorerFolder} onToggleFavoriteFolder={toggleFavoriteFolder} explorerOptions={explorerOptions} explorerContentMatchPathKeys={explorerContentMatchPathKeys} onExplorerFilterQueryChange={setExplorerFilterQuery} onExplorerOptionsChange={setExplorerOptions} explorerRevealPath={explorerRevealPath} explorerRevealRequestId={explorerRevealRequestId} explorerViewSeed={explorerViewSeed} explorerViewSeedId={explorerViewSeedId} onExplorerViewStateChange={handleExplorerViewStateChange} onRefreshExplorerSidebarData={() => {
                void refreshExplorerSidebarData();
            }}/>
        </aside>) : null}

      <section className="main-region">
        <div ref={workspaceGridRef} className={workspaceGridClassName} style={workspaceGridStyle}>
          <div className="workspace-main-row">
            {editorPanelOpen ? (<EditorWorkspaceLayout workspace={workspaceState} paneTabs={paneTabs} paneActiveTabs={paneActiveTabs} activePaneId={activePaneId} disableSave={!activeTab || !activeTab.dirty} disableReveal={activeTab?.kind !== 'note'} onSaveActive={() => {
                void executeCommand('save');
            }} onRevealActive={revealActiveNoteInExplorer} onToggleSplitMode={toggleSplitView} onCloseEditorPanel={toggleEditorPanel} onSetSplitRatio={(nextRatio) => {
                dispatchWorkspace({
                    type: 'SET_SPLIT_RATIO',
                    splitRatio: nextRatio,
                });
            }} onActivateTab={handleActivatePaneTab} onCloseTab={(tabId) => {
                void closeEditorTab(tabId);
            }} onFocusPane={handleFocusPane} onMoveTabWithinPane={handleMoveTabWithinPane} onMoveTabToPane={handleMoveTabToOtherPane} onDropExternalNote={handleWorkspaceExternalDrop} onTabContextMenu={(tabId, x, y) => {
                setTabContextMenu({ x, y, tabId });
            }} renderPaneContent={renderWorkspacePaneContent} resolveTabIconName={resolveNoteTabIconName} getTabTooltip={getTabTooltip}/>) : null}




          </div>

          {showCaptureInline ? (<div className={`capture-resize-handle ${captureResizing ? 'active' : ''}`} onPointerDown={(event) => {
                event.preventDefault();
                setCaptureResizing(true);
            }} title="Quick Capture Hoehe anpassen"/>) : null}

          {showCaptureInline ? (<section className="workspace-panel capture-workspace-panel">
              <div className="panel-header-row">
                <h3>Quick Capture</h3>
                <div className="panel-inline-actions">
                  <button className="icon-button compact muted" onClick={closeCapturePanel} title={commandTitle('capture','Quick Capture schließen')}>
                    <LucideNamedIcon name="X" size={14}/>
                  </button>
                </div>
              </div>
              <div className="capture-panel-body">
                <div className="capture-input-wrap">
                  <span className="capture-prompt">&gt;</span>
                  <CodeMirrorMarkdownEditor className="capture-markdown-editor" value={captureText} theme={theme} notePath="" backendUrl={backendUrl} tagGroups={mergedTagGroups} linkTargets={markdownLinkTargets} placeholderText="Notiz erfassen und optional To-do nennen" tagSuggestions={suggestions} selectedTagSuggestionKeys={selectedTagKeys} onChange={setCaptureText} onToggleTagSuggestion={toggleCaptureTag} onRejectTagSuggestion={rejectCaptureTag} onSubmitShortcut={(markdown) => {
                void saveCapture(markdown);
            }} onOpenWikiLink={(target) => {
                openWikiLinkInEditor(target, activePaneId);
            }} onOpenTagReference={(groupId, tagId) => {
                void openTagOverviewByReference(`${groupId}:${tagId}`, { targetPane: activePaneId });
            }} editorApiRef={captureEditorRef}/>
                  <button onClick={() => void saveCapture()} disabled={!captureText.trim()}>
                    Senden
                  </button>
                </div>
              </div>
            </section>) : null}
        </div>
        {!showCaptureInline ? (<div className="bottom-dock">
            <button className="dock-tab" onClick={openCaptureFromDock} title={commandTitle('capture')}>
              Quick Capture
            </button>
          </div>) : null}
      </section>

      {tabContextMenu && tabContextTarget ? (<div className="editor-tab-context-menu" style={{ left: `${tabContextMenu.x}px`, top: `${tabContextMenu.y}px` }} onClick={(event) => event.stopPropagation()}>
          <button onClick={() => {
                showNoteInSplitView(tabContextTarget.path);
            }}>
            In anderen Bereich verschieben
          </button>
          <button className="muted" onClick={() => {
                void closeEditorTab(tabContextTarget.id);
            }}>
            Registerkarte schliessen
          </button>
          <button className="muted" onClick={() => {
                void closeOtherEditorTabs(tabContextTarget.id);
            }} disabled={openTabs.length <= 1}>
            Alle anderen Registerkarten schliessen
          </button>
          <button className="muted" onClick={() => {
                void closeAllEditorTabs();
            }} disabled={openTabs.length === 0}>
            Alle Registerkarten schliessen
          </button>
        </div>) : null}

      <StatusBar prefs={statusBarPrefs} notification={latestOperatorNotification} noteBaseName={noteBaseName} counts={counts} dueTodayCount={dueTodayCount}/>

      <TagActionDialogModal dialog={tagActionDialog} colorPresets={TAG_COLOR_PRESETS} setDialog={setTagActionDialog} onClose={closeTagActionDialog}/>
      {tagMatchWorkflowModal}
      {createNoteBaseDialog}
      {settingsDialog}

        </div>
        </GraphWorkspaceProvider>
      </div>
    </div>);
}
export default App;
