import { z } from 'zod';
import { isValidHandle, normalizeHandle } from './handle';

/**
 * Contrato dos jobs. Web e worker validam o MESMO schema nas duas pontas,
 * entao mudar o formato de um payload quebra na hora, e nao em silencio
 * tres semanas depois.
 */

export const JOB_TYPES = ['ping', 'profile_analysis', 'video_extraction'] as const;
export type JobType = (typeof JOB_TYPES)[number];

export const JOB_STATUSES = ['queued', 'running', 'done', 'failed', 'blocked'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/* ---------------------------------------------------------------- payloads */

/** Job de fumaca: prova a fila de ponta a ponta sem tocar em nada externo. */
export const pingPayloadSchema = z.object({
  message: z.string().max(200).default('ping'),
  /** Trabalho falso, para dar tempo de ver o job em `running` na tela. */
  sleepMs: z.number().int().min(0).max(60_000).default(3_000),
});

export const profileAnalysisPayloadSchema = z.object({
  handle: z
    .string()
    .transform(normalizeHandle)
    .refine(isValidHandle, { message: 'Handle invalido' }),
  /** Reabre posts que ja tem detalhe coletado, ignorando a janela de refetch. */
  forceRefetch: z.boolean().default(false),
});

export const videoExtractionPayloadSchema = z.discriminatedUnion('source', [
  z.object({
    source: z.literal('upload'),
    /** Caminho no Supabase Storage. O arquivo sobe direto do browser, nao pela API. */
    storagePath: z.string().min(1),
    filename: z.string().min(1),
    sizeBytes: z.number().int().positive(),
  }),
  z.object({
    source: z.literal('instagram'),
    shortcode: z.string().min(1),
    /**
     * De quem e o post. A API oficial busca por PERFIL, nao por post — sem o
     * handle nao ha como pedir o arquivo do video.
     */
    handle: z
      .string()
      .transform(normalizeHandle)
      .refine(isValidHandle, { message: 'Handle invalido' }),
    /** Preenchido quando o job vem de dentro de uma analise de perfil. */
    postId: z.string().uuid().nullable().default(null),
  }),
]);

export const jobPayloadSchemas = {
  ping: pingPayloadSchema,
  profile_analysis: profileAnalysisPayloadSchema,
  video_extraction: videoExtractionPayloadSchema,
} satisfies Record<JobType, z.ZodType>;

/** O que a API aceita para criar um job. */
export const createJobSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ping'), payload: pingPayloadSchema }),
  z.object({ type: z.literal('profile_analysis'), payload: profileAnalysisPayloadSchema }),
  z.object({ type: z.literal('video_extraction'), payload: videoExtractionPayloadSchema }),
]);

export type CreateJobInput = z.input<typeof createJobSchema>;

/* ----------------------------------------------------------------- results */

export const pingResultSchema = z.object({
  pong: z.literal(true),
  workerId: z.string(),
  tookMs: z.number(),
  echo: z.string(),
});

export const profileAnalysisResultSchema = z.object({
  profileId: z.string().uuid(),
  handle: z.string(),
  postsCollected: z.number().int(),
  postsOpened: z.number().int(),
  outliersFound: z.number().int(),
  videosAnalyzed: z.number().int(),
  /** Quando o job foi adiado por teto, quanto ja tinha sido feito. */
  partial: z.boolean().default(false),
});

export const videoExtractionResultSchema = z.object({
  videoAnalysisId: z.string().uuid(),
  durationSeconds: z.number(),
  blockCount: z.number().int(),
  cutCount: z.number().int(),
  hookText: z.string().nullable(),
});

/* --------------------------------------------------------------- progresso */

/** O que a UI mostra enquanto o job roda. Atualizado pelo worker. */
export const jobProgressSchema = z.object({
  step: z.string(),
  current: z.number().int().min(0).nullable().default(null),
  total: z.number().int().min(0).nullable().default(null),
  message: z.string().nullable().default(null),
  updatedAt: z.string(),
});

export type JobProgress = z.infer<typeof jobProgressSchema>;

/* ------------------------------------------------------------------- linha */

export interface JobRow {
  id: string;
  type: JobType;
  status: JobStatus;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
  blocked_reason: string | null;
  defer_reason: string | null;
  defer_count: number;
  progress: JobProgress | null;
  attempts: number;
  cost_usd: number | null;
  locked_at: string | null;
  locked_by: string | null;
  scheduled_for: string;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
}

/** Rotulos em portugues para a UI. */
export const JOB_TYPE_LABELS: Record<JobType, string> = {
  ping: 'Teste de fila',
  profile_analysis: 'Analise de perfil',
  video_extraction: 'Extracao de roteiro',
};

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  queued: 'Na fila',
  running: 'Rodando',
  done: 'Concluido',
  failed: 'Falhou',
  blocked: 'Bloqueado',
};
