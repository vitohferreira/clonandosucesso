import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Cliente com a chave secreta do Supabase. Ela ignora RLS, entao NUNCA pode
 * chegar ao browser: so roda no servidor do Next e no worker.
 */
let cached: SupabaseClient | null = null;

/**
 * A chave secreta aceita dois nomes de variavel, porque o Supabase esta no meio
 * de uma troca de formato:
 *
 *   SUPABASE_SECRET_KEY        chave nova (sb_secret_...), o caminho daqui pra frente
 *   SUPABASE_SERVICE_ROLE_KEY  chave legada (JWT), e o nome que a integracao da
 *                              Vercel injeta sozinha
 *
 * As duas funcionam igual no supabase-js. Aceitar ambas evita que voce fique
 * preso ao nome errado quando as legadas forem removidas.
 */
export function supabaseSecretKey(): string | undefined {
  return process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
}

export function serviceClient(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.SUPABASE_URL;
  const key = supabaseSecretKey();

  if (!url || !key) {
    throw new Error(
      'Faltou SUPABASE_URL ou a chave secreta (SUPABASE_SECRET_KEY, ou ' +
        'SUPABASE_SERVICE_ROLE_KEY se o projeto ainda usa a chave legada). ' +
        'Copie .env.example para .env.',
    );
  }

  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return cached;
}

/** Erro de query do Supabase vira excecao com contexto de onde aconteceu. */
export function unwrap<T>(
  res: { data: T | null; error: { message: string; details?: string | null } | null },
  context: string,
): T {
  if (res.error) {
    const details = res.error.details ? ` (${res.error.details})` : '';
    throw new Error(`${context}: ${res.error.message}${details}`);
  }
  if (res.data === null) {
    throw new Error(`${context}: nenhum dado retornado`);
  }
  return res.data;
}
