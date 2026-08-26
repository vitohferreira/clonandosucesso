import type { Logger } from '../logger';
import { cabecalhosPublicos, esperarUmPouco } from './seguranca';

/**
 * O que a pagina publica de um perfil entrega para quem chega DESLOGADO.
 *
 * Isto nao e um coletor: e uma medicao. O objetivo e responder, campo por
 * campo, a pergunta do item 5 do escopo — o que da para coletar de um perfil
 * publico sem sessao nenhuma? A resposta define o que faz sentido construir
 * depois, e o que seria tela para dado que nao existe.
 *
 * Nao ha extrator proprio de Instagram aqui. Ha leitura de campos conhecidos e
 * um relatorio honesto do que veio e do que nao veio — inclusive "nada veio",
 * que e um resultado tao valido quanto os outros.
 */

/** Cada campo vira uma resposta de tres estados, nunca um silencio. */
export type Achado<T> = { veio: true; valor: T } | { veio: false; porque: string };

export interface CamposDoPerfil {
  handle: Achado<string>;
  nome: Achado<string>;
  bio: Achado<string>;
  seguidores: Achado<number>;
  seguindo: Achado<number>;
  totalDePosts: Achado<number>;
  ehPrivado: Achado<boolean>;
  ehVerificado: Achado<boolean>;
  fotoDePerfil: Achado<string>;
  /** Quantos posts do grid a pagina entrega antes de exigir login. */
  postsNoGrid: Achado<number>;
  /** Se algum post do grid veio com curtidas/comentarios junto. */
  metricasNoGrid: Achado<string>;
}

export type ResultadoPerfil =
  | { ok: true; campos: CamposDoPerfil; bytes: number; segundos: number }
  | {
      ok: false;
      motivo: 'exige_login' | 'nao_existe' | 'sem_dados' | 'outro';
      mensagem: string;
      bytes: number;
      segundos: number;
    };

const faltou = (porque: string): Achado<never> => ({ veio: false, porque });

/** Procura um campo em varias formas conhecidas de aparecer no HTML. */
function achar(html: string, padroes: RegExp[]): string | null {
  for (const padrao of padroes) {
    const achado = html.match(padrao)?.[1];
    if (achado !== undefined && achado !== '') return achado;
  }
  return null;
}

function numero(html: string, padroes: RegExp[]): number | null {
  const bruto = achar(html, padroes);
  if (bruto === null) return null;
  const limpo = Number(bruto.replace(/[.,\s]/g, ''));
  return Number.isFinite(limpo) ? limpo : null;
}

function texto(html: string, padroes: RegExp[], rotulo: string): Achado<string> {
  const v = achar(html, padroes);
  return v === null
    ? faltou(`nao achei ${rotulo} no html`)
    : { veio: true, valor: v.replace(/\\u[\dA-F]{4}/gi, '').replace(/\\n/g, ' ').trim().slice(0, 400) };
}

function contagem(html: string, padroes: RegExp[], rotulo: string): Achado<number> {
  const v = numero(html, padroes);
  return v === null ? faltou(`nao achei ${rotulo} no html`) : { veio: true, valor: v };
}

