import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Cliente com service role. Ignora RLS, entao NUNCA pode chegar ao browser:
 * so roda no servidor do Next e no worker.
 */
let cached: SupabaseClient | null = null;

export function serviceClient(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      'SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY sao obrigatorios. Copie .env.example para .env.',
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
