import {useLayoutEffect, useMemo, useRef, type RefObject, type Dispatch, type SetStateAction} from 'react'
import {flushSync} from 'react-dom'
import type {WorkspaceState, WorkspaceAction} from './workspaceState'
import type {AppMutationEvent} from '../app/mutationEvents'
import type {TagGroupDefinition} from '../tags/tagTypes'
import type {GraphIndexStatus, VaultCounts} from '../app/AppShared'
import type {MarkdownEditorApi} from '../editor/CodeMirrorMarkdownEditor'
import {mergeSavedTab, mergeExternalDocument} from '../workspace/documentState'
import type {NoteSaveResponse} from '../contracts/apiContracts'
import {parseNoteDocument, serializeNoteDocument} from '../editor/noteDocument'
import {findPaneByTabId, findOpenTabByNoteId, getActiveTabIdForPane, type PaneId} from '../workspace/workspaceState'
import {apiRequest, getFileName, toNoteDisplayName, normalizeFilePathKey, normalizeNoteTypeValue, normalizeLabel, toStorageTagGroups} from '../app/AppShared'
import type {NoteTab} from '../app/AppShared'

type NoteDocumentContext = {
 backendUrl:string
 workspaceStateRef:RefObject<WorkspaceState>; openTabsRef:RefObject<NoteTab[]>
 leftEditorRef:RefObject<MarkdownEditorApi|null>; rightEditorRef:RefObject<MarkdownEditorApi|null>
 findTabByPath:(path:string,tabs?:NoteTab[])=>NoteTab|null
 setMessage:(value:string)=>void; setError:(value:string)=>void
 setCounts:Dispatch<SetStateAction<VaultCounts>>; setCustomTagGroups:Dispatch<SetStateAction<TagGroupDefinition[]>>
 setLatestGraphStatus:Dispatch<SetStateAction<GraphIndexStatus|null>>; setGraphUpdateToken:Dispatch<SetStateAction<number>>
 remapOpenNotePaths:(from:string,to:string)=>void
 setOpenTabs:Dispatch<SetStateAction<NoteTab[]>>
 emitMutationEvent:(event:AppMutationEvent)=>Promise<void>
 toNoteId:(path:string)=>string; confirmCloseTab:(id:string)=>Promise<boolean>
 isTagOverviewPath:(path:string)=>boolean
 dispatchWorkspace:(action:WorkspaceAction)=>void
 setEditorPanelOpen:Dispatch<SetStateAction<boolean>>
 createTabId:()=>string; isTagOverviewReadOnly:(path:string,content:string)=>boolean
}

