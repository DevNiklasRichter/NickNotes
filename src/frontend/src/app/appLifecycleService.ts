import {beginSessionSwitch} from './apiClient';
import type { NoteTab } from './AppShared';
import type { ExplorerOptions, ExplorerViewState } from '../explorer/types';
import type { TagGroupDefinition } from '../tags/tagTypes';
import type { WorkspaceAction } from '../workspace/workspaceState';
import type { BackendState, ColorProfile, RecentNoteBase, StatusBarPrefs, TaskFeatureSettings, ThemeMode, UiSettingsPayload, VaultCounts } from './AppShared';
import type { TagActionDialogAction, TagActionDialogResult, TagFormValues, TagGroupFormValues } from '../tags/TagActionDialogModal';
import { apiRequest, clearStoredLastNoteBasePath, getPreferredTheme, getPathTail, getStoredLastNoteBasePath, getStoredRecentNoteBases, normalizeLabel, removeStoredRecentNoteBasePath, storeRecentNoteBasePath, storeLastNoteBasePath, toActiveColorProfileId, toBoolean, toBoundedNumber, toColorProfilesFromSettings, toExpandedTagGroups, toExplorerOptionsFromSettings, toExplorerViewStateFromSettings, toStorageTagGroups, toStatusBarPrefsFromSettings, toTaskFeatureSettingsFromSettings, toThemeMode, DEFAULT_EXPLORER_VIEW_STATE } from './AppShared';
type NoteBaseActionDialogConfig = {
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
};
export type NoteBaseOpenStatus = {
    active: boolean;
    done: boolean;
    error: string | null;
    phase: string;
    processed: number;
    total: number;
    currentPath?: string | null;
    result?: {
        counts: VaultCounts;
        noteBasePath?: string;
        vaultPath?: string;
        tagGroups?: unknown;
    } | null;
};
type UiSettingsSnapshot = {
    getTheme: () => ThemeMode;
    getActiveColorProfileId: () => string;
    getColorProfiles: () => ColorProfile[];
    getDisplayName: () => string;
    getVaultPath: () => string;
    isSidebarOpen: () => boolean;
    getStatusBarPrefs: () => StatusBarPrefs;
    getTaskFeatureSettings: () => TaskFeatureSettings;
    getExplorerOptions: () => ExplorerOptions;
    getExplorerWidth: () => number;
    isEditorPanelOpen: () => boolean;
    isCapturePanelOpen: () => boolean;
    isCapturePinned: () => boolean;
    getExpandedFolders: () => Record<string, boolean>;
    getWorkspaceLayoutMode: () => 'single' | 'split';
    getWorkspaceSplitRatio: () => number;
    isCreateNoteBasePending: () => boolean;
    getCreateNoteBaseParentPath: () => string;
    getCreateNoteBaseDisplayName: () => string;
    getCreateNoteBaseName: () => string;
};
function encodeFileUrlPath(pathValue: string): string {
    return pathValue
        .split('/')
        .map((segment, index) => {
        if (index === 0 && /^[A-Za-z]:$/.test(segment)) {
            return segment;
        }
        return encodeURIComponent(segment);
    })
        .join('/');
}
function toLocalDirectoryFileUrl(pathValue: string): string {
    const normalizedPath = pathValue.trim().replace(/\\/g, '/');
    if (normalizedPath.startsWith('//')) {
        return `file://${encodeFileUrlPath(normalizedPath.replace(/^\/+/, ''))}`;
    }
    return `file:///${encodeFileUrlPath(normalizedPath.replace(/^\/+/, ''))}`;
}
type AppLifecycleWriter = {
    setTheme: (theme: ThemeMode) => void;
    setActiveColorProfileId: (colorProfileId: string) => void;
    setColorProfiles: (profiles: ColorProfile[]) => void;
    setDisplayName: (value: string) => void;
    setSidebarOpen: (open: boolean) => void;
    setStatusBarPrefs: (prefs: StatusBarPrefs) => void;
    setTaskFeatureSettings: (settings: TaskFeatureSettings) => void;
    setExplorerOptions: (options: ExplorerOptions) => void;
    setSavedTheme: (theme: ThemeMode) => void;
    setSavedActiveColorProfileId: (colorProfileId: string) => void;
    setSavedColorProfiles: (profiles: ColorProfile[]) => void;
    setSavedDisplayName: (value: string) => void;
    setSavedSidebarOpen: (open: boolean) => void;
    setSavedStatusBarPrefs: (prefs: StatusBarPrefs) => void;
    setSavedTaskFeatureSettings: (settings: TaskFeatureSettings) => void;
    setSavedExplorerOptions: (options: ExplorerOptions) => void;
    setExplorerWidth: (value: number) => void;
    setEditorPanelOpen: (open: boolean) => void;
    setCapturePanelOpen: (open: boolean) => void;
    setCapturePinned: (pinned: boolean) => void;
    setExpandedFolders: (value: Record<string, boolean>) => void;
    setExplorerViewState: (state: ExplorerViewState) => void;
    setExplorerViewSeed: (state: ExplorerViewState | null) => void;
    setExplorerViewSeedId: (updater: (value: number) => number) => void;
    setExplorerFilterQuery: (value: string) => void;
    setUiSettingsReady: (ready: boolean) => void;
    setVaultLoaded: (loaded: boolean) => void;
    setNoteBaseOpenStatus: (status: NoteBaseOpenStatus | null) => void;
    setMessage: (message: string) => void;
    setError: (error: string) => void;
    setWarnMessage?: (message: string) => void;
    setCriticalMessage?: (message: string) => void;
    setCounts: (counts: VaultCounts) => void;
    setCustomTagGroups: (groups: TagGroupDefinition[]) => void;
    setVaultPath: (path: string) => void;
    setRecentNoteBases: (items: RecentNoteBase[]) => void;
    setFocusMitIds: (ids: string[]) => void;
    setOpenTabs: (tabs: NoteTab[]) => void;
    setCreateNoteBaseDialogOpen: (open: boolean) => void;
    setCreateNoteBaseParentPath: (path: string) => void;
    setCreateNoteBaseDisplayName: (name: string) => void;
    setCreateNoteBaseName: (name: string) => void;
    setCreateNoteBasePending: (pending: boolean) => void;
    setCreateNoteBaseError: (error: string) => void;
};
type AppLifecycleContext = {
    getBackendUrl: () => string;
    snapshot: UiSettingsSnapshot;
    writer: AppLifecycleWriter;
    pickDirectory: () => Promise<string | null>;
    dispatchWorkspace: (action: WorkspaceAction) => void;
    refreshWorkspaceData: (force?: boolean) => Promise<void>;
    openTagActionDialog: (config: NoteBaseActionDialogConfig) => Promise<TagActionDialogResult>;
    refreshSearch: (force?: boolean) => Promise<void>;
    refreshFocusAggregate: (force?: boolean) => Promise<void>;
    refreshReview: (force?: boolean) => Promise<void>;
    refreshNoteGroups: (force?: boolean) => Promise<void>;
    resetWorkspaceForClosedVault: () => void;
    requestSaveBeforeNoteBaseSwitch: () => Promise<boolean>;
    isNoteBaseOpenActive: () => boolean;
    isAutoOpenTried: () => boolean;
    setAutoOpenTried: (value: boolean) => void;
};
const NOTEBASE_OPEN_POLL_MS = 160;
export class AppLifecycleService {
    private readonly context: AppLifecycleContext;
    constructor(context: AppLifecycleContext) {
        this.context = context;
    }
    private get backendUrl(): string {
        return this.context.getBackendUrl();
    }
    private get snapshot() {
        return this.context.snapshot;
    }
    private get writer() {
        return this.context.writer;
    }
    private refreshRecentNoteBases = () => {
        this.writer.setRecentNoteBases(getStoredRecentNoteBases());
    };
    private noteBasePathKey = (path: string): string => normalizeLabel(path).replace(/\//g, '\\').toLowerCase();
    private isCurrentNoteBasePath = (path: string): boolean => {
        const currentPath = this.snapshot.getVaultPath();
        return this.noteBasePathKey(currentPath) !== '' && this.noteBasePathKey(currentPath) === this.noteBasePathKey(path);
    };
    private clearStoredPathIfMatches = (path: string) => {
        if (this.noteBasePathKey(getStoredLastNoteBasePath()) === this.noteBasePathKey(path)) {
            clearStoredLastNoteBasePath();
        }
    };
    private setUiReady(ready: boolean) {
        this.writer.setUiSettingsReady(ready);
    }
    private deriveParentDirectory = (path: string): string => {
        const cleanPath = normalizeLabel(path).replace(/[\\/]+$/g, '');
        if (!cleanPath) {
            return '';
        }
        const splitIndex = Math.max(cleanPath.lastIndexOf('/'), cleanPath.lastIndexOf('\\'));
        if (splitIndex < 0) {
            return '';
        }
        const parent = cleanPath.slice(0, splitIndex);
        if (/^[A-Za-z]:$/i.test(parent)) {
            return `${parent}\\`;
        }
        return parent;
    };
    private suggestNoteBaseName = (name: string): string => {
        const cleanName = normalizeLabel(name);
        if (!cleanName) {
            return 'NeueNoteBase';
        }
        return `${cleanName}NoteBase`;
    };
    private getNoteBaseName = () => getPathTail(this.snapshot.getVaultPath());
    saveUiSettingsPatch = async (patch: {
        app?: Record<string, unknown>;
        explorer?: ExplorerViewState;
    }) => {
        await apiRequest<{
            settings: UiSettingsPayload;
        }>(this.backendUrl, '/ui-settings', {
            method: 'POST',
            body: JSON.stringify(patch),
        });
    };
    buildFullAppUiSettings = (): Record<string, unknown> => ({
        theme: this.snapshot.getTheme(),
        activeThemeId: this.snapshot.getActiveColorProfileId(),
        themes: this.snapshot.getColorProfiles().filter((profile) => !profile.builtin),
        displayName: this.snapshot.getDisplayName(),
        sidebarOpen: this.snapshot.isSidebarOpen(),
        statusBarPrefs: this.snapshot.getStatusBarPrefs(),
        taskFeatureSettings: this.snapshot.getTaskFeatureSettings(),
        explorerOptions: this.snapshot.getExplorerOptions(),
        explorerWidth: this.snapshot.getExplorerWidth(),
        editorPanelOpen: this.snapshot.isEditorPanelOpen(),
        capturePanelOpen: this.snapshot.isCapturePanelOpen(),
        capturePinned: this.snapshot.isCapturePinned(),
        tagExpandedGroups: this.snapshot.getExpandedFolders(),
        workspaceLayoutMode: this.snapshot.getWorkspaceLayoutMode(),
        workspaceSplitRatio: this.snapshot.getWorkspaceSplitRatio(),
    });
    buildLayoutUiSettings = (): Record<string, unknown> => ({
        explorerWidth: this.snapshot.getExplorerWidth(),
        editorPanelOpen: this.snapshot.isEditorPanelOpen(),
        capturePanelOpen: this.snapshot.isCapturePanelOpen(),
        capturePinned: this.snapshot.isCapturePinned(),
        tagExpandedGroups: this.snapshot.getExpandedFolders(),
        workspaceLayoutMode: this.snapshot.getWorkspaceLayoutMode(),
        workspaceSplitRatio: this.snapshot.getWorkspaceSplitRatio(),
    });
    applyUiSettings = (settings: UiSettingsPayload) => {
        const appSettings = settings.app ?? {};
        const nextTheme = toThemeMode(appSettings.theme, getPreferredTheme());
        const nextColorProfiles = toColorProfilesFromSettings(appSettings.themes ?? appSettings.colorProfiles);
        const nextActiveColorProfileId = toActiveColorProfileId(appSettings.activeThemeId ?? appSettings.activeColorProfileId, nextColorProfiles, nextTheme);
        const nextActiveColorProfile = nextColorProfiles.find((profile) => profile.id === nextActiveColorProfileId);
        const nextEffectiveTheme = toThemeMode(nextActiveColorProfile?.baseTheme, nextTheme);
        const nextDisplayName = normalizeLabel(typeof appSettings.displayName === 'string' ? appSettings.displayName : '') || 'Mein Wissen';
        const nextSidebarOpen = toBoolean(appSettings.sidebarOpen, true);
        const nextStatusBarPrefs = toStatusBarPrefsFromSettings(appSettings.statusBarPrefs);
        const nextTaskFeatureSettings = toTaskFeatureSettingsFromSettings(appSettings.taskFeatureSettings);
        const nextExplorerOptions = toExplorerOptionsFromSettings(appSettings.explorerOptions);
        const nextExplorerWidth = toBoundedNumber(appSettings.explorerWidth, 300, 220, 520);
        const nextEditorPanelOpen = toBoolean(appSettings.editorPanelOpen, true);
        const nextCapturePanelOpen = toBoolean(appSettings.capturePanelOpen, true);
        const nextCapturePinned = toBoolean(appSettings.capturePinned, true);
        const nextExpandedGroups = toExpandedTagGroups(appSettings.tagExpandedGroups);
        const nextWorkspaceLayoutMode = appSettings.workspaceLayoutMode === 'split' ? 'split' : 'single';
        const nextWorkspaceSplitRatio = toBoundedNumber(appSettings.workspaceSplitRatio, 0.5, 0.15, 0.85);
        this.writer.setTheme(nextEffectiveTheme);
        this.writer.setActiveColorProfileId(nextActiveColorProfileId);
        this.writer.setColorProfiles(nextColorProfiles);
        this.writer.setDisplayName(nextDisplayName);
        this.writer.setSidebarOpen(nextSidebarOpen);
        this.writer.setStatusBarPrefs(nextStatusBarPrefs);
        this.writer.setTaskFeatureSettings(nextTaskFeatureSettings);
        this.writer.setExplorerOptions(nextExplorerOptions);
        this.writer.setSavedTheme(nextEffectiveTheme);
        this.writer.setSavedActiveColorProfileId(nextActiveColorProfileId);
        this.writer.setSavedColorProfiles(nextColorProfiles.map((profile) => ({ ...profile, colors: { ...profile.colors } })));
        this.writer.setSavedDisplayName(nextDisplayName);
        this.writer.setSavedSidebarOpen(nextSidebarOpen);
        this.writer.setSavedStatusBarPrefs(nextStatusBarPrefs);
        this.writer.setSavedTaskFeatureSettings(nextTaskFeatureSettings);
        this.writer.setSavedExplorerOptions(nextExplorerOptions);
        this.writer.setExplorerWidth(nextExplorerWidth);
        this.writer.setEditorPanelOpen(nextEditorPanelOpen);
        this.writer.setCapturePanelOpen(nextCapturePanelOpen);
        this.writer.setCapturePinned(nextCapturePinned);
        this.writer.setExpandedFolders(nextExpandedGroups);
        this.context.dispatchWorkspace({
            type: 'TOGGLE_SPLIT_MODE',
            enabled: nextWorkspaceLayoutMode === 'split',
        });
        this.context.dispatchWorkspace({
            type: 'SET_SPLIT_RATIO',
            splitRatio: nextWorkspaceSplitRatio,
        });
        const nextExplorerViewState = toExplorerViewStateFromSettings(settings.explorer);
        this.writer.setExplorerViewState(nextExplorerViewState);
        this.writer.setExplorerViewSeed(nextExplorerViewState);
        this.writer.setExplorerViewSeedId((prev) => prev + 1);
        this.writer.setExplorerFilterQuery('');
        this.setUiReady(true);
    };
    loadUiSettings = async () => {
        try {
            const response = await apiRequest<{
                settings: UiSettingsPayload;
            }>(this.backendUrl, '/ui-settings');
            this.applyUiSettings(response.settings ?? {});
        }
        catch {
            this.setUiReady(true);
        }
    };
    waitForNoteBaseOpen = async (): Promise<NonNullable<NoteBaseOpenStatus['result']>> => {
        while (true) {
            const status = await apiRequest<NoteBaseOpenStatus>(this.backendUrl, '/notebase/open/status');
            this.writer.setNoteBaseOpenStatus(status);
            if (status.done) {
                if (status.error) {
                    throw new Error(status.error);
                }
                if (!status.result) {
                    throw new Error('NoteBase wurde geladen, aber das Ergebnis fehlt.');
                }
                return status.result;
            }
            await new Promise((resolve) => window.setTimeout(resolve, NOTEBASE_OPEN_POLL_MS));
        }
    };
    openVaultAtPath = async (rawPath: string, successMessage: string): Promise<boolean> => {
        const path = normalizeLabel(rawPath);
        if (!path) {
            throw new Error('Bitte zuerst einen NoteBase-Pfad angeben.');
        }
        const canSwitch = await this.context.requestSaveBeforeNoteBaseSwitch();
        if (!canSwitch) {
            return false;
        }
        beginSessionSwitch();
        this.writer.setVaultLoaded(false);
        this.writer.setNoteBaseOpenStatus({
            active: true,
            done: false,
            error: null,
            phase: 'NoteBase wird vorbereitet ...',
            processed: 0,
            total: 0,
            result: null,
        });
        this.writer.setMessage('NoteBase wird geladen ...');
        await apiRequest<{
            started: boolean;
            path: string;
        }>(this.backendUrl, '/notebase/open/start', {
            method: 'POST',
            body: JSON.stringify({ path }),
        });
        const response = await this.waitForNoteBaseOpen();
        const loadedPath = response.noteBasePath ?? response.vaultPath ?? path;
        this.context.resetWorkspaceForClosedVault();
        this.setUiReady(false);
        this.writer.setVaultPath(loadedPath);
        this.writer.setVaultLoaded(true);
        this.writer.setCounts(response.counts);
        if (response.tagGroups) {
            this.writer.setCustomTagGroups(toStorageTagGroups(response.tagGroups));
        }
        storeLastNoteBasePath(loadedPath);
        this.refreshRecentNoteBases();
        this.writer.setMessage(successMessage);
        this.writer.setError('');
        this.writer.setNoteBaseOpenStatus(null);
        await this.loadUiSettings();
        await this.context.refreshWorkspaceData(true);
        return true;
    };
    openCreateNoteBaseDialog = () => {
        if (this.snapshot.isCreateNoteBasePending()) return;
        this.writer.setCreateNoteBaseError('');
        const displayName = this.snapshot.getDisplayName();
        this.writer.setCreateNoteBaseParentPath(this.deriveParentDirectory(this.snapshot.getVaultPath()));
        this.writer.setCreateNoteBaseDisplayName(displayName);
        this.writer.setCreateNoteBaseName(this.suggestNoteBaseName(displayName));
        this.writer.setCreateNoteBaseDialogOpen(true);
    };
    closeCreateNoteBaseDialog = () => {
        if (this.snapshot.isCreateNoteBasePending()) {
            return;
        }
        this.writer.setCreateNoteBaseDialogOpen(false);
    };
    chooseCreateNoteBaseParentDirectory = async () => {
        if (this.snapshot.isCreateNoteBasePending()) return;
        this.writer.setCreateNoteBasePending(true);
        try {
            this.writer.setError('');
            this.writer.setCreateNoteBaseError('');
            const selectedPath = await this.context.pickDirectory();
            if (!selectedPath) {
                return;
            }
            this.writer.setCreateNoteBaseParentPath(selectedPath);
        }
        catch (caught) {
            this.writer.setError(String(caught));
            this.writer.setCreateNoteBaseError(String(caught));
        }
        finally {
            this.writer.setCreateNoteBasePending(false);
        }
    };
    submitCreateNoteBaseDialog = async () => {
        if (this.snapshot.isCreateNoteBasePending()) return;
        const parentPath = normalizeLabel(this.snapshot.getCreateNoteBaseParentPath());
        const name = normalizeLabel(this.snapshot.getCreateNoteBaseName());
        const nextDisplayName = normalizeLabel(this.snapshot.getCreateNoteBaseDisplayName());
        if (!parentPath) {
            this.writer.setError('Bitte zuerst einen Speicherort fuer die neue NoteBase auswaehlen.');
            this.writer.setCreateNoteBaseError('Bitte zuerst einen Speicherort für die neue NoteBase auswählen.');
            return;
        }
        if (!name) {
            this.writer.setError('Bitte einen Namen fuer die neue NoteBase eingeben.');
            this.writer.setCreateNoteBaseError('Bitte einen Namen für die neue NoteBase eingeben.');
            return;
        }
        if (/[\\/]/.test(name) || name === '.' || name === '..') {
            this.writer.setError('Der NoteBase-Name darf keine Pfadtrenner enthalten.');
            this.writer.setCreateNoteBaseError('Der NoteBase-Name darf weder Pfadtrenner noch "." oder ".." enthalten.');
            return;
        }
        this.writer.setCreateNoteBasePending(true);
        let created = false;
        try {
            this.writer.setError('');
            this.writer.setCreateNoteBaseError('');
            const canSwitch = await this.context.requestSaveBeforeNoteBaseSwitch();
            if (!canSwitch) {
                return;
            }
            beginSessionSwitch();
            const response = await apiRequest<{
                vaultPath: string;
                noteBasePath?: string;
                counts: VaultCounts;
                tagGroups?: unknown;
            }>(this.backendUrl, '/notebase/create', {
                method: 'POST',
                body: JSON.stringify({ parentPath, name }),
            });
            const loadedPath = response.noteBasePath ?? response.vaultPath;
            created = true;
            this.context.resetWorkspaceForClosedVault();
            this.writer.setVaultPath(loadedPath);
            this.writer.setVaultLoaded(true);
            this.writer.setCounts(response.counts);
            this.setUiReady(false);
            storeLastNoteBasePath(loadedPath);
            this.refreshRecentNoteBases();
            if (response.tagGroups) {
                this.writer.setCustomTagGroups(toStorageTagGroups(response.tagGroups));
            }
            if (nextDisplayName) {
                try {
                    // Persist before loading the new NoteBase's settings, which replace UI state.
                    await this.saveUiSettingsPatch({app: {displayName: nextDisplayName}});
                } catch {
                    this.writer.setWarnMessage?.('Die NoteBase wurde erstellt, aber die Anrede konnte nicht gespeichert werden. Bitte in den Einstellungen erneut festlegen.');
                }
            }
            await this.loadUiSettings();
            await this.context.refreshWorkspaceData(true);
            this.writer.setCreateNoteBaseDialogOpen(false);
            this.writer.setMessage(`Neue NoteBase erstellt: ${loadedPath}`);
        }
        catch (caught) {
            if (created) {
                this.writer.setCreateNoteBaseDialogOpen(false);
                this.writer.setError(`Die NoteBase wurde erstellt, aber die Ansicht konnte nicht vollständig geladen werden: ${String(caught)}`);
            } else {
                this.writer.setError(String(caught));
                this.writer.setCreateNoteBaseError(String(caught));
            }
        }
        finally {
            this.writer.setCreateNoteBasePending(false);
        }
    };
    pickAndOpenVault = async () => {
        try {
            this.writer.setError('');
            const path = await this.context.pickDirectory();
            if (!path) {
                return;
            }
            this.writer.setVaultPath(path);
            await this.openVaultAtPath(path, 'NoteBase automatisch geladen.');
        }
        catch (caught) {
            this.writer.setError(String(caught));
        }
    };
    renameNoteBase = async () => {
        const currentName = this.getNoteBaseName();
        const renameDialog = await this.context.openTagActionDialog({
            kind: 'input',
            title: 'NoteBase umbenennen',
            message: 'Neuen Namen festlegen',
            initialValue: currentName,
            actions: [
                { id: 'confirm', label: 'Speichern', tone: 'primary' },
                { id: 'cancel', label: 'Abbrechen' }
            ],
        });
        if (renameDialog.actionId !== 'confirm') {
            return;
        }
        const newName = normalizeLabel(renameDialog.value);
        if (!newName || newName === currentName) {
            return;
        }
        try {
            this.writer.setError('');
            if (!await this.context.requestSaveBeforeNoteBaseSwitch()) return;
            const previousName = currentName;
            const previousPath = this.snapshot.getVaultPath();
            const response = await apiRequest<{
                counts: VaultCounts;
                vaultPath: string;
                noteBasePath?: string;
                tagGroups?: unknown;
            }>(this.backendUrl, '/notebase/rename', {
                method: 'POST',
                body: JSON.stringify({ newName }),
            });
            const loadedPath = response.noteBasePath ?? response.vaultPath;
            this.writer.setVaultPath(loadedPath);
            this.writer.setVaultLoaded(true);
            this.writer.setCounts(response.counts);
            this.writer.setOpenTabs([]);
            this.context.dispatchWorkspace({
                type: 'RESET',
            });
            removeStoredRecentNoteBasePath(previousPath);
            storeLastNoteBasePath(loadedPath);
            this.refreshRecentNoteBases();
            if (response.tagGroups) {
                this.writer.setCustomTagGroups(toStorageTagGroups(response.tagGroups));
            }
            this.writer.setMessage(`NoteBase umbenannt: ${previousName} -> ${getPathTail(loadedPath)}`);
            await Promise.all([
                this.context.refreshFocusAggregate(true),
                this.context.refreshSearch(true),
                this.context.refreshReview(true),
                this.context.refreshNoteGroups(true)
            ]);
        }
        catch (caught) {
            this.writer.setError(String(caught));
        }
    };
    renameRecentNoteBase = async (rawPath: string) => {
        const path = normalizeLabel(rawPath);
        if (!path) {
            return;
        }
        if (this.isCurrentNoteBasePath(path)) {
            await this.renameNoteBase();
            return;
        }
        const currentName = getPathTail(path) || path;
        const renameDialog = await this.context.openTagActionDialog({
            kind: 'input',
            title: 'NoteBase umbenennen',
            message: 'Neuen Namen festlegen',
            initialValue: currentName,
            actions: [
                { id: 'confirm', label: 'Speichern', tone: 'primary' },
                { id: 'cancel', label: 'Abbrechen' }
            ],
        });
        if (renameDialog.actionId !== 'confirm') {
            return;
        }
        const newName = normalizeLabel(renameDialog.value);
        if (!newName || newName === currentName) {
            return;
        }
        try {
            this.writer.setError('');
            const response = await apiRequest<{
                vaultPath: string;
                noteBasePath?: string;
            }>(this.backendUrl, '/notebase/rename', {
                method: 'POST',
                body: JSON.stringify({ path, newName }),
            });
            const renamedPath = response.noteBasePath ?? response.vaultPath;
            removeStoredRecentNoteBasePath(path);
            if (this.noteBasePathKey(getStoredLastNoteBasePath()) === this.noteBasePathKey(path)) {
                storeLastNoteBasePath(renamedPath);
            }
            else {
                storeRecentNoteBasePath(renamedPath);
            }
            this.refreshRecentNoteBases();
            this.writer.setMessage(`NoteBase umbenannt: ${currentName} -> ${getPathTail(renamedPath)}`);
        }
        catch (caught) {
            this.writer.setError(String(caught));
        }
    };
    deleteNoteBase = async (rawPath?: string) => {
        const targetPath = normalizeLabel(rawPath || '');
        const currentName = targetPath ? getPathTail(targetPath) || targetPath : this.getNoteBaseName();
        const confirmed = await this.context.openTagActionDialog({
            kind: 'choice',
            title: 'NoteBase loeschen',
            message: `Soll die NoteBase "${currentName}" wirklich mit allen Dateien geloescht werden?`,
            actions: [
                { id: 'delete', label: 'Loeschen', tone: 'danger' },
                { id: 'cancel', label: 'Abbrechen' }
            ],
        });
        if (confirmed.actionId !== 'delete') {
            return;
        }
        const secondCheckDialog = await this.context.openTagActionDialog({
            kind: 'input',
            title: 'Loeschen bestaetigen',
            message: 'Bitte "LOESCHEN" eingeben, um das vollstaendige Loeschen zu bestaetigen.',
            initialValue: '',
            actions: [
                { id: 'confirm', label: 'Endgueltig loeschen', tone: 'danger' },
                { id: 'cancel', label: 'Abbrechen' }
            ],
        });
        if (secondCheckDialog.actionId !== 'confirm') {
            return;
        }
        const secondCheck = normalizeLabel(secondCheckDialog.value);
        if (secondCheck.toUpperCase() !== 'LOESCHEN') {
            this.writer.setMessage('Loeschen abgebrochen.');
            return;
        }
        try {
            this.writer.setError('');
            const response = await apiRequest<{
                deleted: boolean;
                deletedPath: string;
            }>(this.backendUrl, '/notebase/delete', {
                method: 'POST',
                body: JSON.stringify(targetPath ? { confirmDelete: true, path: targetPath } : { confirmDelete: true }),
            });
            if (!response.deleted) {
                return;
            }
            const deletedCurrent = this.isCurrentNoteBasePath(response.deletedPath);
            if (deletedCurrent) {
                this.writer.setVaultLoaded(false);
                this.writer.setUiSettingsReady(false);
                this.context.resetWorkspaceForClosedVault();
                clearStoredLastNoteBasePath();
            }
            else {
                this.clearStoredPathIfMatches(response.deletedPath);
            }
            removeStoredRecentNoteBasePath(response.deletedPath);
            this.refreshRecentNoteBases();
            this.writer.setMessage(`NoteBase geloescht: ${response.deletedPath}`);
        }
        catch (caught) {
            this.writer.setError(String(caught));
        }
    };
    removeRecentNoteBase = (rawPath: string) => {
        const path = normalizeLabel(rawPath);
        if (!path) {
            return;
        }
        removeStoredRecentNoteBasePath(path);
        this.clearStoredPathIfMatches(path);
        this.refreshRecentNoteBases();
        this.writer.setMessage(`NoteBase aus Liste entfernt: ${getPathTail(path) || path}`);
    };
    openNoteBaseInFileExplorer = async (rawPath: string) => {
        const path = normalizeLabel(rawPath);
        if (!path) {
            return;
        }
        if (!window.nicknotes?.openPathInFileExplorer && !window.nicknotes?.openExternalUrl) {
            this.writer.setMessage('Windows Explorer ist nur in der Desktop-App verfuegbar.');
            return;
        }
        try {
            const result = window.nicknotes.openPathInFileExplorer
                ? await window.nicknotes.openPathInFileExplorer(path)
                : await window.nicknotes.openExternalUrl?.(toLocalDirectoryFileUrl(path));
            if (!result?.ok) {
                this.writer.setError(result?.message || 'NoteBase konnte nicht im Windows Explorer geoeffnet werden.');
                return;
            }
            this.writer.setMessage(`NoteBase im Windows Explorer geoeffnet: ${getPathTail(path) || path}`);
        }
        catch (caught) {
            this.writer.setError(String(caught));
        }
    };
    isMissingNoteBasePathError = (value: unknown): boolean => {
        const text = String(value || '').toLowerCase();
        return text.includes('notebase path not found') || text.includes('path not found') || text.includes('enoent');
    };
    loadState = async () => {
        try {
            const state = await apiRequest<BackendState>(this.backendUrl, '/state');
            if (!state.vaultLoaded) {
                this.context.resetWorkspaceForClosedVault();
                this.setUiReady(false);
                this.writer.setVaultLoaded(false);
                if (!this.context.isNoteBaseOpenActive()) {
                    this.writer.setNoteBaseOpenStatus(null);
                }
                this.writer.setFocusMitIds([]);
                this.writer.setOpenTabs([]);
                this.context.dispatchWorkspace({ type: 'RESET' });
                this.writer.setExplorerViewState(DEFAULT_EXPLORER_VIEW_STATE);
                this.writer.setExplorerViewSeed(null);
                this.writer.setExplorerViewSeedId((prev) => prev + 1);
                let missingRememberedPathHandled = false;
                const rememberedPath = getStoredLastNoteBasePath();
                if (rememberedPath && !this.context.isAutoOpenTried()) {
                    this.context.setAutoOpenTried(true);
                    this.writer.setVaultPath(rememberedPath);
                    try {
                        await this.openVaultAtPath(rememberedPath, 'Letzte NoteBase automatisch geladen.');
                        return;
                    }
                    catch (autoOpenError) {
                        if (this.isMissingNoteBasePathError(autoOpenError)) {
                            clearStoredLastNoteBasePath();
                            removeStoredRecentNoteBasePath(rememberedPath);
                            this.refreshRecentNoteBases();
                            this.writer.setVaultPath('');
                            this.writer.setError('');
                            this.writer.setMessage('Letzte NoteBase nicht gefunden. Bitte waehle eine NoteBase aus.');
                            missingRememberedPathHandled = true;
                        }
                        else {
                            this.writer.setError(String(autoOpenError));
                        }
                    }
                }
                if (!missingRememberedPathHandled) {
                    this.writer.setMessage('Keine NoteBase geladen.');
                }
                return;
            }
            this.writer.setVaultLoaded(true);
            this.writer.setNoteBaseOpenStatus(null);
            const loadedPath = state.noteBasePath ?? state.vaultPath ?? '';
            this.writer.setVaultPath(loadedPath);
            storeLastNoteBasePath(loadedPath);
            this.refreshRecentNoteBases();
            this.setUiReady(false);
            if (state.counts) {
                this.writer.setCounts(state.counts);
            }
            this.writer.setMessage('NoteBase geladen.');
            this.writer.setError('');
            await this.loadUiSettings();
            await this.context.refreshWorkspaceData(true);
        }
        catch (caught) {
            if (this.writer.setCriticalMessage) {
                this.writer.setCriticalMessage(`Backend nicht erreichbar: ${String(caught)}`);
            }
            else {
                this.writer.setError(`Backend nicht erreichbar: ${String(caught)}`);
            }
        }
    };
}
