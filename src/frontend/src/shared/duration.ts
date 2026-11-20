/** "45 min", "1 h 15 min" or "2 h" for logged focus time. */
export function formatMinutes(total: number): string {
  const minutes = Math.max(0, Math.round(Number.isFinite(total) ? total : 0))
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours} h ${rest} min` : `${hours} h`
}
