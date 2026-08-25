import { serviceClient } from './client';

/**
 * Trilha de auditoria do scraper no banco. O log completo, acao por acao, vai
 * para arquivo (apps/worker/data/logs); aqui ficam so os eventos que voce vai
 * querer consultar depois pela tela.
 *
 * Nunca lanca excecao: falhar ao registrar auditoria nao pode derrubar um job.
 */
export type ScrapeEventKind =
  | 'nav'
  | 'action'
  | 'block'
  | 'error'
  | 'limit'
  | 'skip'
  /**
   * Uma tentativa de camada de ingestao. `target` diz qual camada, e `detail`
   * traz ok/motivo. Uma linha por TENTATIVA.
   */
  | 'probe'
  /**
   * O desfecho de um link inteiro: `target` e a camada que resolveu, ou
   * 'nenhuma'. Uma linha por LINK — e disto que sai o contador da tela, com
   * um `group by target` e nada mais.
   */
  | 'resolve';

export async function logScrapeEvent(params: {
  jobId?: string | null;
  kind: ScrapeEventKind;
  target?: string | null;
  detail?: Record<string, unknown> | null;
}): Promise<void> {
  try {
    await serviceClient()
      .from('scrape_events')
      .insert({
        job_id: params.jobId ?? null,
        kind: params.kind,
        target: params.target ?? null,
        detail: params.detail ?? null,
      });
  } catch {
    // Silencio proposital.
  }
}

/** Quantos links resolveram em cada camada. Alimenta o contador da tela. */
export interface PlacarDeCamadas {
  camada1: number;
  camada2: number;
  nenhuma: number;
  link_invalido: number;
  total: number;
}

/**
 * Le o placar direto de `scrape_events`. Uma linha `resolve` por link, e o
 * `target` diz qual camada venceu — entao contar e so agrupar.
 *
 * Existe para responder cedo a pergunta que decide o rumo do projeto: a camada
 * 1 esta funcionando na maioria das vezes, ou nao?
 */
export async function placarDeCamadas(): Promise<PlacarDeCamadas> {
  const res = await serviceClient()
    .from('scrape_events')
    .select('target')
    .eq('kind', 'resolve')
    .limit(5_000);

  if (res.error) throw new Error(`placarDeCamadas: ${res.error.message}`);

  const placar: PlacarDeCamadas = {
    camada1: 0, camada2: 0, nenhuma: 0, link_invalido: 0, total: 0,
  };

  for (const linha of (res.data ?? []) as Array<{ target: string | null }>) {
    const alvo = linha.target ?? 'nenhuma';
    if (alvo in placar && alvo !== 'total') {
      placar[alvo as keyof Omit<PlacarDeCamadas, 'total'>] += 1;
      placar.total += 1;
    }
  }

  return placar;
}
