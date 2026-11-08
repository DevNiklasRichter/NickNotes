import * as all from 'lucide-react'
import type {ComponentType,SVGProps} from 'react'
type Icon=ComponentType<SVGProps<SVGSVGElement>&{size?:string|number;absoluteStrokeWidth?:boolean}>
export const icons=Object.fromEntries(Object.entries(all).filter(([name,value])=>/^[A-Z]/.test(name)&&Boolean(value))) as Record<string,Icon>
