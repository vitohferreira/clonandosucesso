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

/**
 * Coage colunas `numeric` para number.
 *
 * O Postgres tem numeric de precisao arbitraria, que nao cabe num double, entao
 * dependendo do caminho (driver, versao do PostgREST) o valor chega como string
 * para nao perder digito. Os nossos tipos de dominio prometem `number | null`,
 * entao a promessa e cumprida aqui, na leitura — e nao com `.toFixed()`
 * espalhado pela interface, que quebra quando o valor vem como texto.
 */
// Sem `extends Record<string, unknown>`: interface do TypeScript nao tem index
// signature implicita, entao a restricao rejeitaria justamente os tipos de linha
// que este helper existe para tratar.
export function coerceNumeric<T>(row: T, fields: readonly string[]): T {
  const saida: Record<string, unknown> = { ...(row as Record<string, unknown>) };
  for (const campo of fields) {
    const valor = saida[campo];
    if (typeof valor === 'string' && valor.trim() !== '') {
      const n = Number(valor);
      if (Number.isFinite(n)) saida[campo] = n;
    }
  }
  return saida as T;
}

export function coerceNumericAll<T>(rows: T[], fields: readonly string[]): T[] {
  return rows.map((row) => coerceNumeric(row, fields));
}
