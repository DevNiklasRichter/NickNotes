import {RecoveryPanel} from './RecoveryPanel';
import { AgentConnections } from './AgentConnections';
import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import {createPortal} from 'react-dom';
import {trapDialogTab, useDialogFocus} from '../ui/useDialogFocus';
import './SettingsEditorPanel.css';
import { DEFAULT_DARK_COLOR_PROFILE, DEFAULT_LIGHT_COLOR_PROFILE, THEME_COLOR_TOKEN_GROUPS, THEME_COLOR_TOKEN_LABELS, apiRequest, normalizeCssColor, normalizeLabel, type ColorProfile, type NoteGroup, type ThemeColorToken, type VaultCounts } from '../app/AppShared';
import type { ExplorerOptions } from '../explorer/types';
import { LucideNamedIcon } from '../icons/lucideCatalog';
type ThemeMode = 'light' | 'dark';
type StatusBarPrefs = {
    showNoteBaseName: boolean;
    showOpenTasks: boolean;
    showDueToday: boolean;
    showTotalNotes: boolean;
    showStateMessage: boolean;
};
type TaskFeatureSettings = {
    advancedTaskHandling: boolean;
    taskTimeManagement: boolean;
};
type OneNoteImportPreview = {
    notebooks: number;
    sections: number;
    pages: number;
    mediaCandidates: number;
    unsupportedFiles: number;
    warnings: string[];
    pagesPreview: Array<{
        title: string;
        notebook: string;
        section: string;
        sourcePath: string;
    }>;
};
type OneNoteImportResponse = {
    counts?: VaultCounts;
    tagGroups?: unknown;
    groups?: NoteGroup[];
    import?: {
        importedPages: number;
        skippedPages: number;
        mediaFiles: number;
        warnings: string[];
        reportPath: string;
    };
};
type OneNoteImportStatus = {
    active: boolean;
    done: boolean;
    error: string | null;
    errorCode?: string | null;
    errorDetails?: Record<string, unknown> | null;
    phase: string;
    processed: number;
    total: number;
    currentPath: string | null;
    result?: OneNoteImportResponse | null;
};
type SettingsEditorPanelProps = {
    displayName: string;
    theme: ThemeMode;
    activeColorProfileId: string;
    colorProfiles: ColorProfile[];
    backendUrl: string;
    vaultLoaded: boolean;
    sidebarOpen: boolean;
    explorerOptions: ExplorerOptions;
    statusBarPrefs: StatusBarPrefs;
    taskFeatureSettings: TaskFeatureSettings;
    settingsDirty: boolean;
    saving: boolean;
    saveError: string;
    suspended: boolean;
    onClose: () => void;
    setSidebarOpen: Dispatch<SetStateAction<boolean>>;
    setExplorerOptions: Dispatch<SetStateAction<ExplorerOptions>>;
    setStatusBarPrefs: Dispatch<SetStateAction<StatusBarPrefs>>;
    setTaskFeatureSettings: Dispatch<SetStateAction<TaskFeatureSettings>>;
    onDisplayNameChange: (nextRawValue: string) => void;
    onActiveColorProfileChange: (profileId: string) => void;
    onColorProfilesChange: Dispatch<SetStateAction<ColorProfile[]>>;
    onSave: () => void;
    onDiscard: () => void;
    onOneNoteImportComplete: (response: OneNoteImportResponse) => void;
};
type SettingsSectionId = 'agents' | 'general' | 'appearance' | 'imports' | 'layout' | 'explorer' | 'statusbar' | 'tasks';
const SETTINGS_SECTIONS: Array<{
    id: SettingsSectionId;
    title: string;
    eyebrow: string;
    description: string;
    icon: string;
}> = [
    {
        id: 'general',
        title: 'Allgemein',
        eyebrow: 'Basis',
        description: 'Persoenliche Anzeige und Grundverhalten.',
        icon: 'User',
    },
    {
        id: 'appearance',
        title: 'Darstellung',
        eyebrow: 'Oberflaeche',
        description: 'Theme und visuelle Arbeitsweise.',
        icon: 'Palette',
    },
    {id: 'agents', title: 'Agent-Verbindungen', eyebrow: 'MCP', description: 'Externe Agenten gezielt fuer diese NoteBase freigeben.', icon: 'Plug'},
    {
        id: 'imports',
        title: 'Import',
        eyebrow: 'Quellen',
        description: 'Inhalte aus anderen Systemen uebernehmen.',
        icon: 'Download',
    },
    {
        id: 'layout',
        title: 'Layout',
        eyebrow: 'Arbeitsflaeche',
        description: 'Sichtbarkeit und Aufbau der Hauptbereiche.',
        icon: 'PanelLeft',
    },
    {
        id: 'explorer',
        title: 'Note Explorer',
        eyebrow: 'Navigation',
        description: 'Dateien und Ordner in der NoteBase anzeigen.',
        icon: 'FolderTree',
    },
    {
        id: 'statusbar',
        title: 'Statusleiste',
        eyebrow: 'Feedback',
        description: 'Informationen am unteren Fensterrand steuern.',
        icon: 'PanelBottom',
    },
    {
        id: 'tasks',
        title: 'Tasks',
        eyebrow: 'Arbeitsmodus',
        description: 'Aufgabenfunktionen fuer deinen Workflow.',
        icon: 'ListChecks',
    }
];
export function SettingsEditorPanel({ displayName, theme, activeColorProfileId, colorProfiles, backendUrl, vaultLoaded, sidebarOpen, explorerOptions, statusBarPrefs, taskFeatureSettings, settingsDirty, saving, saveError, suspended, onClose, setSidebarOpen, setExplorerOptions, setStatusBarPrefs, setTaskFeatureSettings, onDisplayNameChange, onActiveColorProfileChange, onColorProfilesChange, onSave, onDiscard, onOneNoteImportComplete, }: SettingsEditorPanelProps) {
    const [activeSectionId, setActiveSectionId] = useState<SettingsSectionId>('general');
    const [oneNoteSourcePaths, setOneNoteSourcePaths] = useState<string[]>([]);
    const [oneNoteTargetFolder, setOneNoteTargetFolder] = useState('');
    const [oneNotePreview, setOneNotePreview] = useState<OneNoteImportPreview | null>(null);
    const [oneNoteOperation, setOneNoteOperation] = useState<'picker' | 'preview' | 'import' | null>(null);
    const oneNotePending = oneNoteOperation !== null;
    const oneNotePendingRef = useRef(false);
    const setImportPending = (operation: typeof oneNoteOperation) => {oneNotePendingRef.current = operation !== null; setOneNoteOperation(operation);};
    const busy = saving || oneNotePending;
    const root = useDialogFocus({active: !suspended, busy});
    const sectionBody = useRef<HTMLDivElement>(null);
    const close = () => {if (!saving && !oneNotePendingRef.current && !suspended) onClose();};
    const selectSection = (sectionId: SettingsSectionId) => {
        if (busy) return;
        setActiveSectionId(sectionId);
        sectionBody.current?.scrollTo(0, 0);
    };
    const [oneNoteMessage, setOneNoteMessage] = useState('');
    const [oneNoteError, setOneNoteError] = useState('');
    const [oneNoteImportStatus, setOneNoteImportStatus] = useState<OneNoteImportStatus | null>(null);
    const [themeColorDrafts, setThemeColorDrafts] = useState<Record<string, Record<string, string>>>({});
    const [themeNameDrafts, setThemeNameDrafts] = useState<Record<string, string>>({});
    const formatOneNoteImportError = (caught: unknown): string => {
        if (caught instanceof Error) {
            const text = caught.message || 'Unbekannter Fehler.';
            try {
                const payload = JSON.parse(text);
                const error = (payload as {
                    error?: {
                        code?: string;
                        message?: string;
                        details?: Record<string, unknown>;
                    };
                }).error;
                const message = error?.message;
                if (typeof message === 'string' && message.trim()) {
                    const code = error?.code;
                    const detailEntries = error?.details && typeof error.details === 'object'
                        ? Object.entries(error.details)
                            .map(([key, value]) => `${key}: ${String(value)}`)
                            .join(', ')
                        : '';
                    return code ? `${code}: ${message}${detailEntries ? ` (${detailEntries})` : ''}` : `${message}${detailEntries ? ` (${detailEntries})` : ''}`;
                }
            }
            catch {
                // Fallthrough to plain error text.
            }
            return text;
        }
        return 'Unbekannter Fehler.';
    };
    useEffect(() => {
        if (oneNoteOperation !== 'import') {
            return;
        }
        let cancelled = false;
        const poll = async () => {
            try {
                const status = await apiRequest<OneNoteImportStatus>(backendUrl, '/imports/onenote/status');
                if (!cancelled) {
                    setOneNoteImportStatus(status);
                }
            }
            catch {
                // The actual import request reports the error; polling is only for progress UI.
            }
        };
        void poll();
        const timer = window.setInterval(() => void poll(), 500);
        return () => {
            cancelled = true;
            window.clearInterval(timer);
        };
    }, [backendUrl, oneNoteOperation]);
    const chooseOneNoteSources = async () => {
        if (saving || oneNotePendingRef.current) return;
        setImportPending('picker');
        setOneNoteImportStatus(null);
        try {
            const selected = await window.nicknotes?.selectImportSources?.();
            if (!selected || selected.length === 0) {
                return;
            }
            setOneNoteSourcePaths((prev) => {
                const merged = [...prev];
                for (const path of selected) {
                    if (!merged.includes(path)) {
                        merged.push(path);
                    }
                }
                return merged;
            });
            setOneNotePreview(null);
            setOneNoteMessage('');
            setOneNoteError('');
        } catch (caught) {setOneNoteError(formatOneNoteImportError(caught));}
        finally {setImportPending(null);}
    };
    const previewOneNoteImport = async () => {
        if (saving || oneNotePendingRef.current) return;
        if (!oneNoteSourcePaths.length) {
            setOneNoteError('Bitte mindestens eine .onepkg-Datei auswaehlen.');
            return;
        }
        setImportPending('preview');
        setOneNoteImportStatus(null);
        setOneNoteError('');
        setOneNoteMessage('');
        try {
            const response = await apiRequest<OneNoteImportPreview>(backendUrl, '/imports/onenote/preview', {
                method: 'POST',
                body: JSON.stringify({ sourcePaths: oneNoteSourcePaths }),
            });
            setOneNotePreview(response);
            if (response.pages === 0 && oneNoteSourcePaths.some((path) => path.toLowerCase().endsWith('.onepkg'))) {
                setOneNoteMessage('.onepkg erkannt. Die Seiten werden erst beim Import ueber OneNote Desktop ermittelt.');
            }
            else {
                setOneNoteMessage(`${response.pages} Seiten fuer den Import gefunden.`);
            }
        }
        catch (caught) {
            setOneNoteError(formatOneNoteImportError(caught));
        }
        finally {
            setImportPending(null);
        }
    };
    const startOneNoteImport = async () => {
        if (saving || oneNotePendingRef.current) return;
        if (!oneNoteSourcePaths.length) {
            setOneNoteError('Bitte mindestens eine .onepkg-Datei auswaehlen.');
            return;
        }
        const hasOnePkgSource = oneNoteSourcePaths.some((path) => path.toLowerCase().endsWith('.onepkg'));
        if (hasOnePkgSource) {
            const confirmed = window.confirm('Der Import von .onepkg-Dateien benoetigt OneNote Desktop. OneNote kann waehrend des Imports sichtbar geoeffnet werden. Import fortsetzen?');
            if (!confirmed) {
                return;
            }
        }
        setImportPending('import');
        setOneNoteImportStatus({
            active: true,
            done: false,
            error: null,
            phase: 'Import wird vorbereitet ...',
            processed: 0,
            total: 0,
            currentPath: null,
            result: null,
        });
        setOneNoteError('');
        setOneNoteMessage('Import laeuft ...');
        try {
            const response = await apiRequest<OneNoteImportResponse>(backendUrl, '/imports/onenote/start', {
                method: 'POST',
                body: JSON.stringify({ sourcePaths: oneNoteSourcePaths, targetFolder: oneNoteTargetFolder }),
            });
            onOneNoteImportComplete(response);
            setOneNotePreview(null);
            setOneNoteMessage(`Import abgeschlossen: ${response.import?.importedPages ?? 0} Seiten, ${response.import?.mediaFiles ?? 0} Medien.`);
            setOneNoteImportStatus((prev) => ({
                active: false,
                done: true,
                error: null,
                errorCode: undefined,
                errorDetails: undefined,
                phase: 'Import abgeschlossen.',
                processed: response.import?.importedPages ?? prev?.processed ?? 0,
                total: Math.max(response.import?.importedPages ?? prev?.total ?? 1, 1),
                currentPath: null,
                result: response,
            }));
        }
        catch (caught) {
            setOneNoteError(formatOneNoteImportError(caught));
            setOneNoteImportStatus((prev) => prev
                ? {
                    ...prev,
                    active: false,
                    done: true,
                    error: formatOneNoteImportError(caught),
                    errorCode: 'onenote-import-unexpected',
                    errorDetails: { error: formatOneNoteImportError(caught) },
                    phase: 'Import fehlgeschlagen.',
                }
                : null);
        }
        finally {
            setImportPending(null);
        }
    };
    const oneNoteHasPackageSource = oneNoteSourcePaths.some((path) => path.toLowerCase().endsWith('.onepkg'));
    const oneNoteProgressPercent = oneNoteImportStatus && oneNoteImportStatus.total > 0
        ? Math.max(0, Math.min(100, Math.round((oneNoteImportStatus.processed / oneNoteImportStatus.total) * 100)))
        : 0;
    const activeSection = useMemo(() => SETTINGS_SECTIONS.find((section) => section.id === activeSectionId) ?? SETTINGS_SECTIONS[0], [activeSectionId]);
    const selectedColorProfile = colorProfiles.find((profile) => profile.id === activeColorProfileId) ?? colorProfiles.find((profile) => profile.id === theme);
    const selectedThemeEditable = Boolean(selectedColorProfile && !selectedColorProfile.builtin);
    useEffect(() => {
        setThemeColorDrafts(() => {
            const next: Record<string, Record<string, string>> = {};
            for (const profile of colorProfiles) {
                next[profile.id] = { ...profile.colors };
            }
            return next;
        });
        setThemeNameDrafts(() => {
            const next: Record<string, string> = {};
            for (const profile of colorProfiles) {
                next[profile.id] = profile.name;
            }
            return next;
        });
    }, [colorProfiles]);
    const createCustomColorProfile = () => {
        const source = selectedColorProfile ?? (theme === 'dark' ? DEFAULT_DARK_COLOR_PROFILE : DEFAULT_LIGHT_COLOR_PROFILE);
        const existingIds = new Set(colorProfiles.map((profile) => profile.id));
        let counter = 1;
        let id = `custom-${counter}`;
        while (existingIds.has(id)) {
            counter += 1;
            id = `custom-${counter}`;
        }
        const existingNames = new Set(colorProfiles.map((profile) => profile.name.trim().toLowerCase()));
        let nameCounter = 1;
        let profileName = 'New Theme';
        while (existingNames.has(profileName.toLowerCase())) {
            nameCounter += 1;
            profileName = `New Theme ${nameCounter}`;
        }
        const nextProfile: ColorProfile = {
            id,
            name: profileName,
            baseTheme: source.baseTheme,
            colors: { ...source.colors },
        };
        onColorProfilesChange((prev) => [...prev, nextProfile]);
        onActiveColorProfileChange(nextProfile.id);
    };
    const updateCustomColorProfile = (profileId: string, updater: (profile: ColorProfile) => ColorProfile) => {
        onColorProfilesChange((prev) => prev.map((profile) => {
            if (profile.id !== profileId || profile.builtin) {
                return profile;
            }
            return updater(profile);
        }));
    };
    const removeCustomColorProfile = (profileId: string) => {
        const profile = colorProfiles.find((entry) => entry.id === profileId);
        if (!profile || profile.builtin) {
            return;
        }
        onColorProfilesChange((prev) => prev.filter((entry) => entry.id !== profileId));
        onActiveColorProfileChange(profile.baseTheme);
    };
    const commitThemeColor = (profileId: string, token: ThemeColorToken, rawValue: string) => {
        const currentProfile = colorProfiles.find((profile) => profile.id === profileId);
        if (!currentProfile || currentProfile.builtin) {
            return;
        }
        const currentValue = currentProfile.colors[token];
        const nextColor = normalizeCssColor(rawValue, currentValue);
        setThemeColorDrafts((prev) => ({
            ...prev,
            [profileId]: {
                ...(prev[profileId] ?? {}),
                [token]: nextColor,
            },
        }));
        if (nextColor === currentValue) {
            return;
        }
        updateCustomColorProfile(profileId, (profile) => ({
            ...profile,
            colors: { ...profile.colors, [token]: nextColor },
        }));
    };
    const commitThemeName = (profileId: string, rawValue: string) => {
        const currentProfile = colorProfiles.find((profile) => profile.id === profileId);
        if (!currentProfile || currentProfile.builtin) {
            return;
        }
        const nextName = normalizeLabel(rawValue) || 'New Theme';
        setThemeNameDrafts((prev) => ({ ...prev, [profileId]: nextName }));
        if (nextName === currentProfile.name) {
            return;
        }
        updateCustomColorProfile(profileId, (profile) => ({ ...profile, name: nextName }));
    };
    return createPortal(<div className={`modal-overlay settings-overlay${suspended ? ' is-suspended' : ''}`} role="presentation" inert={suspended || undefined} aria-hidden={suspended || undefined} onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
                event.preventDefault();
                close();
            }
        }}>
      <div className="settings-modal" ref={root} role="dialog" aria-modal="true" aria-labelledby="settings-modal-title" aria-busy={busy || undefined} tabIndex={-1}
        onKeyDown={event => {
            event.stopPropagation();
            if (event.key === 'Escape') {event.preventDefault(); close(); return;}
            trapDialogTab(event);
        }}>
        <fieldset className="settings-controls" disabled={busy}>
        <aside className="settings-nav" aria-label="Einstellungsbereiche">
          <div className="settings-nav-heading">
            <span>Optionen</span>
            <strong id="settings-modal-title">Einstellungen</strong>
          </div>
          <nav aria-label="Einstellungsbereiche" onKeyDown={event => {
              if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || busy) return;
              const direction = ['ArrowDown','ArrowRight'].includes(event.key) ? 1 : ['ArrowUp','ArrowLeft'].includes(event.key) ? -1 : 0;
              if (!direction && event.key !== 'Home' && event.key !== 'End') return;
              event.preventDefault();
              const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')];
              const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
              const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + direction + buttons.length) % buttons.length;
              buttons[next]?.click(); buttons[next]?.focus();
          }}>
            {SETTINGS_SECTIONS.map((section) => (<button key={section.id} type="button" className={section.id === activeSectionId ? 'active' : ''}
              aria-current={section.id === activeSectionId ? 'page' : undefined} aria-controls="settings-section-panel" onClick={() => selectSection(section.id)}>
                <LucideNamedIcon name={section.icon} size={15}/>
                <span>{section.title}</span>
              </button>))}
          </nav>
        </aside>

        <main className="settings-content">
          <header className="settings-content-header">
            <div>
              <span>{activeSection.eyebrow}</span>
              <h3>{activeSection.title}</h3>
              <p>{activeSection.description}</p>
            </div>
            <button type="button" className="icon-button compact muted" onClick={close} title="Einstellungen schliessen" aria-label="Einstellungen schliessen">
              <LucideNamedIcon name="X" size={16}/>
            </button>
          </header>

          <div className="settings-section-body" ref={sectionBody} id="settings-section-panel" role="region" aria-label={activeSection.title} tabIndex={0}>
            {vaultLoaded && activeSectionId === 'general' && <RecoveryPanel backendUrl={backendUrl} />}
            {activeSectionId === 'agents' && <AgentConnections key={backendUrl + String(vaultLoaded)} backendUrl={backendUrl} vaultLoaded={vaultLoaded} />}
            {activeSectionId === 'general' ? (<section className="settings-block">
                <div className="settings-row">
                  <div>
                    <label htmlFor="settings-display-name">Anrede</label>
                    <p className="muted-copy">Name, mit dem NickNotes dich in der Oberflaeche anspricht.</p>
                  </div>
                  <input id="settings-display-name" value={displayName} onChange={(event) => onDisplayNameChange(event.target.value)} placeholder="Dein Name"/>
                </div>
              </section>) : null}

            {activeSectionId === 'appearance' ? (<section className="settings-block">
                <div className="settings-row">
                  <div>
                    <h4>Theme</h4>
                    <p className="muted-copy">Farben fuer die gesamte App.</p>
                  </div>
                  <select aria-label="Theme" value={selectedColorProfile?.id ?? theme} onChange={(event) => onActiveColorProfileChange(event.target.value)}>
                    {colorProfiles.map((profile) => (<option key={profile.id} value={profile.id}>
                        {profile.name}
                      </option>))}
                  </select>
                </div>
                <div className="theme-profile-actions">
                  <button type="button" onClick={createCustomColorProfile}>
                    Neues Theme
                  </button>
                  {selectedThemeEditable && selectedColorProfile ? (<button type="button" className="danger" onClick={() => removeCustomColorProfile(selectedColorProfile.id)}>
                      Theme loeschen
                    </button>) : null}
                </div>
                {selectedColorProfile ? (<div className="theme-profile-editor">
                    <div className="settings-row">
                      <div>
                        <label htmlFor="settings-color-profile-name">Theme-Name</label>
                        <p className="muted-copy">Light Mode und Dark Mode sind feste Standard-Themes.</p>
                      </div>
                      <input id="settings-color-profile-name" value={themeNameDrafts[selectedColorProfile.id] ?? selectedColorProfile.name} disabled={!selectedThemeEditable} onChange={(event) => {
                    const nextName = event.target.value;
                    setThemeNameDrafts((prev) => ({ ...prev, [selectedColorProfile.id]: nextName }));
                }} onBlur={(event) => {
                    commitThemeName(selectedColorProfile.id, event.currentTarget.value);
                }} onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                        event.preventDefault();
                        commitThemeName(selectedColorProfile.id, event.currentTarget.value);
                        event.currentTarget.blur();
                    }
                }}/>
                    </div>
                    {THEME_COLOR_TOKEN_GROUPS.map((group) => (<section key={group.title} className="theme-token-group">
                        <h4>{group.title}</h4>
                        <div className="theme-token-grid">
                          {group.tokens.map((token: ThemeColorToken) => {
                        const value = themeColorDrafts[selectedColorProfile.id]?.[token] ?? selectedColorProfile.colors[token];
                        const colorInputValue = /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#000000';
                        return (<label key={token} className="theme-token-row">
                                <span>{THEME_COLOR_TOKEN_LABELS[token]}</span>
                                <input type="color" aria-label={`${THEME_COLOR_TOKEN_LABELS[token]} als Farbauswahl`} value={colorInputValue} disabled={!selectedThemeEditable} onChange={(event) => {
                                const nextColor = event.target.value;
                                setThemeColorDrafts((prev) => ({
                                    ...prev,
                                    [selectedColorProfile.id]: {
                                        ...(prev[selectedColorProfile.id] ?? {}),
                                        [token]: nextColor,
                                    },
                                }));
                            }} onBlur={(event) => {
                                commitThemeColor(selectedColorProfile.id, token, event.currentTarget.value);
                            }}/>
                                <input aria-label={`${THEME_COLOR_TOKEN_LABELS[token]} als Farbwert`} value={value} disabled={!selectedThemeEditable} onChange={(event) => {
                                const nextColor = event.target.value;
                                setThemeColorDrafts((prev) => ({
                                    ...prev,
                                    [selectedColorProfile.id]: {
                                        ...(prev[selectedColorProfile.id] ?? {}),
                                        [token]: nextColor,
                                    },
                                }));
                            }} onBlur={(event) => {
                                commitThemeColor(selectedColorProfile.id, token, event.currentTarget.value);
                            }} onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                    event.preventDefault();
                                    commitThemeColor(selectedColorProfile.id, token, event.currentTarget.value);
                                    event.currentTarget.blur();
                                }
                            }}/>
                              </label>);
                    })}
                        </div>
                      </section>))}
                  </div>) : null}
              </section>) : null}



            {activeSectionId === 'imports' ? (<section className="settings-block">
                <div className="import-tool-panel">
          <div className="import-tool-header">
            <div>
              <strong>OneNote importieren</strong>
              <p className="muted-copy">Eine oder mehrere .onepkg-Dateien waehlen und ueber OneNote Desktop importieren.</p>
            </div>
            <button onClick={() => void chooseOneNoteSources()} disabled={!vaultLoaded || oneNotePending}>
              Dateien waehlen
            </button>
          </div>

          <label htmlFor="settings-onenote-target">Zielordner in der NoteBase</label>
          <input id="settings-onenote-target" value={oneNoteTargetFolder} onChange={(event) => setOneNoteTargetFolder(event.target.value)} placeholder="Leer lassen fuer oberste Ebene" disabled={!vaultLoaded || oneNotePending}/>

          {oneNoteSourcePaths.length ? (<div className="import-source-list">
              {oneNoteSourcePaths.map((path) => (<div key={path} className="import-source-row">
                  <span title={path}>{path}</span>
                  <button onClick={() => {
                        setOneNoteSourcePaths((prev) => prev.filter((item) => item !== path));
                        setOneNotePreview(null);
                    }} disabled={oneNotePending}>
                    Entfernen
                  </button>
                </div>))}
            </div>) : null}

          {oneNoteHasPackageSource ? (<p className="import-info-note">
              .onepkg-Import benoetigt OneNote Desktop. NickNotes laesst OneNote die Paketdatei temporaer oeffnen
              und uebernimmt danach die Seiten in deine NoteBase.
            </p>) : null}

          <div className="import-actions">
            <button onClick={() => void previewOneNoteImport()} disabled={!vaultLoaded || oneNotePending || oneNoteSourcePaths.length === 0}>
              Vorschau
            </button>
            <button className="primary" onClick={() => void startOneNoteImport()} disabled={!vaultLoaded || oneNotePending || oneNoteSourcePaths.length === 0}>
              {oneNoteOperation === 'import' ? 'Wird importiert …' : 'Import starten'}
            </button>
          </div>

          {oneNotePreview ? (<div className="import-preview-box">
              <div className="import-preview-stats">
                <span>{oneNotePreview.notebooks} Notizbuecher</span>
                <span>Seiten werden beim Import ermittelt</span>
              </div>
              {oneNotePreview.warnings.length ? (<ul className="import-warning-list">
                  {oneNotePreview.warnings.slice(0, 6).map((warning) => (<li key={warning}>{warning}</li>))}
                </ul>) : null}
              {oneNotePreview.pagesPreview.length ? (<div className="import-page-preview">
                  {oneNotePreview.pagesPreview.slice(0, 8).map((page) => (<div key={page.sourcePath}>
                      <strong>{page.title}</strong>
                      <span>
                        {page.notebook}
                        {page.section ? ` / ${page.section}` : ''}
                      </span>
                    </div>))}
                </div>) : null}
            </div>) : null}

          {oneNoteImportStatus ? (<div className="launch-progress">
              <div className="launch-progress-header">
                <span>{oneNoteImportStatus.phase || 'Import laeuft ...'}</span>
                <strong>{oneNoteImportStatus.total > 0 ? `${oneNoteProgressPercent}%` : '...'}</strong>
              </div>
              <div className={`launch-progress-track ${oneNoteImportStatus.total > 0 ? '' : 'indeterminate'}`}>
                <span style={{ width: oneNoteImportStatus.total > 0 ? `${oneNoteProgressPercent}%` : '42%' }}/>
              </div>
              <p className="launch-progress-meta">
                {oneNoteImportStatus.total > 0
                    ? `${oneNoteImportStatus.processed} von ${oneNoteImportStatus.total} Seiten`
                    : 'OneNote bereitet die Seiten vor ...'}
              </p>
              {oneNoteImportStatus.currentPath ? (<p className="launch-progress-path">{oneNoteImportStatus.currentPath}</p>) : null}
            </div>) : null}

          {oneNoteMessage ? <p className="launch-message">{oneNoteMessage}</p> : null}
          {oneNoteError ? <p className="launch-error">{oneNoteError}</p> : null}
                </div>
              </section>) : null}

            {activeSectionId === 'layout' ? (<section className="settings-block">
                <label className="settings-toggle-row" htmlFor="settings-sidebar-open">
                  <span>
                    <strong>Sidebar anzeigen</strong>
                    <small>Linken Arbeitsbereich beim Start sichtbar halten.</small>
                  </span>
                  <input id="settings-sidebar-open" type="checkbox" checked={sidebarOpen} onChange={(event) => setSidebarOpen(event.target.checked)}/>
                </label>
              </section>) : null}

            {activeSectionId === 'explorer' ? (<section className="settings-block">
                <label className="settings-toggle-row" htmlFor="settings-explorer-show-hidden">
                  <span>
                    <strong>Nicht-Markdown-Dateien anzeigen</strong>
                    <small>Auch Hilfsdateien und andere Dateitypen im Explorer einblenden.</small>
                  </span>
                  <input id="settings-explorer-show-hidden" type="checkbox" checked={explorerOptions.showHiddenFiles} onChange={(event) => setExplorerOptions((prev) => ({ ...prev, showHiddenFiles: event.target.checked }))}/>
                </label>
                <label className="settings-toggle-row" htmlFor="settings-explorer-folders-first">
                  <span>
                    <strong>Ordner zuerst anzeigen</strong>
                    <small>Ordner vor Notizen und Dateien sortieren.</small>
                  </span>
                  <input id="settings-explorer-folders-first" type="checkbox" checked={explorerOptions.foldersFirst} onChange={(event) => setExplorerOptions((prev) => ({ ...prev, foldersFirst: event.target.checked }))}/>
                </label>
                <label className="settings-toggle-row" htmlFor="settings-explorer-show-icons">
                  <span>
                    <strong>Dateisymbole anzeigen</strong>
                    <small>Icons fuer Dateitypen und Ordner sichtbar machen.</small>
                  </span>
                  <input id="settings-explorer-show-icons" type="checkbox" checked={explorerOptions.showIcons} onChange={(event) => setExplorerOptions((prev) => ({ ...prev, showIcons: event.target.checked }))}/>
                </label>
                <label className="settings-toggle-row" htmlFor="settings-explorer-compact">
                  <span>
                    <strong>Kompakte Zeilen</strong>
                    <small>Mehr Eintraege auf gleicher Flaeche anzeigen.</small>
                  </span>
                  <input id="settings-explorer-compact" type="checkbox" checked={explorerOptions.compactMode} onChange={(event) => setExplorerOptions((prev) => ({ ...prev, compactMode: event.target.checked }))}/>
                </label>
              </section>) : null}

            {activeSectionId === 'statusbar' ? (<section className="settings-block">
                <label className="settings-toggle-row" htmlFor="settings-status-notebase">
                  <span>
                    <strong>NoteBase-Name anzeigen</strong>
                    <small>Aktuelle NoteBase in der Statusleiste nennen.</small>
                  </span>
                  <input id="settings-status-notebase" type="checkbox" checked={statusBarPrefs.showNoteBaseName} onChange={(event) => setStatusBarPrefs((prev) => ({ ...prev, showNoteBaseName: event.target.checked }))}/>
                </label>
                <label className="settings-toggle-row" htmlFor="settings-status-open-tasks">
                  <span>
                    <strong>Offene Tasks anzeigen</strong>
                    <small>Anzahl offener Aufgaben dauerhaft sichtbar halten.</small>
                  </span>
                  <input id="settings-status-open-tasks" type="checkbox" checked={statusBarPrefs.showOpenTasks} onChange={(event) => setStatusBarPrefs((prev) => ({ ...prev, showOpenTasks: event.target.checked }))}/>
                </label>
                <label className="settings-toggle-row" htmlFor="settings-status-due-today">
                  <span>
                    <strong>Heute faellige Tasks anzeigen</strong>
                    <small>Faellige Arbeit fuer den heutigen Tag hervorheben.</small>
                  </span>
                  <input id="settings-status-due-today" type="checkbox" checked={statusBarPrefs.showDueToday} onChange={(event) => setStatusBarPrefs((prev) => ({ ...prev, showDueToday: event.target.checked }))}/>
                </label>
                <label className="settings-toggle-row" htmlFor="settings-status-total-notes">
                  <span>
                    <strong>Anzahl Notizen anzeigen</strong>
                    <small>Gesamtumfang der NoteBase in der Statusleiste zeigen.</small>
                  </span>
                  <input id="settings-status-total-notes" type="checkbox" checked={statusBarPrefs.showTotalNotes} onChange={(event) => setStatusBarPrefs((prev) => ({ ...prev, showTotalNotes: event.target.checked }))}/>
                </label>
                <label className="settings-toggle-row" htmlFor="settings-status-message">
                  <span>
                    <strong>Statusmeldung anzeigen</strong>
                    <small>Rueckmeldungen wie Speichern oder Import unten anzeigen.</small>
                  </span>
                  <input id="settings-status-message" type="checkbox" checked={statusBarPrefs.showStateMessage} onChange={(event) => setStatusBarPrefs((prev) => ({ ...prev, showStateMessage: event.target.checked }))}/>
                </label>
              </section>) : null}

            {activeSectionId === 'tasks' ? (<section className="settings-block">
                <label className="settings-toggle-row" htmlFor="settings-task-advanced">
                  <span>
                    <strong>Detailliertes Task-Handling</strong>
                    <small>Blocker, Waiting, Follow-up und Next Action verwenden.</small>
                  </span>
                  <input id="settings-task-advanced" type="checkbox" checked={taskFeatureSettings.advancedTaskHandling} onChange={(event) => setTaskFeatureSettings((prev) => ({ ...prev, advancedTaskHandling: event.target.checked }))}/>
                </label>
                <label className="settings-toggle-row" htmlFor="settings-task-time-management">
                  <span>
                    <strong>Zeitmanagement bei Tasks</strong>
                    <small>Aufwandsschaetzungen fuer Aufgaben aktivieren.</small>
                  </span>
                  <input id="settings-task-time-management" type="checkbox" checked={taskFeatureSettings.taskTimeManagement} onChange={(event) => setTaskFeatureSettings((prev) => ({ ...prev, taskTimeManagement: event.target.checked }))}/>
                </label>
              </section>) : null}
          </div>

          <footer className="settings-modal-actions">
            <div className="settings-save-feedback">
              {saveError ? <p role="alert">{saveError}</p> : null}
              <span role="status">{saving ? 'Einstellungen werden gespeichert …' : oneNoteOperation === 'picker' ? 'Dateiauswahl ist geöffnet …' : oneNoteOperation === 'preview' ? 'Importvorschau wird geladen …' : oneNoteOperation === 'import' ? 'Import läuft. Bitte warten …' : settingsDirty
                ? 'Nicht gespeicherte Änderungen' : 'Alle Einstellungen gespeichert'}</span>
            </div>
            <div>
              <button onClick={() => {
                  onDiscard();
                  root.current?.querySelector<HTMLButtonElement>('.settings-nav button[aria-current="page"]')?.focus();
              }} disabled={!settingsDirty}>
                Verwerfen
              </button>
              <button className="primary" onClick={onSave} disabled={!settingsDirty}>
                Speichern
              </button>
            </div>
          </footer>
        </main>
        </fieldset>
      </div>
    </div>, document.body);
}
