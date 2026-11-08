import {describe, expect, test} from 'vitest'
import type {NoteTab} from '../app/AppShared'
import {mergeExternalDocument, mergeSavedTab} from './documentState'
const original: NoteTab = {id:'one',kind:'note',path:'/vault/Note.md',title:'Note',content:'old',revision:'old-revision',dirty:true,loading:false}
const saved = {path:'/vault/Renamed.md',content:'stored',revision:'new-revision',title:'Renamed'}
describe('document concurrency', () => {
 test('typing during save survives with the new stored base revision', () => {
   const result=mergeSavedTab({...original,content:'newer draft'},original,saved)
   expect(result.content).toBe('newer draft'); expect(result.dirty).toBe(true)
   expect(result.revision).toBe('new-revision'); expect(result.path).toBe('/vault/Renamed.md')
 })
 test('unchanged submitted draft becomes the canonical stored document', () => {
   const result=mergeSavedTab(original,original,saved)
   expect(result.content).toBe('stored'); expect(result.dirty).toBe(false)
 })
 test('external refresh preserves a dirty draft and its original base revision', () => {
   const result=mergeExternalDocument(original,saved)
   expect(result.content).toBe('old'); expect(result.revision).toBe('old-revision'); expect(result.conflict).toBe(true)
 })
 test('clean tabs follow external changes', () => {
   const result=mergeExternalDocument({...original,dirty:false},saved)
   expect(result.content).toBe('stored'); expect(result.revision).toBe('new-revision'); expect(result.conflict).toBe(false)
 })
})
