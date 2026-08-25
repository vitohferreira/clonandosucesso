import { ingest } from '@molde/config';
import type { Logger } from '../logger';
import { cabecalhosPublicos, esperarUmPouco } from './seguranca';

/**
 * Camada 2: a pagina publica de embed (`/p/{shortcode}/embed/`).
 *
 * E a pagina que o Instagram serve para quem incorpora um post num site — feita
 * para ser vista por quem nao tem conta. Ela nao entrega o arquivo de video,
 * entrega metadado e thumbnail.
 *
 * Serve para duas coisas: confirmar que o post EXISTE e e publico (o que separa
 * "o Instagram exigiu login" de "esse link esta errado"), e dar ao job uma
 * mensagem util quando a camada 1 falha.
 */

export interface DadosDoEmbed {
  shortcode: string;
  handle: string | null;
  legenda: string | null;
  thumbnail: string | null;
  ehVideo: boolean;
}

export type ResultadoEmbed =
  | { ok: true; dados: DadosDoEmbed; segundos: number }
  | { ok: false; motivo: 'exige_login' | 'nao_existe' | 'sem_dados' | 'outro'; mensagem: string; segundos: number };

/** Tira um campo do HTML tentando os formatos que o Instagram usa. */
function extrair(html: string, padroes: RegExp[]): string | null {
  for (const padrao of padroes) {
    const achado = html.match(padrao)?.[1];
    if (achado) {
      return achado
        .replace(/\\u0026/g, '&')
        .replace(/\\"/g, '"')
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/\\\//g, '/')
        .trim();
    }
  }
  return null;
}

export async function consultarEmbed(
  shortcode: string,
  log: Logger,
): Promise<ResultadoEmbed> {
  const comecou = Date.now();
  const url = `https://www.instagram.com/p/${encodeURIComponent(shortcode)}/embed/captioned/`;

  log.info('camada 2 (embed): consultando', { shortcode });
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
    return { ok: false, motivo: 'outro', mensagem: (erro as Error).message, segundos: segundos() };
  }

  if (resposta.status === 404 || resposta.status === 410) {
    return { ok: false, motivo: 'nao_existe', mensagem: `HTTP ${resposta.status}`, segundos: segundos() };
  }
  if (!resposta.ok) {
    return {
      ok: false,
      motivo: resposta.status === 429 || resposta.status === 401 ? 'exige_login' : 'outro',
      mensagem: `HTTP ${resposta.status}`,
      segundos: segundos(),
    };
  }

  const html = await resposta.text();

  // A pagina de embed de um post bloqueado volta com 200 e um aviso no corpo.
  if (/login|entrar para ver|sorry, this page/i.test(html) && html.length < 4_000) {
    return {
      ok: false,
      motivo: 'exige_login',
      mensagem: 'A pagina de embed voltou pedindo login.',
      segundos: segundos(),
    };
  }

  const handle = extrair(html, [
    /"owner"\s*:\s*\{[^}]*"username"\s*:\s*"([^"]+)"/,
    /class="UsernameText"[^>]*>([^<]+)</,
    /"username"\s*:\s*"([^"]+)"/,
  ]);
  const legenda = extrair(html, [
    /"edge_media_to_caption".*?"text"\s*:\s*"(.*?)"\s*\}/s,
    /<div class="Caption"[^>]*>(.*?)<\/div>/s,
    /property="og:description"\s+content="([^"]*)"/,
  ]);
  const thumbnail = extrair(html, [
    /"display_url"\s*:\s*"([^"]+)"/,
    /property="og:image"\s+content="([^"]*)"/,
  ]);
  const ehVideo = /"is_video"\s*:\s*true/.test(html) || /og:video/.test(html);

  if (!handle && !legenda && !thumbnail) {
    return {
      ok: false,
      motivo: 'sem_dados',
      mensagem: `A pagina veio (${html.length} bytes) mas sem nenhum campo que eu saiba ler.`,
      segundos: segundos(),
    };
  }

  return {
    ok: true,
    dados: {
      shortcode,
      handle,
      legenda: legenda ? legenda.replace(/<[^>]+>/g, '').slice(0, 2_000) : null,
      thumbnail,
      ehVideo,
    },
    segundos: segundos(),
  };
}

/** A camada 2 so existe se estiver ligada na config. */
export function embedLigado(): boolean {
  return ingest.usarEmbed;
}
