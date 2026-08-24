import { pingPayloadSchema } from '@molde/shared';
import { workerId } from '../env';
import type { Handler } from './index';

/**
 * Job de fumaca. Nao toca em Instagram, ffmpeg nem API paga.
 *
 * Existe para provar a espinha dorsal inteira: a web enfileira, o worker pega
 * atomicamente, o progresso aparece na tela, o job conclui. Se um bug da Fase 1
 * aparecer, o ping responde na hora se o problema e o pipeline ou e a fila.
 */
export const ping: Handler = async ({ job, log, progress, signal }) => {
  const started = Date.now();
  const payload = pingPayloadSchema.parse(job.payload);

  log.info('ping iniciado', { sleepMs: payload.sleepMs });

  // Trabalho falso em fatias, para dar tempo de ver o progresso andando na tela.
  const steps = 4;
  const sliceMs = Math.floor(payload.sleepMs / steps);

  for (let i = 1; i <= steps; i++) {
    if (signal.aborted) throw new Error('Worker encerrando: ping interrompido');

    await progress('trabalhando', { current: i, total: steps, message: payload.message });
    await new Promise((r) => setTimeout(r, sliceMs));
  }

  const tookMs = Date.now() - started;
  log.info('ping concluido', { tookMs });

  return {
    result: { pong: true, workerId, tookMs, echo: payload.message },
  };
};
