/**
 * Auth de usuario unico: uma senha em variavel de ambiente.
 *
 * Usa so Web Crypto, sem node:crypto, porque este modulo tambem roda no
 * middleware do Next, que executa no runtime Edge.
 */

const COOKIE_NAME = 'molde_session';
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 dias
const encoder = new TextEncoder();

export { COOKIE_NAME };

function base64url(bytes: ArrayBuffer): string {
  const binary = String.fromCharCode(...new Uint8Array(bytes));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sign(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return base64url(signature);
}

/** Comparacao sem vazar por tempo. */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Confere a senha. Compara os HMACs, e nao as strings: iguala o tamanho e
 * elimina o vazamento por tempo de uma comparacao caractere a caractere.
 */
export async function passwordMatches(
  input: string,
  expected: string,
  secret: string,
): Promise<boolean> {
  if (!input || !expected) return false;
  const [a, b] = await Promise.all([sign(secret, input), sign(secret, expected)]);
  return constantTimeEqual(a, b);
}

/** Token assinado com validade embutida. Nao guarda nada do lado do servidor. */
export async function createSessionToken(secret: string): Promise<string> {
  const expiresAt = String(Date.now() + TTL_MS);
  const signature = await sign(secret, expiresAt);
  return `${expiresAt}.${signature}`;
}

export async function verifySessionToken(
  token: string | undefined,
  secret: string,
): Promise<boolean> {
  if (!token) return false;

  const [expiresAt, signature] = token.split('.');
  if (!expiresAt || !signature) return false;

  const expiry = Number(expiresAt);
  if (!Number.isFinite(expiry) || expiry < Date.now()) return false;

  const expected = await sign(secret, expiresAt);
  return constantTimeEqual(signature, expected);
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: TTL_MS / 1000,
};
