import {expect,test} from 'vitest'
import {changedDocumentPaths} from './useExternalChanges'
test('selective reconciliation requires a complete consecutive event; gaps and truncation reconcile every document',()=>{
  const state={vaultLoaded:true,vaultPath:null,noteBasePath:null,counts:null,sessionId:'synthetic',pendingRecovery:[],changeVersion:5,lastChange:{operation:'synthetic',version:5,paths:['C:\\Notes\\A.md'],truncated:false}}
  expect([...changedDocumentPaths(state,4)!]).toEqual(['c:/notes/a.md'])
  expect(changedDocumentPaths(state,3)).toBeNull()
  expect(changedDocumentPaths({...state,lastChange:{...state.lastChange,truncated:true}},4)).toBeNull()
  expect(changedDocumentPaths({...state,lastChange:{...state.lastChange,paths:[]}},4)).toBeNull()
})
