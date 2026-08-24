import { serviceClient } from './client';

/**
 * Trilha de auditoria do scraper no banco. O log completo, acao por acao, vai
 * para arquivo (apps/worker/data/logs); aqui ficam so os eventos que voce vai
 * querer consultar depois pela tela.
 *
 * Nunca lanca excecao: falhar ao registrar auditoria nao pode derrubar um job.
 */
export type ScrapeEventKind = 'nav' | 'action' | 'block' | 'error' | 'limit' | 'skip';

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
