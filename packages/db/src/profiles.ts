import type {
  ComputedMetric,
  Highlight,
  Post,
  PostMetrics,
  Profile,
  ProfileAnalysis,
  ProfileSnapshot,
} from '@molde/shared';
import { coerceNumeric, coerceNumericAll, serviceClient, umDe } from './client';

const NUM_METRICA = [
  'engagement_raw', 'engagement_rate', 'baseline_median', 'multiple',
] as const;
const NUM_ANALISE_PERFIL = ['cost_usd'] as const;

export interface ProfileUpsertInput {
  handle: string;
  full_name?: string | null;
  bio?: string | null;
  external_url?: string | null;
  category?: string | null;
  is_verified?: boolean | null;
  is_private?: boolean | null;
  avatar_path?: string | null;
}

export async function upsertProfile(input: ProfileUpsertInput): Promise<Profile> {
  const agora = new Date().toISOString();

  const res = await serviceClient()
    .from('profiles')
    .upsert(
      { ...input, handle: input.handle.toLowerCase(), last_analyzed_at: agora },
      { onConflict: 'handle' },
    )
    .select()
    .single();

  if (res.error) throw new Error(`upsertProfile(${input.handle}): ${res.error.message}`);

  const perfil = res.data as Profile;

  // first_analyzed_at so na primeira vez: e o que permite ver ha quanto tempo
  // este perfil esta na sua base.
  if (!perfil.first_analyzed_at) {
    await serviceClient().from('profiles').update({ first_analyzed_at: agora }).eq('id', perfil.id);
    perfil.first_analyzed_at = agora;
  }

  return perfil;
}

export async function getProfileByHandle(handle: string): Promise<Profile | null> {
  const res = await serviceClient()
    .from('profiles')
    .select('*')
    .eq('handle', handle.toLowerCase())
    .maybeSingle();
  if (res.error) throw new Error(`getProfileByHandle: ${res.error.message}`);
  return (res.data ?? null) as Profile | null;
}

export async function listProfiles(limit = 100): Promise<Profile[]> {
  const res = await serviceClient()
    .from('profiles')
    .select('*')
    .order('last_analyzed_at', { ascending: false, nullsFirst: false })
    .limit(limit);
  if (res.error) throw new Error(`listProfiles: ${res.error.message}`);
  return (res.data ?? []) as Profile[];
}

/** Um snapshot por analise: e o que permite ver a evolucao do perfil. */
export async function addSnapshot(
  profileId: string,
  dados: { followers: number | null; following: number | null; postsCount: number | null },
): Promise<ProfileSnapshot> {
  const res = await serviceClient()
    .from('profile_snapshots')
    .insert({
      profile_id: profileId,
      followers: dados.followers,
      following: dados.following,
      posts_count: dados.postsCount,
    })
    .select()
    .single();
  if (res.error) throw new Error(`addSnapshot: ${res.error.message}`);
  return res.data as ProfileSnapshot;
}

export async function listSnapshots(profileId: string, limit = 30): Promise<ProfileSnapshot[]> {
  const res = await serviceClient()
    .from('profile_snapshots')
    .select('*')
    .eq('profile_id', profileId)
    .order('captured_at', { ascending: false })
    .limit(limit);
  if (res.error) throw new Error(`listSnapshots: ${res.error.message}`);
  return (res.data ?? []) as ProfileSnapshot[];
}

/**
 * Grava as metricas calculadas. Tudo aqui e derivado de `posts`, entao pode ser
 * recalculado quantas vezes for preciso sem voltar ao Instagram.
 */
export async function saveMetrics(metricas: ComputedMetric[]): Promise<void> {
  if (metricas.length === 0) return;

  const linhas = metricas.map((m) => ({
    post_id: m.postId,
    basis: m.basis,
    engagement_raw: m.engagementRaw,
    engagement_rate: m.engagementRate,
    baseline_median: m.baselineMedian,
    window_kind: m.windowKind,
    window_size: m.windowSize,
    multiple: m.multiple,
    is_outlier: m.isOutlier,
    outlier_tier: m.outlierTier,
    provisional: m.provisional,
    computed_at: new Date().toISOString(),
  }));

  const res = await serviceClient().from('post_metrics').upsert(linhas, { onConflict: 'post_id' });
  if (res.error) throw new Error(`saveMetrics: ${res.error.message}`);
}

export async function listMetrics(profileId: string): Promise<Array<PostMetrics & { post: Post }>> {
  const res = await serviceClient()
    .from('post_metrics')
    .select('*, post:posts!inner(*)')
    .eq('post.profile_id', profileId)
    .order('multiple', { ascending: false });

  if (res.error) throw new Error(`listMetrics: ${res.error.message}`);

  const linhas = ((res.data ?? []) as unknown as Array<
    PostMetrics & { post: Post | Post[] }
  >)
    .map((linha) => {
      const post = umDe(linha.post);
      return post ? { ...linha, post } : null;
    })
    .filter((l): l is PostMetrics & { post: Post } => l !== null);

  return coerceNumericAll(linhas, NUM_METRICA);
}

export async function saveHighlights(
  profileId: string,
  destaques: Array<{ title: string; position: number; theme_summary?: string | null }>,
): Promise<void> {
  if (destaques.length === 0) return;

  const res = await serviceClient().from('highlights').upsert(
    destaques.map((d) => ({
      profile_id: profileId,
      title: d.title,
      position: d.position,
      theme_summary: d.theme_summary ?? null,
    })),
    { onConflict: 'profile_id,title' },
  );
  if (res.error) throw new Error(`saveHighlights: ${res.error.message}`);
}

