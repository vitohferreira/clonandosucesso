import { chamarApi } from './http';

/**
 * Lista de modelos do Groq, buscada uma vez por processo.
 *
 * Existe porque o mesmo erro ja apareceu duas vezes aqui: nome de modelo escrito
 * na mao no codigo, o Groq aposenta o nome, e o job morre com
 * `model_not_found`. A cura vale para os dois usos — transcricao e visao — e
 * cada um pontua a lista com o proprio criterio, entao a busca fica aqui, num
 * lugar so, e a rede e consultada uma vez.
 */
const LISTA = 'https://api.groq.com/openai/v1/models';

let cache: string[] | null = null;

/** Todos os ids que a chave alcanca, sem filtro nem ordem. */
export async function idsDoGroq(apiKey: string): Promise<string[]> {
  if (cache) return cache;

  const r = await chamarApi(
    LISTA,
    { method: 'GET', headers: { authorization: `Bearer ${apiKey}` } },
    'Groq',
  );

  if (!r.ok) {
    throw new Error(
      `Nao consegui listar os modelos do Groq (HTTP ${r.status}). Confira a GROQ_API_KEY.`,
    );
  }

  const dados = (await r.json()) as { data?: Array<{ id?: string }> };
  cache = (dados.data ?? []).map((m) => m.id ?? '').filter((id) => id.length > 0);
  return cache;
}

/**
 * Ordena os ids pelo criterio de quem chamou, do melhor para o pior, jogando
 * fora tudo que pontuou zero ou menos.
 */
export function rankear(ids: string[], pontuar: (id: string) => number): string[] {
  return ids
    .map((id) => ({ id, pontos: pontuar(id) }))
    .filter((c) => c.pontos > 0)
    .sort((a, b) => b.pontos - a.pontos)
    .map((c) => c.id);
}
