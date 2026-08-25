/**
 * Leitura do link colado. Uma entrada de texto livre vira uma intencao clara,
 * ou uma recusa explicando o porque.
 *
 * Isto acontece ANTES de qualquer requisicao: link que nao da para entender nao
 * merece uma ida ao Instagram.
 */

export type LinkLido =
  | { tipo: 'post'; shortcode: string; handle: string | null; url: string }
  | { tipo: 'perfil'; handle: string; url: string };

/**
 * Caminhos que existem no instagram.com e NAO sao perfil de ninguem. Sem esta
 * lista, `instagram.com/explore` viraria "o perfil @explore".
 */
const NAO_SAO_PERFIS = new Set([
  'p', 'reel', 'reels', 'tv', 'stories', 'explore', 'accounts', 'direct',
  'about', 'developer', 'legal', 'privacy', 'terms', 'directory', 'web',
  'challenge', 'oauth', 'graphql', 'api', 'ajax', 'session', 'emails',
]);

const SHORTCODE = /^[A-Za-z0-9_-]{5,30}$/;
const HANDLE = /^[A-Za-z0-9._]{1,30}$/;

export function lerLink(entrada: string): LinkLido | { tipo: 'erro'; motivo: string } {
  const bruto = entrada.trim();
  if (!bruto) return { tipo: 'erro', motivo: 'Link vazio.' };

  // Aceita "@perfil" digitado direto, sem url nenhuma.
  if (bruto.startsWith('@')) {
    const handle = bruto.slice(1).trim().toLowerCase();
    return HANDLE.test(handle)
      ? { tipo: 'perfil', handle, url: `https://www.instagram.com/${handle}/` }
      : { tipo: 'erro', motivo: `"${bruto}" nao parece um perfil valido.` };
  }

  let url: URL;
  try {
    url = new URL(bruto.includes('://') ? bruto : `https://${bruto}`);
  } catch {
    return { tipo: 'erro', motivo: 'Nao consegui entender esse link.' };
  }

  const dominio = url.hostname.replace(/^www\./, '').toLowerCase();
  if (dominio !== 'instagram.com' && !dominio.endsWith('.instagram.com')) {
    return { tipo: 'erro', motivo: `Isto nao e um link do Instagram (${dominio}).` };
  }

  const partes = url.pathname.split('/').filter(Boolean);
  if (partes.length === 0) {
    return { tipo: 'erro', motivo: 'O link aponta para a home do Instagram, nao para um post ou perfil.' };
  }

  const primeiro = (partes[0] ?? '').toLowerCase();

  // /reel/{code} · /p/{code} · /tv/{code}
  if (primeiro === 'reel' || primeiro === 'reels' || primeiro === 'p' || primeiro === 'tv') {
    const shortcode = partes[1] ?? '';
    if (!SHORTCODE.test(shortcode)) {
      return { tipo: 'erro', motivo: 'Achei o link do post mas nao consegui ler o codigo dele.' };
    }
    return { tipo: 'post', shortcode, handle: null, url: `https://www.instagram.com/${primeiro === 'reels' ? 'reel' : primeiro}/${shortcode}/` };
  }

  // /{handle}/reel/{code} — o formato que o app compartilha
  if (partes.length >= 3 && ['reel', 'p', 'tv'].includes((partes[1] ?? '').toLowerCase())) {
    const handle = primeiro;
    const shortcode = partes[2] ?? '';
    if (!SHORTCODE.test(shortcode)) {
      return { tipo: 'erro', motivo: 'Achei o link do post mas nao consegui ler o codigo dele.' };
    }
    return {
      tipo: 'post',
      shortcode,
      handle: HANDLE.test(handle) && !NAO_SAO_PERFIS.has(handle) ? handle : null,
      url: `https://www.instagram.com/${partes[1]}/${shortcode}/`,
    };
  }

  // /{handle} ou /{handle}/reels
  if (HANDLE.test(primeiro) && !NAO_SAO_PERFIS.has(primeiro)) {
    return { tipo: 'perfil', handle: primeiro, url: `https://www.instagram.com/${primeiro}/` };
  }

  return {
    tipo: 'erro',
    motivo: `Nao reconheci "${url.pathname}" como post nem como perfil.`,
  };
}
