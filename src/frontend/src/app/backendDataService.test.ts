import {afterEach,expect,test,vi} from 'vitest'
import type {SearchRow} from './AppShared'
afterEach(()=>{vi.unstubAllGlobals();vi.resetModules()})
async function fixture(fetch:typeof globalThis.fetch){
  vi.stubGlobal('window',{nicknotes:{getBackendToken:async()=>''}});vi.stubGlobal('fetch',fetch)
  const {BackendDataService}=await import('./backendDataService')
  const writers={setTasks:vi.fn(),setTodos:vi.fn(),setExplorerFiles:vi.fn(),setSearchResults:vi.fn(),setAllNotes:vi.fn(),setReviewDashboardData:vi.fn(),setFocusDashboardStats:vi.fn(),setCounts:vi.fn(),setFocusMitIds:vi.fn(),setCustomTagGroups:vi.fn(),setNoteGroups:vi.fn(),setError:vi.fn()}
  return {service:new BackendDataService({getBackendUrl:()=>'http://127.0.0.1:8765',isVaultLoaded:()=>true,getReviewWindow:()=>'30d'},writers),writers}
}
test('a full workspace refresh reads each projection once, using the aggregate for tasks and todos',async()=>{
  const fetch=vi.fn<typeof globalThis.fetch>().mockImplementation(async()=>new Response(JSON.stringify({items:[],groups:[],tasks:[],todos:[],notes:[],mitIds:[],stats:{}})))
  const {service,writers}=await fixture(fetch)
  await service.refreshWorkspaceData('')
  const endpoints=fetch.mock.calls.map(([url])=>new URL(String(url)).pathname)
  expect(endpoints.sort()).toEqual(['/explorer/files','/focus/dashboard','/note-groups','/review/dashboard','/search','/tag-groups'])
  expect(writers.setTasks).toHaveBeenCalledTimes(1);expect(writers.setTodos).toHaveBeenCalledTimes(1)
})
test('late searches cannot replace newer results or reread the entire note catalog on every query',async()=>{
  let resolve!:(response:Response)=>void
  const fetch=vi.fn<typeof globalThis.fetch>().mockImplementation(async url=>String(url).includes('old')?new Promise(done=>{resolve=done}):new Response(JSON.stringify({items:[{title:'New'}]})))
  const {service,writers}=await fixture(fetch)
  const old=service.runSearch('old');await vi.waitFor(()=>expect(resolve).toBeDefined())
  await service.runSearch('new');resolve(new Response(JSON.stringify({items:[{title:'Old'}]})));await old
  expect(writers.setSearchResults.mock.calls).toEqual([[[{title:'New'} as SearchRow]]])
  expect(writers.setAllNotes).not.toHaveBeenCalled();expect(fetch).toHaveBeenCalledTimes(2)
})
