/** Keep shared menu and filter surfaces within the CSS viewport. */
export function placeFloatingSurface(surface: HTMLElement, x: number, y: number): void {
  const {width, height} = surface.getBoundingClientRect()
  const edge = 8
  surface.style.left = `${Math.max(edge, Math.min(x, window.innerWidth - width - edge))}px`
  surface.style.top = `${Math.max(edge, Math.min(y, window.innerHeight - height - edge))}px`
}
