import { collection } from '@molde/config';
import { BlockedError } from '@molde/shared';
import { requireEnv } from '../env';
import type { Logger } from '../logger';
import type { MidiaColetada, PerfilColetado } from '../scraper/parse';
import type { Coletor, ResultadoColeta } from './types';

/**
 * Coleta pela API oficial do Instagram (Business Discovery).
 *
 * Este e o caminho seguro: nao usa a sua sessao, nao navega, nao tem como
 * derrubar a sua conta. Roda em qualquer lugar, inclusive dentro do GitHub
 * Actions — o que dispensa manter uma maquina ligada.
 *
 * O que ele NAO alcanca, e nao ha jeito de contornar pela via oficial:
 *   - texto dos comentarios (so a contagem)
 *   - destaques fixados
 *   - perfis sugeridos
 *   - perfil pessoal ou privado (so profissional e publico)
 *
 * Uma nota sobre os numeros: as curtidas aqui sao metrica ORGANICA, enquanto o
 * app mostra organico + impulsionado. Como a diferenca e consistente entre os
 * posts, a deteccao de outlier continua valendo — mas o numero absoluto pode
 * ser menor do que o que voce ve na tela do Instagram.
 */
const VERSAO = 'v21.0';
const BASE = `https://graph.facebook.com/${VERSAO}`;

interface MidiaGraph {
  id?: string;
  caption?: string;
  like_count?: number;
  comments_count?: number;
  media_type?: string;
  media_product_type?: string;
  media_url?: string;
  thumbnail_url?: string;
  permalink?: string;
  timestamp?: string;
}

interface RespostaGraph {
  business_discovery?: {
    username?: string;
    name?: string;
    biography?: string;
    website?: string;
    followers_count?: number;
    follows_count?: number;
    media_count?: number;
    profile_picture_url?: string;
    media?: { data?: MidiaGraph[]; paging?: { cursors?: { after?: string } } };
  };
  error?: { message?: string; code?: number; error_subcode?: number; type?: string };
}

function shortcodeDoPermalink(permalink: string | undefined): string | null {
  return permalink?.match(/\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/)?.[1] ?? null;
}

function traduzirMidia(bruto: MidiaGraph): MidiaColetada | null {
  const shortcode = shortcodeDoPermalink(bruto.permalink) ?? bruto.id ?? null;
  if (!shortcode) return null;

  // media_product_type distingue reel de video de feed; media_type nao.
  const tipo =
    bruto.media_product_type === 'REELS'
      ? 'reel'
      : bruto.media_type === 'CAROUSEL_ALBUM'
        ? 'carousel'
        : bruto.media_type === 'VIDEO'
          ? 'video'
          : bruto.media_type === 'IMAGE'
            ? 'image'
            : 'unknown';

  return {
    shortcode,
    type: tipo,
    url: bruto.permalink ?? `https://www.instagram.com/p/${shortcode}/`,
    thumbnailUrl: bruto.thumbnail_url ?? null,
    caption: bruto.caption ?? null,
    likeCount: typeof bruto.like_count === 'number' ? bruto.like_count : null,
    commentCount: typeof bruto.comments_count === 'number' ? bruto.comments_count : null,
    // A API oficial nao expoe visualizacao de perfil de terceiro.
    viewCount: null,
    // A duracao sai do proprio arquivo, via ffmpeg, depois do download.
    videoDurationSeconds: null,
    carouselCount: null,
    // Post fixado nao e sinalizado pela API.
    isPinned: false,
    postedAt: bruto.timestamp ?? null,
    videoUrl: bruto.media_url ?? null,
  };
}

