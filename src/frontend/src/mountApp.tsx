import {StrictMode} from 'react'
import {createRoot} from 'react-dom/client'
import './index.css'
import App from './App'

export function mount(ready:()=>void,failed:(error:unknown)=>void) {
  window.addEventListener('nicknotes:app-mounted',ready,{once:true})
  createRoot(document.getElementById('root')!,{onUncaughtError:failed}).render(<StrictMode><App/></StrictMode>)
}
