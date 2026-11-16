const dt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const dts = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' });
export const formatDateTime = (iso: string | null | undefined) => (iso ? dt.format(new Date(iso)) : '—');
export const formatDateTimeSec = (iso: string | null | undefined) => (iso ? dts.format(new Date(iso)) : '—');
export const formatNumber = (n: number) => n.toLocaleString();

/** value for <input type="datetime-local"> in the user's local timezone */
export function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('') || '?';
}