async function chamar(url: string): Promise<RespostaGraph> {
  const resposta = await fetch(url);
  const corpo = (await resposta.json()) as RespostaGraph;

  if (corpo.error) {
    const msg = corpo.error.message ?? 'erro desconhecido';

    // Token morto ou sem permissao: e o equivalente a "sessao expirou".
    if (corpo.error.code === 190 || corpo.error.type === 'OAuthException') {
      throw new BlockedError(
        'login_required',
        `O token do Instagram foi recusado: ${msg}. Gere um novo no painel do Meta.`,
      );
    }

    // Perfil que a API nao alcanca — pessoal, privado ou inexistente.
    if (/does not exist|cannot be found|not a business|not found/i.test(msg)) {
      throw new BlockedError(
        'not_found',
        `A API nao alcanca esse perfil: ${msg}. A via oficial so le conta profissional e publica.`,
      );
    }

    if (corpo.error.code === 4 || corpo.error.code === 17 || /rate limit/i.test(msg)) {
      throw new BlockedError('rate_limit', `Limite da API atingido: ${msg}`);
    }

    throw new Error(`Instagram Graph API: ${msg}`);
  }

  return corpo;
}

export const coletorOficial: Coletor = {
  nome: 'API oficial (Business Discovery)',
  arriscado: false,
  leComentarios: false,

  async coletar(handle: string, log: Logger): Promise<ResultadoColeta> {
    const token = requireEnv('IG_GRAPH_TOKEN');
    const userId = requireEnv('IG_GRAPH_USER_ID');

    const camposDeMidia = [
      'id',
      'caption',
      'like_count',
      'comments_count',
      'media_type',
      'media_product_type',
      'media_url',
      'thumbnail_url',
      'permalink',
      'timestamp',
    ].join(',');

    const midias: MidiaColetada[] = [];
    let perfil: PerfilColetado | null = null;
    let cursor: string | undefined;

    // A API pagina; buscamos ate o teto de posts por perfil.
    while (midias.length < collection.maxPostsPerProfile) {
      const paginacao = cursor
        ? `.after(${cursor})`
        : `.limit(${Math.min(50, collection.maxPostsPerProfile)})`;

      const campos =
        `business_discovery.username(${handle})` +
        `{followers_count,follows_count,media_count,biography,website,name,username,profile_picture_url,` +
        `media${paginacao}{${camposDeMidia}}}`;

      const url = `${BASE}/${userId}?fields=${encodeURIComponent(campos)}&access_token=${encodeURIComponent(token)}`;
      const corpo = await chamar(url);
      const bd = corpo.business_discovery;

      if (!bd) {
        throw new BlockedError(
          'not_found',
          `A API nao devolveu nada para @${handle}. Confira se e uma conta profissional e publica.`,
        );
      }

      perfil ??= {
        handle: (bd.username ?? handle).toLowerCase(),
        fullName: bd.name ?? null,
        bio: bd.biography ?? null,
        externalUrl: bd.website ?? null,
        // A API nao expoe a categoria declarada de terceiro.
        category: null,
        isVerified: null,
        isPrivate: false,
        avatarUrl: bd.profile_picture_url ?? null,
        followers: bd.followers_count ?? null,
        following: bd.follows_count ?? null,
        postsCount: bd.media_count ?? null,
      };

      const lote = bd.media?.data ?? [];
      for (const bruto of lote) {
        const midia = traduzirMidia(bruto);
        if (midia) midias.push(midia);
      }

      cursor = bd.media?.paging?.cursors?.after;
      if (!cursor || lote.length === 0) break;
    }

    log.info('coleta oficial concluida', {
      handle,
      seguidores: perfil?.followers,
      posts: midias.length,
    });

    return {
      perfil: perfil as PerfilColetado,
      midias: midias.slice(0, collection.maxPostsPerProfile),
      // Nenhum dos tres existe na via oficial.
      destaques: [],
      sugestoes: [],

      async abrirPost(shortcode: string) {
        // Tudo que a API tem ja veio na listagem: abrir de novo nao acrescenta
        // nada e nao custa nada.
        return {
          midia: midias.find((m) => m.shortcode === shortcode) ?? null,
          comentarios: [],
        };
      },

      async baixarVideo(midia: MidiaColetada) {
        if (!midia.videoUrl) throw new Error(`Post ${midia.shortcode} nao tem arquivo de video.`);
        const resposta = await fetch(midia.videoUrl);
        if (!resposta.ok) {
          throw new Error(`CDN recusou o video (HTTP ${resposta.status})`);
        }
        return Buffer.from(await resposta.arrayBuffer());
      },

      async fechar() {
        // Nada a fechar: sao requisicoes HTTP simples.
      },
    };
  },
};
