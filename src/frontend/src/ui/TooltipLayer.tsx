import {useEffect, useId, useRef} from 'react'
import {placeFloatingSurface} from './placeFloatingSurface'
import './TooltipLayer.css'

/** One transient hint surface. Controls own their text, names and actions. */
export function TooltipLayer() {
  const id = useId()
  const surfaceRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const surface = surfaceRef.current!
    const content = contentRef.current!
    let active: HTMLElement | null = null
    let described: HTMLElement | null = null
    let hovered: HTMLElement | null = null
    let focused: HTMLElement | null = null
    let openTimer: ReturnType<typeof setTimeout> | undefined
    let closeTimer: ReturnType<typeof setTimeout> | undefined
    const suppressed = new WeakSet<HTMLElement>()
    const trigger = (node: EventTarget | null) => node instanceof Element ? node.closest<HTMLElement>('[data-tooltip]') : null
    const visible = (node: HTMLElement) => node.isConnected && node.checkVisibility() && !node.closest('[hidden],[inert],[aria-hidden="true"]')
    const eligible = (node: HTMLElement) => {
      if (!visible(node) || !node.dataset.tooltip?.trim() || node.getAttribute('aria-expanded') === 'true' || node.closest('.cm-content')) return false
      const rect = node.getBoundingClientRect()
      if (rect.bottom <= 0 || rect.right <= 0 || rect.top >= innerHeight || rect.left >= innerWidth) return false
      // A hint cannot expose controls behind the current dialog/menu/picker.
      const boundaries = [...document.querySelectorAll<HTMLElement>('[aria-modal="true"],.nn-context-menu,[popover="auto"]:popover-open')].filter(visible)
      const boundary = boundaries.at(-1)
      return !boundary || boundary.contains(node)
    }
    const clearTimers = () => {
      clearTimeout(openTimer)
      clearTimeout(closeTimer)
      openTimer = closeTimer = undefined
    }
    const hide = () => {
      clearTimers()
      if (active) resize.unobserve(active)
      if (described) {
        const tokens = (described.getAttribute('aria-describedby') || '').split(/\s+/).filter(token => token && token !== id)
        if (tokens.length) described.setAttribute('aria-describedby', tokens.join(' '))
        else described.removeAttribute('aria-describedby')
      }
      described = active = null
      surface.hidePopover()
    }
    const position = () => {
      if (!active) return
      const anchor = active.getBoundingClientRect()
      const {width, height} = surface.getBoundingClientRect()
      const right = active.closest('[data-tooltip-side="right"]')
      const x = right ? (anchor.right + width <= innerWidth - 8 ? anchor.right : anchor.left - width) : anchor.left + (anchor.width - width) / 2
      const y = right ? anchor.top + (anchor.height - height) / 2 : anchor.bottom + height <= innerHeight - 8 ? anchor.bottom : anchor.top - height
      placeFloatingSurface(surface, x, y)
    }
    const show = (node: HTMLElement, keyboard: boolean) => {
      clearTimers()
      if (suppressed.has(node) || !eligible(node)) return
      if (active === node) return
      hide()
      active = node
      content.textContent = node.dataset.tooltip!
      // Labels may own a hint for their focused checkbox/radio.
      described = keyboard && document.activeElement instanceof HTMLElement && node.contains(document.activeElement) ? document.activeElement : node
      const tokens = (described.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean)
      described.setAttribute('aria-describedby', [...new Set([...tokens, id])].join(' '))
      surface.showPopover()
      position()
      resize.observe(node)
    }
    const queue = (node: HTMLElement | null, keyboard = false) => {
      clearTimers()
      if (!node || suppressed.has(node) || !eligible(node)) { hide(); return }
      if (active === node) return
      hide()
      openTimer = setTimeout(() => show(node, keyboard), keyboard ? 150 : 500)
    }
    const leave = () => {
      clearTimeout(openTimer)
      clearTimeout(closeTimer)
      if (active && focused === active && !suppressed.has(active)) return
      closeTimer = setTimeout(hide, 180)
    }
    const dismiss = (event?: Event) => {
      if (hovered) suppressed.add(hovered)
      if (focused) suppressed.add(focused)
      const pressed = event?.type === 'pointerdown' ? trigger(event.target) : null
      if (pressed) suppressed.add(pressed)
      hide()
    }
    const over = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return
      if (event.target instanceof Node && surface.contains(event.target)) { clearTimeout(closeTimer); return }
      const node = trigger(event.target)
      if (node === hovered) return
      hovered = node
      if (node) queue(node)
    }
    const out = (event: PointerEvent) => {
      const next = trigger(event.relatedTarget)
      const previous = trigger(event.target)
      if (previous && next !== previous) suppressed.delete(previous)
      if (hovered && next === hovered) return
      if (hovered) suppressed.delete(hovered)
      hovered = null
      if (event.relatedTarget instanceof Node && surface.contains(event.relatedTarget)) { clearTimeout(closeTimer); return }
      leave()
    }
    const focusIn = (event: FocusEvent) => {
      const node = trigger(event.target)
      const keyboard = event.target instanceof Element && event.target.matches(':focus-visible')
      focused = keyboard ? node : null
      if (keyboard) queue(node, true)
    }
    const focusOut = () => {
      if (focused) suppressed.delete(focused)
      focused = null
      // Menus move focus on pointer movement; keep the pending hover hint.
      if (!hovered || (active && hovered !== active)) leave()
    }
    const scroll = (event: Event) => {
      if (!(event.target instanceof Node) || !surface.contains(event.target)) dismiss()
    }
    const resize = new ResizeObserver(() => {
      if (active && eligible(active)) position()
      else if (active) hide()
    })
    resize.observe(surface)
    const mutation = new MutationObserver(() => {
      if (active && (!eligible(active) || content.textContent !== active.dataset.tooltip)) hide()
    })
    mutation.observe(document.body, {subtree: true, childList: true, attributes: true, attributeFilter: ['hidden','inert','aria-hidden','aria-expanded','data-tooltip','class']})
    document.addEventListener('pointerover', over, true)
    document.addEventListener('pointerout', out, true)
    document.addEventListener('focusin', focusIn, true)
    document.addEventListener('focusout', focusOut, true)
    document.addEventListener('pointerdown', dismiss, true)
    document.addEventListener('keydown', dismiss, true)
    document.addEventListener('scroll', scroll, true)
    document.addEventListener('wheel', scroll, {capture: true, passive: true})
    window.addEventListener('blur', dismiss)
    window.addEventListener('resize', dismiss)
    return () => {
      hide()
      resize.disconnect()
      mutation.disconnect()
      document.removeEventListener('pointerover', over, true)
      document.removeEventListener('pointerout', out, true)
      document.removeEventListener('focusin', focusIn, true)
      document.removeEventListener('focusout', focusOut, true)
      document.removeEventListener('pointerdown', dismiss, true)
      document.removeEventListener('keydown', dismiss, true)
      document.removeEventListener('scroll', scroll, true)
      document.removeEventListener('wheel', scroll, true)
      window.removeEventListener('blur', dismiss)
      window.removeEventListener('resize', dismiss)
    }
  }, [id])

  return <div ref={surfaceRef} id={id} className="nn-tooltip" role="tooltip" popover="manual">
    <div ref={contentRef} className="nn-tooltip-content" />
  </div>
}
