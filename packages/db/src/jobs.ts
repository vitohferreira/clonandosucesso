import {
  createJobSchema,
  type CreateJobInput,
  type JobProgress,
  type JobRow,
  type JobStatus,
} from '@molde/shared';
import { coerceNumeric, coerceNumericAll, serviceClient, unwrap } from './client';

/**
 * As funcoes da fila declaram `returns setof jobs` (veja a nota na migration
 * 0002): devolvem no maximo uma linha, mas sempre dentro de um array. Fila
 * vazia e `[]`, nunca um objeto de campos nulos.
 */
const NUM_JOB = ['cost_usd'] as const;

function firstRow<T>(data: unknown): T | null {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  return coerceNumeric(row as T, NUM_JOB);
}

function requireRow<T>(data: unknown, context: string): T {
  const row = firstRow<T>(data);
  if (!row) throw new Error(`${context}: o banco nao devolveu a linha esperada`);
  return row;
}

/**
 * Cria um job. Valida com o MESMO schema que o worker usa para ler o payload,
 * entao payload invalido morre aqui e nao 40 minutos depois dentro do worker.
 */
export async function createJob(input: CreateJobInput): Promise<JobRow> {
  const parsed = createJobSchema.parse(input);

  const res = await serviceClient()
    .from('jobs')
    .insert({ type: parsed.type, payload: parsed.payload })
    .select()
    .single();

  return coerceNumeric(unwrap(res, 'createJob') as JobRow, NUM_JOB);
}

export async function listJobs(limit = 50, status?: JobStatus): Promise<JobRow[]> {
  let query = serviceClient()
    .from('jobs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (status) query = query.eq('status', status);

  const res = await query;
  return coerceNumericAll((unwrap(res, 'listJobs') ?? []) as JobRow[], NUM_JOB);
}

export async function getJob(id: string): Promise<JobRow | null> {
  const res = await serviceClient().from('jobs').select('*').eq('id', id).maybeSingle();
  if (res.error) throw new Error(`getJob: ${res.error.message}`);
  if (!res.data) return null;
  return coerceNumeric(res.data as JobRow, NUM_JOB);
}

/**
 * Pega o proximo job da fila, de forma atomica (`for update skip locked` no banco).
 * Retorna null quando nao ha nada para fazer.
 */
export async function claimJob(workerId: string): Promise<JobRow | null> {
  const res = await serviceClient().rpc('claim_job', { p_worker: workerId });
  if (res.error) throw new Error(`claimJob: ${res.error.message}`);
  return firstRow<JobRow>(res.data);
}

/** Sinal de vida + progresso para a UI. */
export async function heartbeatJob(id: string, progress?: Omit<JobProgress, 'updatedAt'>) {
  const payload = progress ? { ...progress, updatedAt: new Date().toISOString() } : null;
  const res = await serviceClient().rpc('heartbeat_job', { p_id: id, p_progress: payload });
  if (res.error) throw new Error(`heartbeatJob: ${res.error.message}`);
}

export async function completeJob(id: string, result: unknown, costUsd?: number): Promise<JobRow> {
  const res = await serviceClient().rpc('complete_job', {
    p_id: id,
    p_result: result ?? null,
    p_cost: costUsd ?? null,
  });
  if (res.error) throw new Error(`completeJob: ${res.error.message}`);
  return requireRow<JobRow>(res.data, 'completeJob');
}

export async function failJob(id: string, error: string, costUsd?: number): Promise<JobRow> {
  const res = await serviceClient().rpc('fail_job', {
    p_id: id,
    p_error: error.slice(0, 8000),
    p_cost: costUsd ?? null,
  });
  if (res.error) throw new Error(`failJob: ${res.error.message}`);
  return requireRow<JobRow>(res.data, 'failJob');
}

/** Sinal do Instagram: terminal, nao reprocessa sozinho. */
export async function blockJob(
  id: string,
  reason: string,
  detail?: Record<string, unknown>,
): Promise<JobRow> {
  const res = await serviceClient().rpc('block_job', {
    p_id: id,
    p_reason: reason,
    p_detail: detail ?? null,
  });
  if (res.error) throw new Error(`blockJob: ${res.error.message}`);
  return requireRow<JobRow>(res.data, 'blockJob');
}

/**
 * Teto diario atingido: volta para a fila depois da virada do dia.
 * `partialResult` guarda o que ja foi feito, para a proxima rodada continuar
 * de onde parou em vez de gastar o teto inteiro de novo.
 */
export async function deferJob(
  id: string,
  until: Date,
  reason: string,
  partialResult?: unknown,
): Promise<JobRow> {
  const res = await serviceClient().rpc('defer_job', {
    p_id: id,
    p_until: until.toISOString(),
    p_reason: reason,
    p_partial_result: partialResult ?? null,
  });
  if (res.error) throw new Error(`deferJob: ${res.error.message}`);
  return requireRow<JobRow>(res.data, 'deferJob');
}

/** Jobs orfaos (worker morreu) viram `failed`, nunca voltam para a fila sozinhos. */
export async function reapStaleJobs(timeoutMs: number): Promise<JobRow[]> {
  const minutes = Math.max(1, Math.round(timeoutMs / 60_000));
  const res = await serviceClient().rpc('reap_stale_jobs', { p_timeout: `${minutes} minutes` });
  if (res.error) throw new Error(`reapStaleJobs: ${res.error.message}`);
  return (res.data ?? []) as JobRow[];
}
