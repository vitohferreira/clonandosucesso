import { TIMEZONE } from '@molde/config';

/**
 * Data no formato YYYY-MM-DD segundo o fuso da config, nao em UTC.
 * A virada do dia dos tetos diarios depende disso: as 22h de Sao Paulo ainda
 * e o mesmo dia, mas ja e o dia seguinte em UTC.
 */
export function dayInTimezone(date: Date = new Date(), timeZone: string = TIMEZONE): string {
  // en-CA porque formata como YYYY-MM-DD, que e exatamente o formato `date` do Postgres.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/**
 * Proxima meia-noite no fuso da config, em UTC.
 * E para la que um job vai quando bate o teto diario.
 */
export function nextMidnightInTimezone(date: Date = new Date(), timeZone: string = TIMEZONE): Date {
  const today = dayInTimezone(date, timeZone);
  // Varre hora a hora ate a data local mudar. Bruto, mas imune a horario de verao
  // e a mudanca de offset, que e onde a aritmetica manual erra.
  for (let hours = 1; hours <= 48; hours++) {
    const candidate = new Date(date.getTime() + hours * 3_600_000);
    if (dayInTimezone(candidate, timeZone) !== today) {
      // Zera para o inicio dessa hora, e o suficiente: o job so precisa acordar
      // depois da virada, nao exatamente em 00:00:00.
      candidate.setUTCMinutes(0, 0, 0);
      return candidate;
    }
  }
  return new Date(date.getTime() + 24 * 3_600_000);
}

/** Partes locais de uma data, para agregar cadencia de publicacao. */
export function localParts(date: Date, timeZone: string = TIMEZONE) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? '';
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  return { weekday, hour };
}
