import type { JobRow, JobType } from '@molde/shared';
import type { Logger } from '../logger';
import { linkProbe } from './link-probe';
import { ping } from './ping';
import { profileAnalysis } from './profile-analysis';
import { videoExtraction } from './video-extraction';

/** O que um handler recebe. */
export interface HandlerContext {
  job: JobRow;
  log: Logger;
  /** Atualiza o progresso mostrado na tela e renova o heartbeat do job. */
  progress: (
    step: string,
    opts?: { current?: number; total?: number; message?: string },
  ) => Promise<void>;
  /**
   * Disparado quando o worker recebe SIGINT/SIGTERM. Handler longo deve checar
   * `signal.aborted` entre etapas e parar num ponto seguro — com o que ja
   * coletou salvo, porque a gravacao e incremental.
   */
  signal: AbortSignal;
}

export interface HandlerResult {
  result: unknown;
  /** Custo de API deste job, em USD. Vai para jobs.cost_usd. */
  costUsd?: number;
}

export type Handler = (ctx: HandlerContext) => Promise<HandlerResult>;

/**
 * Registro de handlers. Tipo sem handler registrado falha com mensagem clara,
 * em vez de estourar um erro obscuro.
 */
export const handlers: Partial<Record<JobType, Handler>> = {
  ping,
  link_probe: linkProbe,
  video_extraction: videoExtraction,
  profile_analysis: profileAnalysis,
};

export function resolveHandler(type: JobType): Handler {
  const handler = handlers[type];
  if (!handler) {
    throw new Error(
      `Nenhum handler registrado para o job "${type}". Ele ainda nao foi implementado nesta fase.`,
    );
  }
  return handler;
}
