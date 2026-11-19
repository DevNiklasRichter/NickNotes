/** One vocabulary for menus, keyboard shortcuts, help and toolbar hints. */
export const COMMANDS = [
  {id:'newNote', label:'Neue Notiz', group:'Datei', shortcut:'Mod+N'},
  {id:'newTask', label:'Neuer Task', group:'Datei', shortcut:'Mod+Shift+N'},
  {id:'openNote', label:'Notiz öffnen …', group:'Datei', shortcut:'Mod+O'},
  {id:'commandPalette', label:'App-Befehle suchen …', group:'Bearbeiten', shortcut:'Mod+P'},
  {id:'openVault', label:'NoteBase öffnen …', group:'Datei', shortcut:'Mod+Shift+O'},
  {id:'newVault', label:'NoteBase erstellen …', group:'Datei'},
  {id:'daily', label:'Heutige Tagesnotiz', group:'Datei', shortcut:'Mod+Alt+D'},
  {id:'save', label:'Speichern', group:'Datei', shortcut:'Mod+S'},
  {id:'saveAll', label:'Alle speichern', group:'Datei', shortcut:'Mod+Shift+S'},
  {id:'deleteNote', label:'Aktuelle Datei löschen …', group:'Datei', shortcut:'Mod+Shift+Delete'},
  {id:'closeTab', label:'Aktive Ansicht schließen', group:'Datei', shortcut:'Mod+W', aliases:['Mod+F4']},
  {id:'settings', label:'Einstellungen …', group:'Datei', shortcut:'Mod+,'},
  {id:'quit', label:'Beenden', group:'Datei', shortcut:'Alt+F4', native:true},
  {id:'undo', label:'Rückgängig', group:'Bearbeiten', shortcut:'Mod+Z', native:true},
  {id:'redo', label:'Wiederholen', group:'Bearbeiten', shortcut:'Mod+Y', aliases:['Mod+Shift+Z'], native:true},
  {id:'cut', label:'Ausschneiden', group:'Bearbeiten', shortcut:'Mod+X', native:true},
  {id:'copy', label:'Kopieren', group:'Bearbeiten', shortcut:'Mod+C', native:true},
  {id:'paste', label:'Einfügen', group:'Bearbeiten', shortcut:'Mod+V', native:true},
  {id:'selectAll', label:'Alles auswählen', group:'Bearbeiten', shortcut:'Mod+A', native:true},
  {id:'find', label:'In Notiz suchen', group:'Bearbeiten', shortcut:'Mod+F'},
  {id:'format', label:'Markdown-Befehle …', group:'Bearbeiten', shortcut:'Mod+Shift+P'},
  {id:'search', label:'NoteBase durchsuchen', group:'Bearbeiten', shortcut:'Mod+Shift+F'},
  {id:'closeOthers', label:'Andere Ansichten schließen', group:'Ansicht', shortcut:'Mod+Alt+W'},
  {id:'closeAll', label:'Alle Ansichten schließen', group:'Ansicht', shortcut:'Mod+Shift+W'},
  {id:'split', label:'Editor teilen', group:'Ansicht', shortcut:'Mod+\\', aliases:['F8']},
  {id:'leftPane', label:'Linke Editorgruppe fokussieren', group:'Ansicht', shortcut:'Mod+1'},
  {id:'rightPane', label:'Rechte Editorgruppe fokussieren', group:'Ansicht', shortcut:'Mod+2'},
  {id:'switchPane', label:'Editorgruppe wechseln', group:'Ansicht', shortcut:'F6'},
  {id:'nextTab', label:'Nächste Ansicht', group:'Ansicht', shortcut:'Mod+Tab'},
  {id:'previousTab', label:'Vorherige Ansicht', group:'Ansicht', shortcut:'Mod+Shift+Tab'},
  {id:'sidebar', label:'Seitenleiste ein-/ausblenden', group:'Ansicht', shortcut:'Mod+Shift+E'},
  {id:'editor', label:'Editor ein-/ausblenden', group:'Ansicht', shortcut:'Mod+Alt+E'},
  {id:'writingMode', label:'Schreibmodus umschalten', group:'Ansicht', shortcut:'F9'},
  {id:'capture', label:'Schnellerfassung ein-/ausblenden', group:'Ansicht', shortcut:'Mod+Shift+Space'},
  {id:'focusCapture', label:'Schnellerfassung fokussieren', group:'Ansicht', shortcut:'Alt+Q'},
  {id:'notes', label:'Notizen', group:'Ansicht', shortcut:'Alt+1'},
  {id:'todos', label:'To-dos', group:'Ansicht', shortcut:'Alt+2'},
  {id:'tasks', label:'Tasks', group:'Ansicht', shortcut:'Alt+3'},
  {id:'focus', label:'Fokus', group:'Ansicht', shortcut:'Alt+4'},
  {id:'tags', label:'Tags', group:'Ansicht', shortcut:'Alt+5'},
  {id:'review', label:'Rückblick', group:'Ansicht', shortcut:'Alt+6'},
  {id:'graph', label:'Wissensgraph', group:'Ansicht', shortcut:'Alt+7'},
  {id:'vault', label:'NoteBase', group:'Ansicht', shortcut:'Alt+0'},
  {id:'focusTimer', label:'Fokuszeit starten', group:'Ansicht', shortcut:'Mod+Alt+F'},
  {id:'fullscreen', label:'Vollbild', group:'Ansicht', shortcut:'F11'},
  {id:'help', label:'Tastenkürzel und Bedienung …', group:'Hilfe', shortcut:'F1'},
  {id:'whatsNew', label:'Was ist neu …', group:'Hilfe'},
  {id:'updates', label:'Nach Updates suchen …', group:'Hilfe'},
] as const

