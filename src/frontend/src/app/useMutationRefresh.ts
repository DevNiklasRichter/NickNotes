import {useCallback} from 'react'
import {connectionEpoch} from './apiClient'
import {mutationAffectsGraph,mutationRefreshPlan,type AppMutationEvent} from './mutationEvents'
import type {GraphIndexStatus} from './AppShared'
import type {Dispatch,SetStateAction} from 'react'
import {normalizeFilePathKey} from './AppShared'

type Refresh=(force?:boolean)=>Promise<void>
type Options={vaultLoaded:boolean;searchQuery:string;runSearch:(query:string)=>Promise<void>;
  refreshTasks:Refresh;refreshTodos:Refresh;refreshReview:Refresh;refreshNoteGroups:Refresh;
  refreshFocusAggregate:Refresh;refreshAllNotes:Refresh;refreshExplorerFiles:Refresh;
  refreshOpenTabsFromDisk:(paths:string[])=>Promise<void>;
  setLatestGraphStatus:(status:GraphIndexStatus)=>void;setGraphUpdateToken:Dispatch<SetStateAction<number>>;warn:(message:string)=>void}

/** Expand overlapping plans once. A failed projection refresh never makes a committed write fail. */
export function useMutationRefresh(options:Options) {
  const {vaultLoaded,searchQuery,runSearch,refreshTasks,refreshTodos,refreshReview,refreshNoteGroups,
    refreshFocusAggregate,refreshAllNotes,refreshExplorerFiles,refreshOpenTabsFromDisk,
    setLatestGraphStatus,setGraphUpdateToken,warn}=options
  return useCallback(async(event:AppMutationEvent)=>{
    if(!vaultLoaded)return
    const epoch=connectionEpoch(),plan=mutationRefreshPlan(event)
    if(mutationAffectsGraph(event)){
      if(event.graphStatus)setLatestGraphStatus(event.graphStatus)
      setGraphUpdateToken(value=>value+1)
    }
    const work:Promise<void>[]=[]
    if(plan.focusAggregate)work.push(refreshFocusAggregate())
    if((plan.tasks||plan.explorerSidebar)&&!plan.focusAggregate)work.push(refreshTasks())
    if(plan.todos&&!plan.focusAggregate)work.push(refreshTodos())
    if(plan.review)work.push(refreshReview())
    if(plan.noteGroups||plan.explorerSidebar)work.push(refreshNoteGroups())
    if(plan.search)work.push(runSearch(searchQuery))
    if(plan.search&&searchQuery.trim()&&!plan.focusAggregate)work.push(refreshAllNotes())
    if(plan.explorerSidebar){
      if(!plan.search&&!plan.focusAggregate)work.push(refreshAllNotes())
      // Empty search already refreshes file rows and all note targets.
      if(!plan.search||searchQuery.trim())work.push(refreshExplorerFiles())
    }
    const paths=new Map((event.paths??[]).map(path=>[normalizeFilePathKey(path),path]))
    if(paths.size)work.push(refreshOpenTabsFromDisk([...paths.values()]))
    const results=await Promise.allSettled(work)
    if(epoch===connectionEpoch()&&results.some(result=>result.status==='rejected'))warn('Die Änderung wurde gespeichert. Einige Ansichten konnten nicht aktualisiert werden. Öffne die betroffene Ansicht erneut.')
  },[vaultLoaded,searchQuery,runSearch,refreshTasks,refreshTodos,refreshReview,refreshNoteGroups,refreshFocusAggregate,
    refreshAllNotes,refreshExplorerFiles,refreshOpenTabsFromDisk,setLatestGraphStatus,setGraphUpdateToken,warn])
}