export async function listHighlights(profileId: string): Promise<Highlight[]> {
  const res = await serviceClient()
    .from('highlights')
    .select('*')
    .eq('profile_id', profileId)
    .order('position', { ascending: true, nullsFirst: false });
  if (res.error) throw new Error(`listHighlights: ${res.error.message}`);
  return (res.data ?? []) as Highlight[];
}

/** Comentarios sem handle do autor: a dor da audiencia esta no texto. */
export async function saveComments(
  postId: string,
  comentarios: Array<{ text: string; likeCount: number | null }>,
): Promise<void> {
  if (comentarios.length === 0) return;

  const res = await serviceClient()
    .from('post_comments')
    .insert(comentarios.map((c) => ({ post_id: postId, text: c.text, like_count: c.likeCount })));
  if (res.error) throw new Error(`saveComments: ${res.error.message}`);
}

export async function listComments(profileId: string, limit = 300): Promise<string[]> {
  const res = await serviceClient()
    .from('post_comments')
    .select('text, post:posts!inner(profile_id)')
    .eq('post.profile_id', profileId)
    .limit(limit);
  if (res.error) throw new Error(`listComments: ${res.error.message}`);
  return ((res.data ?? []) as Array<{ text: string }>).map((r) => r.text);
}

export async function saveProfileAnalysis(entrada: {
  profileId: string;
  jobId: string | null;
  formatDistribution: unknown;
  cadence: unknown;
  durationBuckets: unknown;
  narrativePatterns: unknown;
  ctaPatterns: unknown;
  whatFails: unknown;
  audiencePain: unknown;
  synthesisMd: string;
  modelUsed: string;
  usage: unknown;
  costUsd: number;
}): Promise<ProfileAnalysis> {
  const res = await serviceClient()
    .from('profile_analyses')
    .insert({
      profile_id: entrada.profileId,
      job_id: entrada.jobId,
      format_distribution: entrada.formatDistribution,
      cadence: entrada.cadence,
      duration_buckets: entrada.durationBuckets,
      narrative_patterns: entrada.narrativePatterns,
      cta_patterns: entrada.ctaPatterns,
      what_fails: entrada.whatFails,
      audience_pain: entrada.audiencePain,
      synthesis_md: entrada.synthesisMd,
      model_used: entrada.modelUsed,
      usage: entrada.usage,
      cost_usd: entrada.costUsd,
    })
    .select()
    .single();

  if (res.error) throw new Error(`saveProfileAnalysis: ${res.error.message}`);
  return coerceNumeric(res.data as ProfileAnalysis, NUM_ANALISE_PERFIL);
}

export async function getLatestAnalysis(profileId: string): Promise<ProfileAnalysis | null> {
  const res = await serviceClient()
    .from('profile_analyses')
    .select('*')
    .eq('profile_id', profileId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (res.error) throw new Error(`getLatestAnalysis: ${res.error.message}`);
  if (!res.data) return null;
  return coerceNumeric(res.data as ProfileAnalysis, NUM_ANALISE_PERFIL);
}

export async function saveSimilarProfiles(
  profileId: string,
  handles: string[],
  source: 'instagram_suggested' | 'embedding',
): Promise<void> {
  if (handles.length === 0) return;

  const res = await serviceClient().from('similar_profiles').upsert(
    handles.map((handle) => ({ profile_id: profileId, handle, source, score: null })),
    { onConflict: 'profile_id,handle,source' },
  );
  if (res.error) throw new Error(`saveSimilarProfiles: ${res.error.message}`);
}

export async function listSimilarProfiles(profileId: string): Promise<string[]> {
  const res = await serviceClient()
    .from('similar_profiles')
    .select('handle')
    .eq('profile_id', profileId);
  if (res.error) throw new Error(`listSimilarProfiles: ${res.error.message}`);
  return ((res.data ?? []) as Array<{ handle: string }>).map((r) => r.handle);
}

/**
 * Copia o multiplo de performance para os ganchos daquele perfil.
 *
 * A biblioteca de ganchos precisa ordenar por performance sem join — e a tela
 * que voce mais vai abrir, e ela nao pode depender de uma consulta pesada.
 */
export async function propagarPerformanceParaGanchos(profileId: string): Promise<void> {
  const db = serviceClient();

  const analises = await db
    .from('video_analyses')
    .select('id, post_id, post:posts!inner(profile_id), metrica:post_metrics!inner(multiple, engagement_raw)')
    .eq('post.profile_id', profileId);

  if (analises.error) return; // Sem métrica ainda: nada a propagar.

  type Metrica = { multiple: number | string; engagement_raw: number | string };
  type LinhaEmbutida = { id: string; metrica?: Metrica | Metrica[] | null };

  for (const linha of (analises.data ?? []) as unknown as LinhaEmbutida[]) {
    const metrica = umDe(linha.metrica);
    if (!metrica) continue;

    await db
      .from('hooks')
      .update({
        profile_id: profileId,
        performance_multiple: Number(metrica.multiple),
        engagement_raw: Number(metrica.engagement_raw),
      })
      .eq('video_analysis_id', linha.id);
  }
}
