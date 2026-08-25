import type { PostType } from '@molde/shared';
import { acharPorForma, acharTodosPorForma, FORMAS } from './selectors';

/**
 * Traducao do JSON do Instagram para o nosso modelo.
 *
 * O Instagram serve DOIS formatos diferentes para a mesma coisa, dependendo da
 * rota: o da API v1 (snake_case, `code`, `taken_at`) e o do GraphQL
 * (`shortcode`, `taken_at_timestamp`, contadores dentro de `edge_*`). As funcoes
 * aqui aceitam os dois e devolvem um formato so.
 *
 * Nada aqui lanca por campo ausente: post sem contador e caso esperado (o perfil
 * pode esconder curtidas), nao erro.
 */

function num(valor: unknown): number | null {
  if (typeof valor === 'number' && Number.isFinite(valor)) return valor;
  if (typeof valor === 'string') {
    const n = Number(valor.replace(/[.,\s]/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function contadorAninhado(obj: Record<string, unknown>, chave: string): number | null {
  const alvo = obj[chave];
  if (alvo && typeof alvo === 'object' && 'count' in alvo) {
    return num((alvo as { count: unknown }).count);
  }
  return null;
}

export interface MidiaColetada {
  shortcode: string;
  type: PostType;
  url: string;
  thumbnailUrl: string | null;
  caption: string | null;
  likeCount: number | null;
  commentCount: number | null;
  viewCount: number | null;
  videoDurationSeconds: number | null;
  carouselCount: number | null;
  isPinned: boolean;
  postedAt: string | null;
  /** URL do arquivo de video no CDN, quando o post e video/reel. */
  videoUrl: string | null;
}

/** media_type da API v1: 1 imagem, 2 video, 8 carrossel. */
function tipoDeMidia(obj: Record<string, unknown>): PostType {
  const produto = typeof obj.product_type === 'string' ? obj.product_type : '';
  if (produto === 'clips') return 'reel';

  const mediaType = num(obj.media_type);
  if (mediaType === 8) return 'carousel';
  if (mediaType === 1) return 'image';
  if (mediaType === 2) return 'video';

  if (obj.__typename === 'GraphSidecar' || 'edge_sidecar_to_children' in obj) return 'carousel';
  if (obj.is_video === true) return 'video';
  if (obj.is_video === false) return 'image';

  return 'unknown';
}

export function normalizarMidia(obj: Record<string, unknown>): MidiaColetada | null {
  const shortcode =
    (typeof obj.shortcode === 'string' && obj.shortcode) ||
    (typeof obj.code === 'string' && obj.code) ||
    null;
  if (!shortcode) return null;

  const legendaV1 =
    obj.caption && typeof obj.caption === 'object' && 'text' in obj.caption
      ? String((obj.caption as { text: unknown }).text ?? '')
      : null;

  // GraphQL guarda a legenda em edge_media_to_caption.edges[0].node.text
  let legendaGraph: string | null = null;
  const edgeLegenda = obj.edge_media_to_caption;
  if (edgeLegenda && typeof edgeLegenda === 'object' && 'edges' in edgeLegenda) {
    const edges = (edgeLegenda as { edges: unknown }).edges;
    if (Array.isArray(edges) && edges[0]) {
      const no = (edges[0] as { node?: { text?: unknown } }).node;
      if (no && typeof no.text === 'string') legendaGraph = no.text;
    }
  }

  const carimbo = num(obj.taken_at) ?? num(obj.taken_at_timestamp);

  return {
    shortcode,
    type: tipoDeMidia(obj),
    url: `https://www.instagram.com/p/${shortcode}/`,
    thumbnailUrl:
      (typeof obj.display_url === 'string' && obj.display_url) ||
      (typeof obj.thumbnail_url === 'string' && obj.thumbnail_url) ||
      null,
    caption: legendaV1 ?? legendaGraph,
    likeCount: num(obj.like_count) ?? contadorAninhado(obj, 'edge_media_preview_like'),
    commentCount: num(obj.comment_count) ?? contadorAninhado(obj, 'edge_media_to_comment'),
    viewCount: num(obj.play_count) ?? num(obj.view_count) ?? num(obj.video_view_count),
    videoDurationSeconds: num(obj.video_duration),
    carouselCount:
      num(obj.carousel_media_count) ??
      (Array.isArray(obj.carousel_media) ? obj.carousel_media.length : null),
    // O Instagram marca post fixado com timeline_pinned_user_ids.
    isPinned:
      Array.isArray(obj.timeline_pinned_user_ids) && obj.timeline_pinned_user_ids.length > 0,
    postedAt: carimbo ? new Date(carimbo * 1000).toISOString() : null,
    videoUrl: extrairUrlDeVideo(obj),
  };
}

/** A URL do arquivo de video, que muda de lugar conforme o formato do payload. */
function extrairUrlDeVideo(obj: Record<string, unknown>): string | null {
  if (typeof obj.video_url === 'string') return obj.video_url;

  // API v1: video_versions e uma lista ordenada por qualidade.
  if (Array.isArray(obj.video_versions) && obj.video_versions.length > 0) {
    const melhor = obj.video_versions[0] as { url?: unknown };
    if (typeof melhor?.url === 'string') return melhor.url;
  }

  return null;
}

/** Garimpa todas as midias distintas de tudo que a pagina buscou. */
export function extrairMidias(cargas: unknown[]): MidiaColetada[] {
  const porShortcode = new Map<string, MidiaColetada>();

  for (const carga of cargas) {
    for (const chaves of [FORMAS.midia, FORMAS.midiaAlternativa]) {
      for (const bruto of acharTodosPorForma(carga, [...chaves])) {
        const midia = normalizarMidia(bruto);
        if (!midia) continue;

        // Uma passada posterior pode trazer mais campo que a anterior; ficamos
        // sempre com o registro mais completo.
        const anterior = porShortcode.get(midia.shortcode);
        porShortcode.set(midia.shortcode, anterior ? mesclar(anterior, midia) : midia);
      }
    }
  }

  return [...porShortcode.values()];
}

/** Prefere o valor conhecido ao ausente, campo a campo. */
function mesclar(a: MidiaColetada, b: MidiaColetada): MidiaColetada {
  return {
    shortcode: a.shortcode,
    type: b.type !== 'unknown' ? b.type : a.type,
    url: a.url,
    thumbnailUrl: b.thumbnailUrl ?? a.thumbnailUrl,
    caption: b.caption ?? a.caption,
    likeCount: b.likeCount ?? a.likeCount,
    commentCount: b.commentCount ?? a.commentCount,
    viewCount: b.viewCount ?? a.viewCount,
    videoDurationSeconds: b.videoDurationSeconds ?? a.videoDurationSeconds,
    carouselCount: b.carouselCount ?? a.carouselCount,
    isPinned: a.isPinned || b.isPinned,
    postedAt: b.postedAt ?? a.postedAt,
    videoUrl: b.videoUrl ?? a.videoUrl,
  };
}

export interface PerfilColetado {
  handle: string;
  fullName: string | null;
  bio: string | null;
  externalUrl: string | null;
  category: string | null;
  isVerified: boolean | null;
  isPrivate: boolean | null;
  avatarUrl: string | null;
  followers: number | null;
  following: number | null;
  postsCount: number | null;
}

export function extrairPerfil(cargas: unknown[], handle: string): PerfilColetado | null {
  const bruto =
    acharPorForma(cargas, [...FORMAS.perfil]) ?? acharPorForma(cargas, [...FORMAS.perfilAlternativo]);
  if (!bruto) return null;

  return {
    handle: typeof bruto.username === 'string' ? bruto.username.toLowerCase() : handle,
    fullName: typeof bruto.full_name === 'string' ? bruto.full_name : null,
    bio: typeof bruto.biography === 'string' ? bruto.biography : null,
    externalUrl: typeof bruto.external_url === 'string' ? bruto.external_url : null,
    category:
      (typeof bruto.category_name === 'string' && bruto.category_name) ||
      (typeof bruto.category === 'string' && bruto.category) ||
      null,
    isVerified: typeof bruto.is_verified === 'boolean' ? bruto.is_verified : null,
    isPrivate: typeof bruto.is_private === 'boolean' ? bruto.is_private : null,
    avatarUrl:
      (typeof bruto.profile_pic_url_hd === 'string' && bruto.profile_pic_url_hd) ||
      (typeof bruto.profile_pic_url === 'string' && bruto.profile_pic_url) ||
      null,
    followers: num(bruto.follower_count) ?? contadorAninhado(bruto, 'edge_followed_by'),
    following: num(bruto.following_count) ?? contadorAninhado(bruto, 'edge_follow'),
    postsCount:
      num(bruto.media_count) ?? contadorAninhado(bruto, 'edge_owner_to_timeline_media'),
  };
}

/** Comentarios de um post, so o texto — o autor nao interessa e nao e guardado. */
export function extrairComentarios(cargas: unknown[], limite: number): Array<{
  text: string;
  likeCount: number | null;
}> {
  const vistos = new Set<string>();
  const saida: Array<{ text: string; likeCount: number | null }> = [];

  for (const carga of cargas) {
    for (const bruto of acharTodosPorForma(carga, [...FORMAS.comentario])) {
      const texto = typeof bruto.text === 'string' ? bruto.text.trim() : '';
      if (!texto || vistos.has(texto)) continue;
      vistos.add(texto);
      saida.push({ text: texto, likeCount: num(bruto.comment_like_count) ?? num(bruto.like_count) });
      if (saida.length >= limite) return saida;
    }
  }

  return saida;
}
