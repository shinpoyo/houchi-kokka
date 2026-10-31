export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function dayHour(tick: number): string {
  return `${Math.floor(tick / 24) + 1}日目 ${tick % 24}時`;
}

export function num(n: number): string {
  if (Math.abs(n) >= 10000) return `${(n / 1000).toFixed(0)}k`;
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return `${Math.round(n)}`;
}

export function duration(hours: number): string {
  const d = Math.floor(hours / 24);
  const h = hours % 24;
  if (d === 0) return `${h}時間`;
  return h === 0 ? `${d}日` : `${d}日${h}時間`;
}

export function mmss(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