export async function sondarPerfilPublico(
  handle: string,
  log: Logger,
): Promise<ResultadoPerfil> {
  const comecou = Date.now();
  const url = `https://www.instagram.com/${encodeURIComponent(handle)}/`;

  log.info('camada 2 (pagina publica de perfil): consultando', { handle });
  await esperarUmPouco();

  const segundos = () => Number(((Date.now() - comecou) / 1000).toFixed(1));

  let resposta: Response;
  try {
    resposta = await fetch(url, {
      headers: cabecalhosPublicos(),
      redirect: 'follow',
      signal: AbortSignal.timeout(30_000),
    });
  } catch (erro) {
    return { ok: false, motivo: 'outro', mensagem: (erro as Error).message, bytes: 0, segundos: segundos() };
  }

  const html = await resposta.text().catch(() => '');
  const bytes = html.length;

  if (resposta.status === 404) {
    return { ok: false, motivo: 'nao_existe', mensagem: 'HTTP 404', bytes, segundos: segundos() };
  }

  // Redirecionado para o login e o sinal mais claro de muro.
  if (/\/accounts\/login/.test(resposta.url) || resposta.status === 401) {
    return {
      ok: false,
      motivo: 'exige_login',
      mensagem: `A pagina redirecionou para o login (${resposta.url.slice(0, 120)}).`,
      bytes,
      segundos: segundos(),
    };
  }

  if (!resposta.ok) {
    return {
      ok: false,
      motivo: resposta.status === 429 ? 'exige_login' : 'outro',
      mensagem: `HTTP ${resposta.status}`,
      bytes,
      segundos: segundos(),
    };
  }

  // Os shortcodes do grid: se aparecerem, o grid veio; se nao, o Instagram
  // entregou so a casca da pagina e deixou o conteudo para o javascript logado.
  const shortcodes = new Set(
    [...html.matchAll(/"shortcode"\s*:\s*"([A-Za-z0-9_-]{5,30})"/g)].map((m) => m[1] as string),
  );
  for (const m of html.matchAll(/\/(?:p|reel)\/([A-Za-z0-9_-]{5,30})\//g)) {
    shortcodes.add(m[1] as string);
  }

  const temCurtidas = /"edge_liked_by"|"like_count"/.test(html);
  const temComentarios = /"edge_media_to_comment"|"comment_count"/.test(html);
  const temViews = /"video_view_count"|"play_count"|"view_count"/.test(html);

  const metricas = [
    temCurtidas ? 'curtidas' : null,
    temComentarios ? 'comentarios' : null,
    temViews ? 'views' : null,
  ].filter(Boolean);

  const campos: CamposDoPerfil = {
    handle: texto(html, [/"username"\s*:\s*"([^"]+)"/, /property="og:title"\s+content="[^"(]*\(@([^)]+)\)/], 'o handle'),
    nome: texto(html, [/"full_name"\s*:\s*"([^"]*)"/, /property="og:title"\s+content="([^"(]+)/], 'o nome'),
    bio: texto(html, [/"biography"\s*:\s*"([^"]*)"/, /property="og:description"\s+content="([^"]*)"/], 'a bio'),
    seguidores: contagem(html, [/"edge_followed_by"\s*:\s*\{\s*"count"\s*:\s*(\d+)/, /"follower_count"\s*:\s*(\d+)/, /content="([\d.,]+)\s*Followers/i], 'os seguidores'),
    seguindo: contagem(html, [/"edge_follow"\s*:\s*\{\s*"count"\s*:\s*(\d+)/, /"following_count"\s*:\s*(\d+)/, /([\d.,]+)\s*Following/i], 'o seguindo'),
    totalDePosts: contagem(html, [/"edge_owner_to_timeline_media"\s*:\s*\{\s*"count"\s*:\s*(\d+)/, /"media_count"\s*:\s*(\d+)/, /([\d.,]+)\s*Posts/i], 'o total de posts'),
    ehPrivado: /"is_private"\s*:\s*(true|false)/.test(html)
      ? { veio: true, valor: /"is_private"\s*:\s*true/.test(html) }
      : faltou('nao achei is_private no html'),
    ehVerificado: /"is_verified"\s*:\s*(true|false)/.test(html)
      ? { veio: true, valor: /"is_verified"\s*:\s*true/.test(html) }
      : faltou('nao achei is_verified no html'),
    fotoDePerfil: texto(html, [/"profile_pic_url_hd"\s*:\s*"([^"]+)"/, /"profile_pic_url"\s*:\s*"([^"]+)"/, /property="og:image"\s+content="([^"]*)"/], 'a foto de perfil'),
    postsNoGrid: shortcodes.size > 0
      ? { veio: true, valor: shortcodes.size }
      : faltou('nenhum shortcode de post apareceu no html'),
    metricasNoGrid: metricas.length > 0
      ? { veio: true, valor: metricas.join(', ') }
      : faltou('nenhuma metrica de post apareceu no html'),
  };

  const quantosVieram = Object.values(campos).filter((c) => c.veio).length;

  if (quantosVieram === 0) {
    return {
      ok: false,
      motivo: 'sem_dados',
      mensagem:
        `A pagina veio com ${bytes} bytes e HTTP ${resposta.status}, mas nenhum campo ` +
        'conhecido apareceu. Provavelmente e a casca vazia que o Instagram serve para ' +
        'quem nao esta logado, com o conteudo montado depois pelo javascript.',
      bytes,
      segundos: segundos(),
    };
  }

  log.info('campos do perfil lidos', { handle, quantosVieram, de: Object.keys(campos).length, bytes });
  return { ok: true, campos, bytes, segundos: segundos() };
}
