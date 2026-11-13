import {useEffect, useId, useLayoutEffect, useMemo, useRef, useState} from 'react'
import type {CSSProperties} from 'react'
import {createPortal} from 'react-dom'
import {LucideNamedIcon} from '../icons/lucideCatalog'
import {placeFloatingSurface} from './placeFloatingSurface'
import './MultiSelectPicker.css'

export type MultiSelectPickerOption = {value: string; label: string; color?: string}

function placeFilter(node: HTMLElement, button: HTMLElement): void {
  const anchor = button.getBoundingClientRect()
  node.style.width = `${Math.min(Math.max(anchor.width, 280), window.innerWidth - 16)}px`
  const height = node.getBoundingClientRect().height
  const below = anchor.bottom + 4
  const y = below + height > innerHeight - 8 && anchor.top - height - 4 >= 8 ? anchor.top - height - 4 : below
  placeFloatingSurface(node, anchor.left, y)
  node.style.visibility = 'visible'
}

export function MultiSelectPicker({label, selectedValues, options, allLabel = 'Alle', disabled, onToggle, triggerText, emptySelectionLabel = 'Keine Einschränkung', onAddValue}: {
  label: string
  selectedValues: string[]
  options: MultiSelectPickerOption[]
  allLabel?: string
  disabled?: boolean
  onToggle: (value: string) => void
  triggerText?: string
  emptySelectionLabel?: string
  onAddValue?: (value: string) => boolean
}) {
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const surface = useRef<HTMLDivElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const openingFocus = useRef<'search' | 'last'>('search')
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [addError, setAddError] = useState('')
  const visible = useMemo(() => {
    const term = query.trim().toLocaleLowerCase()
    return options.filter(option => !term || `${option.label} ${option.value}`.toLocaleLowerCase().includes(term))
  }, [options, query])
  const summary = !options.length ? 'Keine Optionen' : !selectedValues.length || selectedValues.length === options.length ? allLabel
    : selectedValues.length === 1 ? options.find(option => option.value === selectedValues[0])?.label ?? selectedValues[0] : `${selectedValues.length} ausgewählt`
  const close = (restore = false) => {
    if (surface.current?.matches(':popover-open')) surface.current.hidePopover()
    if (restore) trigger.current?.focus({preventScroll: true})
  }
  const focusOpened = (node: HTMLElement) => {
    node.scrollTop = 0
    const list = node.querySelector<HTMLElement>('.nn-filter-options')
    if (list) list.scrollTop = 0
    const entries = node.querySelectorAll<HTMLInputElement>('[data-filter-option]')
    if (openingFocus.current === 'last' && entries.length) entries.item(entries.length - 1).focus()
    else search.current?.focus({preventScroll: true})
  }

  useLayoutEffect(() => {
    if (!open || !surface.current || !trigger.current) return
    const node = surface.current, button = trigger.current
    const place = () => placeFilter(node, button)
    place()
    const observer = new ResizeObserver(place)
    observer.observe(node); observer.observe(button)
    window.addEventListener('resize', place)
    const dismiss = (event: Event) => {
      if (event.target instanceof Node && !node.contains(event.target)) node.hidePopover()
    }
    const blur = () => {if (node.matches(':popover-open')) node.hidePopover()}
    document.addEventListener('wheel', dismiss, {capture: true, passive: true})
    window.addEventListener('blur', blur)
    return () => {
      observer.disconnect(); window.removeEventListener('resize', place)
      document.removeEventListener('wheel', dismiss, true)
      window.removeEventListener('blur', blur)
    }
  }, [open])
  useLayoutEffect(() => {
    if (open && surface.current?.matches(':popover-open') && document.activeElement === document.body) search.current?.focus()
  }, [open, visible])
  useLayoutEffect(() => {
    const node = surface.current, button = trigger.current
    return () => {
      if (!node?.contains(document.activeElement)) return
      window.requestAnimationFrame(() => {
        if (node.isConnected || document.activeElement !== document.body) return
        const target = button?.isConnected ? button : document.querySelector<HTMLButtonElement>('.activity-rail button')
        target?.focus({preventScroll: true})
      })
    }
  }, [])
  useEffect(() => {if (disabled && surface.current?.matches(':popover-open')) surface.current.hidePopover()}, [disabled])

  return <div className={`nn-multiselect${open ? ' is-open' : ''}`}>
    <button ref={trigger} type="button" className={`nn-multiselect-trigger${triggerText ? ' nn-picker-token-trigger' : ''}`} disabled={disabled}
      aria-label={triggerText ? label : `${label}: ${summary}`} title={label} aria-haspopup="dialog" aria-expanded={open} aria-controls={id} popoverTarget={id}
      onClick={event => event.stopPropagation()}
      onKeyDown={event => {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
        event.preventDefault(); event.stopPropagation()
        openingFocus.current = event.key === 'ArrowUp' ? 'last' : 'search'
        if (!surface.current?.matches(':popover-open')) event.currentTarget.click()
        else search.current?.focus()
      }}>
      <span>{triggerText ?? summary}</span>{!triggerText && <LucideNamedIcon name={open ? 'ChevronUp' : 'ChevronDown'} size={13}/>}
    </button>
    {createPortal(<div ref={surface} id={id} popover="auto" role="dialog" aria-label={label} className="nn-filter-popover"
      onBeforeToggle={event => {
        if (event.newState === 'open') {
          setQuery('')
          setAddError('')
          event.currentTarget.style.visibility = 'hidden'
        }
      }}
      onToggle={event => {
        setOpen(event.newState === 'open')
        if (event.newState === 'closed') openingFocus.current = 'search'
        else if (trigger.current) {
          placeFilter(event.currentTarget, trigger.current)
          focusOpened(event.currentTarget)
        }
      }}
      onBlur={event => {
        const next = event.relatedTarget
        if (next === trigger.current || next instanceof Node && surface.current?.contains(next)) return
        window.requestAnimationFrame(() => {
          const node = surface.current
          if (node?.matches(':popover-open') && !node.contains(document.activeElement) && document.activeElement !== trigger.current) node.hidePopover()
        })
      }}
      onKeyDown={event => {
        event.stopPropagation()
        if (event.nativeEvent.isComposing) return
        if (event.key === 'Escape') {event.preventDefault(); close(true); return}
        if (event.key === 'Tab') {
          const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button,input')].filter(node => !node.matches(':disabled'))
          if (event.shiftKey && document.activeElement === controls[0] || !event.shiftKey && document.activeElement === controls.at(-1)) close(true)
        }
        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
        const entries = [...event.currentTarget.querySelectorAll<HTMLInputElement>('[data-filter-option]')]
        const index = entries.indexOf(document.activeElement as HTMLInputElement)
        if (index >= 0 && ['ArrowDown','ArrowUp','Home','End'].includes(event.key)) {
          event.preventDefault()
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? entries.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + entries.length) % entries.length
          entries[next]?.focus()
        }
      }}>
      <header><strong>{label}</strong><button type="button" className="icon-button compact" aria-label="Auswahl schließen" onClick={() => close(true)}><LucideNamedIcon name="X" size={14}/></button></header>
      {onAddValue ? <p id={`${id}-hint`} className="nn-picker-hint">Optionen auswählen oder einen eigenen Wert hinzufügen.</p> : null}
      <div className="nn-filter-search">
        <input ref={search} type="search" aria-label={`${label} durchsuchen`} aria-describedby={onAddValue ? `${id}-hint` : undefined} placeholder="Option suchen …" value={query}
          onChange={event => {setQuery(event.target.value); setAddError('')}}
          onKeyDown={event => {
            if (event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey) return
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter') {
              event.preventDefault()
              const entries = surface.current?.querySelectorAll<HTMLInputElement>('[data-filter-option]')
              entries?.item(event.key === 'ArrowUp' ? entries.length - 1 : 0)?.focus()
            }
          }}/>
        <button type="button" className="icon-button compact" aria-label="Suche leeren" disabled={!query}
          onClick={() => {setQuery(''); setAddError(''); search.current?.focus()}}><LucideNamedIcon name="X" size={13}/></button>
      </div>
      {onAddValue && query.trim() && !options.some(option => option.value.toLocaleLowerCase() === query.trim().toLocaleLowerCase()) ? <button type="button" className="nn-picker-add-value" onClick={() => {
        if (onAddValue(query)) {setQuery(''); setAddError(''); search.current?.focus()}
        else setAddError('Dieser Wert ist ungültig. Bitte die Eingabe prüfen.')
      }}>Eigenen Wert hinzufügen: „{query.trim()}“</button> : null}
      {addError ? <p className="nn-picker-error" role="alert">{addError}</p> : null}
      <div className="nn-filter-options" role="group" aria-label="Filteroptionen">
        {!visible.length ? <p role="status">{options.length ? 'Keine passenden Optionen.' : 'Keine Optionen verfügbar.'}</p> : null}
        {visible.map(option => <label key={option.value} className="nn-filter-option">
          <input type="checkbox" data-filter-option checked={selectedValues.includes(option.value)} onChange={() => onToggle(option.value)}
            onKeyDown={event => {if (event.key === 'Enter' && !event.nativeEvent.isComposing) {event.preventDefault(); onToggle(option.value)}}}/>
          {option.color ? <span className="nn-filter-color" style={{'--filter-color': option.color} as CSSProperties} aria-hidden="true"/> : null}
          <span>{option.label}</span>
        </label>)}
      </div>
      <footer><span role="status">{selectedValues.length ? `${selectedValues.length} ausgewählt` : emptySelectionLabel}</span><button type="button" onClick={() => close(true)}>Fertig</button></footer>
    </div>, document.body)}
  </div>
}
