import {AlertCircle,ArrowBigUpDash,ArrowDown,ArrowLeft,ArrowRight,ArrowUp,ArrowUpDown,ArrowUpRight,BarChart3,Bold,CalendarDays,Check,CheckSquare,ChevronDown,ChevronLeft,ChevronRight,ChevronUp,ChevronsDown,ChevronsUp,Circle,Columns2,Crosshair,Download,ExternalLink,File,FilePlus,FileText,FilterX,Focus,Folder,FolderOpen,FolderPlus,FolderSearch,FolderTree,Hash,Image,Import,Info,Italic,Layout,LayoutDashboard,LayoutGrid,Link,ListChecks,ListTodo,ListX,Maximize,MoreHorizontal,Navigation,Network,Palette,PanelBottom,PanelLeft,PenLine,Pencil,Pin,PinOff,Plug,RefreshCw,RotateCcw,Save,ScanSearch,Search,Settings,Table,Tag,Tags,Target,Text,Trash2,User,X} from 'lucide-react'
import {createElement, useEffect, useSyncExternalStore, type ComponentType, type SVGProps} from 'react'
import {LUCIDE_ICON_NAMES} from './lucideNames.generated'
export {LUCIDE_ICON_NAMES}
type NamedIcon=ComponentType<SVGProps<SVGSVGElement> & {size?:string|number;absoluteStrokeWidth?:boolean}>
const core:Record<string,NamedIcon>={AlertCircle,ArrowBigUpDash,ArrowDown,ArrowLeft,ArrowRight,ArrowUp,ArrowUpDown,ArrowUpRight,BarChart3,Bold,CalendarDays,Check,CheckSquare,ChevronDown,ChevronLeft,ChevronRight,ChevronUp,ChevronsDown,ChevronsUp,Circle,Columns2,Crosshair,Download,ExternalLink,File,FilePlus,FileText,FilterX,Focus,Folder,FolderOpen,FolderPlus,FolderSearch,FolderTree,Hash,Image,Import,Info,Italic,Layout,LayoutDashboard,LayoutGrid,Link,ListChecks,ListTodo,ListX,Maximize,MoreHorizontal,Navigation,Network,Palette,PanelBottom,PanelLeft,PenLine,Pencil,Pin,PinOff,Plug,RefreshCw,RotateCcw,Save,ScanSearch,Search,Settings,Table,Tag,Tags,Target,Text,Trash2,User,X}
const known=new Set<string>(LUCIDE_ICON_NAMES)
const listeners=new Set<()=>void>()
let full:Record<string,NamedIcon>|undefined
let loading:Promise<void>|undefined
function subscribe(listener:()=>void){listeners.add(listener);return()=>listeners.delete(listener)}
function ensureLoaded(){
 loading??=import('./lucideAllIcons').then(module=>{full=module.icons;for(const listener of listeners)listener()}).catch(()=>{loading=undefined})
 return loading
}
export function isLucideIconName(name:string):boolean{return known.has(name)}
export function getLucideIconComponent(name:string|null|undefined):NamedIcon{return (name&&(core[name]||full?.[name]))||Circle}
export function LucideNamedIcon({name,...props}:SVGProps<SVGSVGElement>&{name:string;size?:string|number;absoluteStrokeWidth?:boolean}){
 useSyncExternalStore(subscribe,()=>Boolean(full))
 useEffect(()=>{if(!core[name]&&known.has(name))void ensureLoaded()},[name])
 return createElement(getLucideIconComponent(name),{"aria-hidden":true,focusable:false,strokeWidth:1.75,...props})
}
