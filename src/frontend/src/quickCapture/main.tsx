import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../index.css'
import '../App.css'
import { TooltipLayer } from '../ui/TooltipLayer'
import { QuickCaptureWindow } from './QuickCaptureWindow'

document.documentElement.setAttribute('data-theme', window.nicknotes?.startupTheme === 'dark' ? 'dark' : 'light')
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TooltipLayer />
    <QuickCaptureWindow />
  </StrictMode>,
)
