/**
 * O handle e a chave natural de um perfil. Normalizamos SEMPRE na entrada,
 * porque "@Fulano", "fulano" e "https://instagram.com/fulano/" sao o mesmo perfil
 * e o banco tem unique em `handle`.
 */
const HANDLE_RE = /^[a-z0-9._]{1,30}$/;

export function normalizeHandle(input: string): string {
  let h = input.trim().toLowerCase();

  // Aceita URL completa colada da barra de enderecos.
  const urlMatch = h.match(/^(?:https?:\/\/)?(?:www\.)?instagram\.com\/([^/?#]+)/);
  if (urlMatch?.[1]) h = urlMatch[1];

  h = h.replace(/^@/, '').replace(/\/+$/, '');
  return h;
}

export function isValidHandle(input: string): boolean {
  return HANDLE_RE.test(normalizeHandle(input));
}

export function profileUrl(handle: string): string {
  return `https://www.instagram.com/${normalizeHandle(handle)}/`;
}

export function postUrl(shortcode: string): string {
  return `https://www.instagram.com/p/${shortcode}/`;
}

export interface LinkDoInstagram {
  /** O @ do perfil, quando a URL o inclui. */
  handle: string | null;
  shortcode: string;
}

/**
 * Interpreta um link de post ou reel.
 *
 * O Instagram serve dois formatos, e so um deles carrega o @:
 *
 *   instagram.com/reel/ABC123/            -> sem o @
 *   instagram.com/fulano/reel/ABC123/     -> com o @
 *
 * Isso importa porque a API oficial busca por PERFIL, nao por post: sem saber de
 * quem e o reel, nao ha como pedir o arquivo dele. Quando o link nao traz o @,
 * quem chama precisa perguntar.
 */
export function parseInstagramLink(entrada: string): LinkDoInstagram | null {
  const texto = entrada.trim();

  // O segmento antes de /p/ ou /reel/ e o handle, quando existe.
  const comHandle = texto.match(
    /instagram\.com\/([A-Za-z0-9._]+)\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/,
  );
  if (comHandle?.[1] && comHandle[2]) {
    return { handle: comHandle[1].toLowerCase(), shortcode: comHandle[2] };
  }

  const semHandle = texto.match(/instagram\.com\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/);
  if (semHandle?.[1]) {
    return { handle: null, shortcode: semHandle[1] };
  }

  return null;
}