function createActions(context:NoteDocumentContext) {
const getLiveMarkdownForTab = (tab: NoteTab): string | null => {
        const paneId = findPaneByTabId(context.workspaceStateRef.current, tab.id);
        if (!paneId) {
            return null;
        }
        const activeTabId = getActiveTabIdForPane(context.workspaceStateRef.current, paneId);
        if (activeTabId !== tab.id) {
            return null;
        }
        const editorApi = paneId === 'left' ? context.leftEditorRef.current : context.rightEditorRef.current;
        return editorApi?.getMarkdown() ?? null;
    };

const saveNoteTab = async (path: string): Promise<boolean> => {
        flushSync(()=>{context.leftEditorRef.current?.flushChanges();context.rightEditorRef.current?.flushChanges()});
        const targetTab = context.findTabByPath(path);
        if (!targetTab || targetTab.kind !== 'note' || targetTab.loading || !targetTab.dirty) {
            return true;
        }
        if (targetTab.readOnly) {
            context.setMessage('Diese Tag-Overview wird automatisch generiert und ist schreibgeschuetzt.');
            return true;
        }
        const baseDocument = targetTab.parsedDocument ?? parseNoteDocument(targetTab.content, targetTab.title || toNoteDisplayName(targetTab.path));
        const liveBody = getLiveMarkdownForTab(targetTab);
        const nextDocument = liveBody !== null ? { ...baseDocument, body: liveBody } : baseDocument;
        const liveContent = serializeNoteDocument(nextDocument);
        try {
            context.setError('');
            const response = await apiRequest<NoteSaveResponse>(context.backendUrl, '/notes/save', {
                method: 'POST',
                body: JSON.stringify({ path: targetTab.path, content: liveContent, expectedRevision: targetTab.revision }),
            });
            context.setCounts(response.counts);
            if (response.tagGroups) {
                context.setCustomTagGroups(toStorageTagGroups(response.tagGroups));
            }
            if (response.graphStatus) {
                context.setLatestGraphStatus(response.graphStatus);
                context.setGraphUpdateToken((current) => current + 1);
            }
            const savedPath = (response.path || targetTab.path || '').trim();
            if (savedPath && savedPath !== targetTab.path) {
                context.remapOpenNotePaths(targetTab.path, savedPath);
            }
            context.setOpenTabs((prev) => prev.map((tab) => {
                if (tab.path !== path && tab.path !== savedPath) {
                    return tab;
                }
                return mergeSavedTab(tab, targetTab, {path: savedPath || tab.path, content: response.content, revision: response.revision, title: response.title});
            }));
            context.setMessage(`Notiz gespeichert: ${response.title || targetTab.title}`);
            await context.emitMutationEvent({
                kind: 'note-saved',
                noteType: targetTab.noteType === 'task' ? 'task' : 'note',
                paths: [savedPath || path, ...(response.linkRewrite?.paths ?? [])],
                graphStatus: response.graphStatus,
                refresh: {
                    search: true,
                    tasks: targetTab.noteType === 'task',
                    todos: true,
                    review: true,
                    noteGroups: true,
                    explorerSidebar: true,
                },
            });
            return true;
        }
        catch (caught) {
            context.setError(String(caught));
            return false;
        }
    };

const saveTab = async (path: string): Promise<boolean> => {
        const targetTab = context.findTabByPath(path);
        if (!targetTab) {
            return true;
        }
        if (targetTab.kind === 'todo_dashboard' ||
            targetTab.kind === 'task_dashboard' ||
            targetTab.kind === 'focus_dashboard' ||
            targetTab.kind === 'review_dashboard' ||
            targetTab.kind === 'graph_dashboard') {
            return true;
        }
        return saveNoteTab(path);
    };

const fetchNoteContent = async (path: string) => apiRequest<{path: string; content: string; revision: string}>(context.backendUrl, `/notes/content?path=${encodeURIComponent(path)}`);

const openNoteInTab = async (path: string, suggestedTitle?: string, options?: {
        activate?: boolean;
        replacePath?: string;
        initialNoteType?: 'note' | 'task';
        targetPane?: PaneId;
    }) => {
        const cleanPath = normalizeLabel(path);
        if (!cleanPath) {
            return;
        }
        const shouldActivate = options?.activate !== false;
        const initialNoteType = normalizeNoteTypeValue(options?.initialNoteType);
        const fallbackTitle = suggestedTitle?.trim() || getFileName(cleanPath);
        const targetPane = options?.targetPane ?? context.workspaceStateRef.current.lastFocusedPane;
        const explicitTargetPane = Boolean(options?.targetPane);
        const replacePath = normalizeLabel(options?.replacePath ?? '');
        const replaceIsDifferent = replacePath && context.toNoteId(replacePath) !== context.toNoteId(cleanPath);
        if (replaceIsDifferent) {
            const replaceTab = context.findTabByPath(replacePath);
            if (replaceTab?.kind === 'note' && replaceTab.dirty) {
                const canReplace = await context.confirmCloseTab(replaceTab.id);
                if (!canReplace) {
                    return;
                }
            }
        }
        const existingOpenRef = findOpenTabByNoteId(context.workspaceStateRef.current, context.toNoteId(cleanPath));
        const existing = (existingOpenRef ? context.openTabsRef.current.find((tab) => tab.id === existingOpenRef.id) ?? null : null) ?? context.findTabByPath(cleanPath);
        if (existing) {
            if (existing.kind === 'note' && (!existing.noteType || (!existing.readOnly && context.isTagOverviewPath(existing.path)))) {
                context.setOpenTabs((prev) => prev.map((tab) => tab.id === existing.id && tab.kind === 'note'
                    ? {
                        ...tab,
                        noteType: initialNoteType,
                        readOnly: tab.readOnly || context.isTagOverviewPath(tab.path),
                    }
                    : tab));
            }
            if (replaceIsDifferent) {
                const replaceTab = context.findTabByPath(replacePath);
                if (replaceTab && replaceTab.id !== existing.id) {
                    context.setOpenTabs((prev) => prev.filter((tab) => tab.id !== replaceTab.id));
                    context.dispatchWorkspace({ type: 'CLOSE_TAB', tabId: replaceTab.id });
                }
            }
            context.setEditorPanelOpen(true);
            if (shouldActivate) {
                if (explicitTargetPane) {
                    context.dispatchWorkspace({
                        type: 'OPEN_TAB',
                        paneId: targetPane,
                        tabId: existing.id,
                        activate: true,
                    });
                }
                else {
                    const existingPane = findPaneByTabId(context.workspaceStateRef.current, existing.id);
                    if (existingPane) {
                        context.dispatchWorkspace({
                            type: 'ACTIVATE_TAB',
                            paneId: existingPane,
                            tabId: existing.id,
                        });
                    }
                    else {
                        context.dispatchWorkspace({
                            type: 'OPEN_TAB',
                            paneId: targetPane,
                            tabId: existing.id,
                            activate: true,
                        });
                    }
                }
            }
            return;
        }
        let nextTabId = context.createTabId();
        const replaceTab = replaceIsDifferent ? context.findTabByPath(replacePath) : null;
        if (replaceTab?.kind === 'note') {
            nextTabId = replaceTab.id;
        }
        const loadingTab: NoteTab = {
            id: nextTabId,
            kind: 'note',
            path: cleanPath,
            title: fallbackTitle,
            content: '',
            loading: true,
            dirty: false,
            readOnly: context.isTagOverviewPath(cleanPath),
            noteType: initialNoteType,
        };
        context.setOpenTabs((prev) => {
            const withoutPathDuplicates = prev.filter((tab) => context.toNoteId(tab.path) !== context.toNoteId(cleanPath));
            if (replaceTab) {
                const replaceIndex = withoutPathDuplicates.findIndex((tab) => tab.id === replaceTab.id);
                if (replaceIndex >= 0) {
                    const next = [...withoutPathDuplicates];
                    next.splice(replaceIndex, 1, loadingTab);
                    return next;
                }
            }
            return [...withoutPathDuplicates, loadingTab];
        });
        context.setEditorPanelOpen(true);
        if (shouldActivate) {
            context.dispatchWorkspace({
                type: 'OPEN_TAB',
                paneId: targetPane,
                tabId: nextTabId,
                activate: true,
            });
        }
        else if (!findPaneByTabId(context.workspaceStateRef.current, nextTabId)) {
            context.dispatchWorkspace({
                type: 'OPEN_TAB',
                paneId: targetPane,
                tabId: nextTabId,
                activate: false,
            });
        }
        try {
            const loaded = await fetchNoteContent(cleanPath);
            const content = loaded.content;
            const parsed = parseNoteDocument(content, fallbackTitle);
            const normalizedContent = serializeNoteDocument(parsed);
            const nextTitle = parsed.frontmatter.title || fallbackTitle;
            const readOnly = context.isTagOverviewReadOnly(cleanPath, content);
            context.setOpenTabs((prev) => prev.map((tab) => tab.id === nextTabId
                ? {
                    ...tab,
                    title: nextTitle,
                    path: cleanPath,
                    content: normalizedContent,
                    revision: loaded.revision,
                    conflict: false,
                    loading: false,
                    dirty: false,
                    readOnly,
                    noteType: normalizeNoteTypeValue(parsed.frontmatter.type),
                    parsedDocument: parsed,
                }
                : tab));
        }
        catch (caught) {
            context.setOpenTabs((prev) => prev.filter((tab) => tab.id !== nextTabId));
            context.dispatchWorkspace({ type: 'CLOSE_TAB', tabId: nextTabId });
            context.setError(String(caught));
        }
    };

async function refreshOpenTabsFromDisk(paths: string[]) {
        if (paths.length === 0) {
            return;
        }
        const pathKeys = new Set(paths.map(normalizeFilePathKey));
        const noteTabs = context.openTabsRef.current.filter((tab) => tab.kind === 'note' && pathKeys.has(normalizeFilePathKey(tab.path)));
        await Promise.allSettled(noteTabs.map(async (tab) => {
            const response = await apiRequest<{
                path: string;
                content: string;
                revision: string;
            }>(context.backendUrl, `/notes/content?path=${encodeURIComponent(tab.path)}`);
            context.setOpenTabs((tabs) => tabs.map((entry) => entry.id === tab.id ? mergeExternalDocument(entry, response) : entry));
        }));
    }
return {getLiveMarkdownForTab, saveNoteTab, saveTab, fetchNoteContent, openNoteInTab, refreshOpenTabsFromDisk}
}

