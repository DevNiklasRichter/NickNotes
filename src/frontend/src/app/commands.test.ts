import {expect,test} from 'vitest'
import {COMMANDS, commandForKey, commandTitle, matchesShortcut, type CommandSpec} from './commands'
const key=(value:string,modifiers:Partial<Pick<KeyboardEvent,'ctrlKey'|'altKey'|'shiftKey'|'metaKey'|'code'>>={})=>({key:value,code:'',ctrlKey:false,metaKey:false,altKey:false,shiftKey:false,...modifiers})
test('shortcuts use exact modifiers so save-all never becomes save and typing stays local',()=>{
  expect(commandForKey(key('s',{ctrlKey:true}))?.id).toBe('save')
  expect(commandForKey(key('S',{ctrlKey:true,shiftKey:true}))?.id).toBe('saveAll')
  expect(commandForKey(key('n'))).toBeUndefined()
  expect(commandForKey(key('b',{ctrlKey:true}))).toBeUndefined() // Markdown bold must remain intact.
  expect(commandForKey(key('n',{ctrlKey:true,altKey:true}))).toBeUndefined()
  expect(commandForKey(key('Delete'))).toBeUndefined() // Never delete a file when deleting text.
  expect(commandForKey(key('Delete',{ctrlKey:true,shiftKey:true}))?.id).toBe('deleteNote')
})
test('common aliases, platform modifier and non-US physical split key work',()=>{
  expect(commandForKey(key('F4',{ctrlKey:true}))?.id).toBe('closeTab')
  expect(commandForKey(key('F8'))?.id).toBe('split')
  expect(commandForKey(key('z',{metaKey:true,shiftKey:true}))?.id).toBe('redo')
  expect(commandForKey(key(' ',{ctrlKey:true,shiftKey:true}))?.id).toBe('capture')
  expect(matchesShortcut(key('unknown',{ctrlKey:true,code:'Backslash'}),'Mod+\\')).toBe(true)
})

test('app search has its own shortcut while Markdown palette shortcuts keep their owner',()=>{
  expect(commandForKey(key('p',{ctrlKey:true}))?.id).toBe('commandPalette')
  expect(commandForKey(key('P',{ctrlKey:true,shiftKey:true}))?.id).toBe('format')
  expect(commandForKey(key('k',{ctrlKey:true}))).toBeUndefined()
})
test('every menu/tool hint comes from an unambiguous command catalog',()=>{
  expect(new Set(COMMANDS.map(command=>command.id)).size).toBe(COMMANDS.length)
  const shortcuts=(COMMANDS as readonly CommandSpec[]).flatMap(command=>[command.shortcut,...command.aliases??[]].filter(Boolean))
  expect(new Set(shortcuts).size).toBe(shortcuts.length)
  expect(commandTitle('save')).toContain('Strg+S')
})
