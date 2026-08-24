/**
 * Tipos das linhas do banco. Espelham as migrations em supabase/migrations.
 *
 * Quando o schema mudar, rode `npm run db:types` (veja o README) e confira
 * este arquivo contra a saida — ele e escrito a mao de proposito, para as
 * queries do packages/db terem retorno tipado sem arrastar o tipo `Database`
 * inteiro do Supabase para dentro de tudo.
 */

export type PostType = 'reel' | 'carousel' | 'image' | 'video' | 'unknown';
export type MediaSource = 'instagram' | 'upload';

/**
 * Em qual base o engajamento foi medido. Posts so podem ser comparados entre si
 * quando compartilham a mesma base: perfil que esconde curtidas nao pode ter a
 * mediana misturada com perfil que mostra.
 */
export type MetricBasis = 'likes_comments' | 'views' | 'comments_only';

export interface Profile {
  id: string;
  handle: string;
  full_name: string | null;
  bio: string | null;
  external_url: string | null;
  category: string | null;
  is_verified: boolean | null;
  is_private: boolean | null;
  avatar_path: string | null;
  niche: string | null;
  notes: string | null;
  first_analyzed_at: string | null;
  last_analyzed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProfileSnapshot {
  id: string;
  profile_id: string;
  followers: number | null;
  following: number | null;
  posts_count: number | null;
  captured_at: string;
}

export interface Post {
  id: string;
  profile_id: string;
  shortcode: string;
  type: PostType;
  url: string | null;
  thumbnail_path: string | null;
  caption: string | null;
  like_count: number | null;
  comment_count: number | null;
  view_count: number | null;
  video_duration_s: number | null;
  carousel_count: number | null;
  is_pinned: boolean;
  posted_at: string | null;
  detail_fetched: boolean;
  detail_fetched_at: string | null;
  raw: Record<string, unknown> | null;
  collected_at: string;
  updated_at: string;
}

export interface PostMetrics {
  id: string;
  post_id: string;
  basis: MetricBasis;
  engagement_raw: number;
  engagement_rate: number | null;
  baseline_median: number;
  window_kind: 'rolling' | 'global';
  window_size: number | null;
  multiple: number;
  is_outlier: boolean;
  outlier_tier: number | null;
  provisional: boolean;
  computed_at: string;
}

export interface VideoAnalysis {
  id: string;
  post_id: string | null;
  job_id: string | null;
  source: MediaSource;
  source_url: string | null;
  audio_path: string | null;
  frames_path: string | null;
  duration_s: number | null;
  transcript_raw: Record<string, unknown> | null;
  transcript_text: string | null;
  script: Record<string, unknown> | null;
  hook_text: string | null;
  cut_count: number | null;
  avg_shot_s: number | null;
  shot_boundaries: Record<string, unknown> | null;
  model_used: string | null;
  usage: Record<string, unknown> | null;
  cost_usd: number | null;
  created_at: string;
}

export interface Hook {
  id: string;
  video_analysis_id: string | null;
  post_id: string | null;
  profile_id: string | null;
  text: string;
  kind: string | null;
  on_screen_text: string | null;
  span_seconds: number | null;
  performance_multiple: number | null;
  engagement_raw: number | null;
  created_at: string;
}

export interface Highlight {
  id: string;
  profile_id: string;
  title: string;
  position: number | null;
  item_count: number | null;
  theme_summary: string | null;
  collected_at: string;
}

/** Sem handle do autor de proposito: a dor da audiencia esta no texto. */
export interface PostComment {
  id: string;
  post_id: string;
  text: string;
  like_count: number | null;
  collected_at: string;
}

export interface ProfileAnalysis {
  id: string;
  profile_id: string;
  job_id: string | null;
  format_distribution: Record<string, unknown> | null;
  cadence: Record<string, unknown> | null;
  duration_buckets: Record<string, unknown> | null;
  narrative_patterns: Record<string, unknown> | null;
  cta_patterns: Record<string, unknown> | null;
  what_fails: Record<string, unknown> | null;
  audience_pain: Record<string, unknown> | null;
  synthesis_md: string | null;
  model_used: string | null;
  usage: Record<string, unknown> | null;
  cost_usd: number | null;
  created_at: string;
}

export interface SimilarProfile {
  profile_id: string;
  handle: string;
  source: 'instagram_suggested' | 'embedding';
  score: number | null;
  discovered_at: string;
}

export interface RateLimitCounters {
  day: string;
  profiles_analyzed: number;
  posts_opened: number;
  videos_downloaded: number;
  requests: number;
  updated_at: string;
}

export type RateLimitField = Exclude<keyof RateLimitCounters, 'day' | 'updated_at'>;
