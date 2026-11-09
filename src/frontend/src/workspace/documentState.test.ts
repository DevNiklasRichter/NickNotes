import {describe, expect, test} from 'vitest'
import type {NoteTab} from '../app/AppShared'
import {mergeExternalDocument, mergeSavedTab} from './documentState'
import {parseNoteDocument, serializeNoteDocument} from '../editor/noteDocument'
const original: NoteTab = {id:'one',kind:'note',path:'/vault/Note.md',title:'Note',content:'old',revision:'old-revision',dirty:true,loading:false}
const saved = {path:'/vault/Renamed.md',content:'stored',revision:'new-revision',title:'Renamed'}
describe('document concurrency', () => {
 test('body edits in parsedDocument survive a delayed save while raw content stays unchanged', () => {
   const document=parseNoteDocument('Submitted body','Note')
   const submitted={...original,parsedDocument:document}
   const current={...submitted,parsedDocument:{...document,body:'Newer unsaved body'}}
   const stored={...saved,content:serializeNoteDocument(document)}
   const result=mergeSavedTab(current,submitted,stored)
   expect(result.parsedDocument?.body).toBe('Newer unsaved body')
   expect(result.dirty).toBe(true)
   expect(result.revision).toBe(stored.revision)
 })
 test('property edits in parsedDocument survive a delayed save', () => {
   const document=parseNoteDocument('Submitted body','Note')
   const submitted={...original,parsedDocument:document}
   const current={...submitted,title:'Newer title',parsedDocument:{...document,frontmatter:{...document.frontmatter,title:'Newer title'}}}
   const result=mergeSavedTab(current,submitted,{...saved,content:serializeNoteDocument(document)})
   expect(result.title).toBe('Newer title')
   expect(result.parsedDocument?.frontmatter.title).toBe('Newer title')
   expect(result.dirty).toBe(true)
 })
 test('equivalent parsed snapshots become clean after saving', () => {
   const document=parseNoteDocument('Submitted body','Note')
   const stored={...saved,content:serializeNoteDocument(document)}
   const submitted={...original,content:stored.content,parsedDocument:document}
   const current={...original,parsedDocument:parseNoteDocument(stored.content,'Note')}
   expect(mergeSavedTab(current,submitted,stored).dirty).toBe(false)
 })
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
