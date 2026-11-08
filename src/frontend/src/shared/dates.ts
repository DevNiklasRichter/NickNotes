export function localCalendarDay(value: string | null | undefined): string {
  const clean=String(value ?? '').trim()
  if (!clean) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) return clean
  const stamp=new Date(clean)
  if (Number.isNaN(stamp.getTime())) return ''
  return `${stamp.getFullYear()}-${String(stamp.getMonth()+1).padStart(2,'0')}-${String(stamp.getDate()).padStart(2,'0')}`
}
