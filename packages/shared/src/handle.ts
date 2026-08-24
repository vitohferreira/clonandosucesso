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