export type CommandId = typeof COMMANDS[number]['id']
const navigationIcons:Partial<Record<CommandId,string>>={notes:'FileText',todos:'ListTodo',tasks:'CheckSquare',focus:'Crosshair',tags:'Tag',review:'BarChart3',graph:'Network',vault:'LayoutGrid'}
export const commandIcon=(id:CommandId):string=>navigationIcons[id]??'Circle'
export type CommandGroup = typeof COMMANDS[number]['group']
export type CommandSpec = {id:CommandId; label:string; group:CommandGroup; shortcut?:string; aliases?:readonly string[]; native?:boolean}
export type AppCommand = CommandSpec & {enabled:boolean; disabledReason?:string; checked?:boolean; run:()=>unknown}
export const COMMAND_GROUPS: CommandGroup[] = ['Datei','Bearbeiten','Ansicht','Hilfe']
export const commandSpec = (id:CommandId):CommandSpec => COMMANDS.find(command=>command.id===id)!
export function shortcutLabel(id:CommandId):string {
  const spec=commandSpec(id)
  return [spec.shortcut,...spec.aliases??[]].filter((value):value is string=>Boolean(value)).map(value=>value.replace('Mod', typeof navigator!=='undefined' && /Mac/.test(navigator.platform)?'⌘':'Strg').replace('Shift','Umschalt').replace('Delete','Entf').replace('Space','Leertaste')).join(' / ')
}
export const commandTitle = (id:CommandId, label=commandSpec(id).label):string => `${label}${shortcutLabel(id)?` (${shortcutLabel(id)})`:''}`

export function matchesShortcut(event:Pick<KeyboardEvent,'key'|'code'|'ctrlKey'|'metaKey'|'altKey'|'shiftKey'>, shortcut:string):boolean {
  const keys=shortcut.split('+'); const key=keys.at(-1)!
  const mod=keys.includes('Mod')
  if ((event.ctrlKey||event.metaKey)!==mod || (event.ctrlKey&&event.metaKey)) return false
  if(event.altKey!==keys.includes('Alt') || event.shiftKey!==keys.includes('Shift')) return false
  if(key==='Space')return event.code==='Space'||event.key===' '
  // Non-US layouts may need modifiers for the backslash; offer the physical key too.
  return event.key.toLowerCase()===key.toLowerCase() || (key==='\\'&&event.code==='Backslash')
}

export function commandForKey(event:Pick<KeyboardEvent,'key'|'code'|'ctrlKey'|'metaKey'|'altKey'|'shiftKey'>):CommandSpec|undefined {
  return (COMMANDS as readonly CommandSpec[]).find(command => [command.shortcut,...command.aliases??[]].some(shortcut=>shortcut&&matchesShortcut(event,shortcut)))
}
