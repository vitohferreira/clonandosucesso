import type { Hook, MediaSource, StructuredScript, VideoAnalysis } from '@molde/shared';
import { coerceNumeric, coerceNumericAll, serviceClient } from './client';

/** Colunas numeric de cada tabela, para a coercao na leitura. */
const NUM_ANALISE = ['duration_s', 'cut_count', 'avg_shot_s', 'cost_usd'] as const;
const NUM_GANCHO = ['span_seconds', 'performance_multiple', 'engagement_raw'] as const;

export interface SaveVideoAnalysisInput {
  postId?: string | null;
  jobId?: string | null;
  source: MediaSource;
  sourceUrl?: string | null;
  audioPath?: string | null;
  framesPath?: string | null;
  durationSeconds: number;
  transcriptRaw: unknown;
  transcriptText: string;
  script: StructuredScript;
  cutCount: number;
  avgShotSeconds: number;
  shotBoundaries: unknown;
  modelUsed: string;
  usage: Record<string, unknown>;
  costUsd: number;
}

/**
 * Grava a analise e, junto, o gancho na biblioteca.
 *
 * O gancho e desnormalizado de proposito: a biblioteca precisa ser filtravel e
 * ordenavel por performance sem join, porque e a tela que voce vai abrir mais.
 */
export async function saveVideoAnalysis(input: SaveVideoAnalysisInput): Promise<VideoAnalysis> {
  const db = serviceClient();

  const res = await db
    .from('video_analyses')
    .insert({
      post_id: input.postId ?? null,
      job_id: input.jobId ?? null,
      source: input.source,
      source_url: input.sourceUrl ?? null,
      audio_path: input.audioPath ?? null,
      frames_path: input.framesPath ?? null,
      duration_s: input.durationSeconds,
      transcript_raw: input.transcriptRaw,
      transcript_text: input.transcriptText,
      script: input.script,
      hook_text: input.script.hook.text,
      cut_count: input.cutCount,
      avg_shot_s: input.avgShotSeconds,
      shot_boundaries: input.shotBoundaries,
      model_used: input.modelUsed,
      usage: input.usage,
      cost_usd: input.costUsd,
    })
    .select()
    .single();

  if (res.error) throw new Error(`saveVideoAnalysis: ${res.error.message}`);
  const analysis = coerceNumeric(res.data as VideoAnalysis, NUM_ANALISE);

  const hook = await db
    .from('hooks')
    .insert({
      video_analysis_id: analysis.id,
      post_id: input.postId ?? null,
      text: input.script.hook.text,
      kind: input.script.hook.kind,
      on_screen_text: input.script.hook.onScreenText,
      span_seconds: input.script.hook.spanSeconds,
    })
    .select()
    .single();

  // Um gancho que nao gravou nao invalida a analise inteira.
  if (hook.error) {
    console.error(`saveVideoAnalysis: gancho nao gravado — ${hook.error.message}`);
  }

  return analysis;
}

export async function getVideoAnalysis(id: string): Promise<VideoAnalysis | null> {
  const res = await serviceClient().from('video_analyses').select('*').eq('id', id).maybeSingle();
  if (res.error) throw new Error(`getVideoAnalysis: ${res.error.message}`);
  if (!res.data) return null;
  return coerceNumeric(res.data as VideoAnalysis, NUM_ANALISE);
}

export async function listVideoAnalyses(limit = 50): Promise<VideoAnalysis[]> {
  const res = await serviceClient()
    .from('video_analyses')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (res.error) throw new Error(`listVideoAnalyses: ${res.error.message}`);
  return coerceNumericAll((res.data ?? []) as VideoAnalysis[], NUM_ANALISE);
}

/** A biblioteca de ganchos, ordenada por performance. */
export async function listHooks(limit = 200): Promise<Hook[]> {
  const res = await serviceClient()
    .from('hooks')
    .select('*')
    .order('performance_multiple', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(limit);
  if (res.error) throw new Error(`listHooks: ${res.error.message}`);
  return coerceNumericAll((res.data ?? []) as Hook[], NUM_GANCHO);
}
