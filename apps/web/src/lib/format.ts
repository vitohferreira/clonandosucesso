import { TIMEZONE } from '@molde/config';

/** "ha 3 min", "ha 2 h". Mais util que timestamp absoluto numa fila. */
export function relativeTime(iso: string | null): string {
  if (!iso) return '—';

  const diffMs = Date.now() - new Date(iso).getTime();
  const seconds = Math.round(diffMs / 1000);

  if (seconds < 60) return `ha ${Math.max(0, seconds)}s`;
  if (seconds < 3600) return `ha ${Math.floor(seconds / 60)} min`;
  if (seconds < 86400) return `ha ${Math.floor(seconds / 3600)} h`;
  return `ha ${Math.floor(seconds / 86400)} d`;
}

export function absoluteTime(iso: string | null): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: TIMEZONE,
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(iso));
}

export function duration(startIso: string | null, endIso: string | null): string {
  if (!startIso || !endIso) return '—';

  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}min ${Math.round((ms % 60_000) / 1000)}s`;
}

export function usd(value: number | null): string {
  if (value === null || value === 0) return '—';
  return `US$ ${value.toFixed(4)}`;
}
