import {
  dayInTimezone,
  RateLimitReachedError,
  type RateLimitCounters,
  type RateLimitField,
} from '@molde/shared';
import { serviceClient } from './client';
import { getDailyCaps } from './settings';

/**
 * Tetos diarios.
 *
 * O dia vira a meia-noite de America/Sao_Paulo, nao em UTC — se fosse UTC, o
 * teto zeraria as 21h de um dia e voce perderia a noite inteira de orcamento.
 *
 * Uso: `ensureCapacity` ANTES da acao, `consume` DEPOIS que ela deu certo.
 * Assim uma acao que falhou nao come o teto do dia.
 */

export async function getCounters(day = dayInTimezone()): Promise<RateLimitCounters> {
  const res = await serviceClient()
    .from('rate_limit_counters')
    .select('*')
    .eq('day', day)
    .maybeSingle();

  if (res.error) throw new Error(`getCounters: ${res.error.message}`);

  return (
    (res.data as RateLimitCounters | null) ?? {
      day,
      profiles_analyzed: 0,
      posts_opened: 0,
      videos_downloaded: 0,
      requests: 0,
      updated_at: new Date().toISOString(),
    }
  );
}

/**
 * Verifica se ainda cabe. Lanca RateLimitReachedError, que o worker trata
 * adiando o job para o dia seguinte — nao e falha e nao e bloqueio.
 */
export async function ensureCapacity(field: RateLimitField, needed = 1): Promise<void> {
  const [counters, caps] = await Promise.all([getCounters(), getDailyCaps()]);
  const used = counters[field];
  const limit = caps[field];

  if (used + needed > limit) {
    throw new RateLimitReachedError(field, used, limit);
  }
}

/** Registra consumo. Atomico no banco, entao dois workers nao se atropelam. */
export async function consume(
  field: RateLimitField,
  amount = 1,
  day = dayInTimezone(),
): Promise<RateLimitCounters> {
  const res = await serviceClient().rpc('bump_rate_limit', {
    p_day: day,
    p_field: field,
    p_amount: amount,
  });
  if (res.error) throw new Error(`consume(${field}): ${res.error.message}`);
  return res.data as RateLimitCounters;
}

/** Quanto sobra de cada teto hoje. Para mostrar na tela. */
export async function remainingToday(): Promise<
  Record<RateLimitField, { used: number; limit: number; left: number }>
> {
  const [counters, caps] = await Promise.all([getCounters(), getDailyCaps()]);
  const fields: RateLimitField[] = [
    'profiles_analyzed',
    'posts_opened',
    'videos_downloaded',
    'requests',
  ];

  const out = {} as Record<RateLimitField, { used: number; limit: number; left: number }>;
  for (const field of fields) {
    const used = counters[field];
    const limit = caps[field];
    out[field] = { used, limit, left: Math.max(0, limit - used) };
  }
  return out;
}