/** Stable document actions with current connection, drafts and editor references. */
export function useNoteDocuments(context:NoteDocumentContext) {
 const latest=useRef(context)
 useLayoutEffect(()=>{latest.current=context})
 return useMemo(()=>createActions({
get workspaceStateRef(){return latest.current.workspaceStateRef},
get leftEditorRef(){return latest.current.leftEditorRef},
get rightEditorRef(){return latest.current.rightEditorRef},
get findTabByPath(){return latest.current.findTabByPath},
get setMessage(){return latest.current.setMessage},
get setError(){return latest.current.setError},
get backendUrl(){return latest.current.backendUrl},
get setCounts(){return latest.current.setCounts},
get setCustomTagGroups(){return latest.current.setCustomTagGroups},
get setLatestGraphStatus(){return latest.current.setLatestGraphStatus},
get setGraphUpdateToken(){return latest.current.setGraphUpdateToken},
get remapOpenNotePaths(){return latest.current.remapOpenNotePaths},
get setOpenTabs(){return latest.current.setOpenTabs},
get emitMutationEvent(){return latest.current.emitMutationEvent},
get toNoteId(){return latest.current.toNoteId},
get confirmCloseTab(){return latest.current.confirmCloseTab},
get openTabsRef(){return latest.current.openTabsRef},
get isTagOverviewPath(){return latest.current.isTagOverviewPath},
get dispatchWorkspace(){return latest.current.dispatchWorkspace},
get setEditorPanelOpen(){return latest.current.setEditorPanelOpen},
get createTabId(){return latest.current.createTabId},
get isTagOverviewReadOnly(){return latest.current.isTagOverviewReadOnly}
 }),[])
}
