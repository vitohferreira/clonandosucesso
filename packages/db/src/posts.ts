import { collection } from '@molde/config';
import type { Post, PostType } from '@molde/shared';
import { serviceClient } from './client';

/**
 * O que se sabe sobre um post numa coleta. Tudo opcional de proposito: uma
 * passada pelo grid ve tipo e thumbnail; abrir o post ve curtidas e duracao.
 */
export interface PostUpsertInput {
  profile_id: string;
  shortcode: string;
  type?: PostType;
  url?: string;
  thumbnail_path?: string;
  caption?: string;
  like_count?: number;
  comment_count?: number;
  view_count?: number;
  video_duration_s?: number;
  carousel_count?: number;
  is_pinned?: boolean;
  posted_at?: string;
  detail_fetched?: boolean;
  raw?: Record<string, unknown>;
}

/**
 * Grava um post NA HORA em que ele e coletado.
 *
 * O scraping nao e transacional: se o worker morrer no post 80 de 100, os 80
 * ja estao salvos. E o upsert por shortcode nunca apaga dado bom com dado
 * ausente — chave omitida significa "nao observei nesta passada".
 *
 * Por isso removemos aqui as chaves null/undefined: no SQL, a checagem e
 * `p ? 'campo'`, entao mandar null explicito APAGARIA o valor anterior.
 */
export async function upsertPost(input: PostUpsertInput): Promise<Post> {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== null && value !== undefined) clean[key] = value;
  }

  const res = await serviceClient().rpc('upsert_post', { p: clean });
  if (res.error) throw new Error(`upsertPost(${input.shortcode}): ${res.error.message}`);
  return res.data as Post;
}

/**
 * Posts que ainda valem uma abertura individual. Quem ja foi aberto ha pouco
 * fica de fora: reabrir sem necessidade queima teto diario a toa.
 */
export async function postsNeedingDetail(
  profileId: string,
  options: { forceRefetch?: boolean; limit?: number } = {},
): Promise<Post[]> {
  const { forceRefetch = false, limit = collection.maxPostsPerProfile } = options;

  const res = await serviceClient().rpc('posts_needing_detail', {
    p_profile_id: profileId,
    // forceRefetch = reabrir tudo, ignorando a janela.
    p_refetch_after_days: forceRefetch ? 0 : collection.refetchDetailAfterDays,
    p_limit: limit,
  });

  if (res.error) throw new Error(`postsNeedingDetail: ${res.error.message}`);
  return (res.data ?? []) as Post[];
}

export async function listPosts(profileId: string, limit = 500): Promise<Post[]> {
  const res = await serviceClient()
    .from('posts')
    .select('*')
    .eq('profile_id', profileId)
    .order('posted_at', { ascending: false, nullsFirst: false })
    .limit(limit);

  if (res.error) throw new Error(`listPosts: ${res.error.message}`);
  return (res.data ?? []) as Post[];
}
