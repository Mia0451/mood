/** Date helpers. Everything formats in the viewer's local timezone. */

const pad = (n: number) => String(n).padStart(2, '0')

/** `DD/MM/YYYY` in local time. */
export function formatDayLabel(value: string | Date): string {
  const d = typeof value === 'string' ? new Date(value) : value
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`
}

/** Local-day key (`YYYY-MM-DD`) for grouping. */
export function localDayKey(value: string | Date): string {
  const d = typeof value === 'string' ? new Date(value) : value
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function relativeTime(value: string, now = Date.now()): string {
  const t = new Date(value).getTime()
  if (Number.isNaN(t)) return ''
  const s = Math.max(0, Math.round((now - t) / 1000))
  if (s < 45) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const days = Math.round(h / 24)
  if (days < 7) return `${days}d ago`
  return formatDayLabel(value)
}
