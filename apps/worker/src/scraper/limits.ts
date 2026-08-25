import { consume, ensureCapacity, logScrapeEvent } from '@molde/db';
import type { RateLimitField } from '@molde/shared';
import type { Logger } from '../logger';

/**
 * Tetos diarios aplicados a cada acao.
 *
 * O padrao e sempre: confere ANTES, executa, e so consome DEPOIS que deu certo.
 * Uma acao que falhou nao pode comer o orcamento do dia.
 *
 * Estourar o teto lanca RateLimitReachedError, que o loop do worker trata
 * adiando o job para amanha — nao e falha e nao e bloqueio.
 */
export async function comTeto<T>(
  campo: RateLimitField,
  log: Logger,
  jobId: string,
  acao: () => Promise<T>,
): Promise<T> {
  await ensureCapacity(campo, 1);
  const resultado = await acao();

  const contadores = await consume(campo, 1);
  log.debug('teto consumido', { campo, usado: contadores[campo] });

  return resultado;
}

/** Registra uma navegacao e consome do teto de requisicoes. */
export async function contarNavegacao(
  log: Logger,
  jobId: string,
  alvo: string,
): Promise<void> {
  await ensureCapacity('requests', 1);
  await consume('requests', 1);
  await logScrapeEvent({ jobId, kind: 'nav', target: alvo });
  log.debug('navegacao contabilizada', { alvo });
}
