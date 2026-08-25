import { mkdirSync } from 'node:fs';
import { config, models, queue } from '@molde/config';
import {
  blockJob,
  claimJob,
  completeJob,
  deferJob,
  failJob,
  heartbeatJob,
  logScrapeEvent,
  reapStaleJobs,
  remainingToday,
  supabaseSecretKey,
} from '@molde/db';
import {
  errorMessage,
  isBlockedError,
  isRateLimitReached,
  nextMidnightInTimezone,
  type JobRow,
} from '@molde/shared';
import { paths, requireEnv, workerId } from './env';
import { resolveHandler, type HandlerContext } from './handlers';
import { logger } from './logger';

/**
 * Worker do Molde.
 *
 * Faz polling da tabela `jobs` e executa um job por vez. Sem Redis, sem broker,
 * sem cron: a fila e uma tabela e o `claim_job` do banco resolve a concorrencia.
 *
 * A regra que rege tudo aqui e a distincao entre tres desfechos ruins:
 *
 *   BlockedError        -> sinal DELES. Para tudo, marca `blocked`, nao repete.
 *   RateLimitReached    -> teto NOSSO. Volta para a fila amanha, sem perder nada.
 *   qualquer outro erro -> falha de verdade. Marca `failed` com o stack.
 */

let shuttingDown = false;
const shutdownController = new AbortController();
let currentJobId: string | null = null;

function requestShutdown(signal: string) {
  if (shuttingDown) {
    logger.warn('segundo sinal recebido, saindo na marra', { signal });
    process.exit(1);
  }
  shuttingDown = true;
  shutdownController.abort();
  logger.info('encerrando com calma, aguardando o job atual', { signal, currentJobId });
}

process.on('SIGINT', () => requestShutdown('SIGINT'));
process.on('SIGTERM', () => requestShutdown('SIGTERM'));

// Um erro solto em qualquer lugar nao pode matar o worker.
process.on('unhandledRejection', (reason) => {
  logger.error('promise rejeitada sem tratamento', { error: errorMessage(reason) });
});
process.on('uncaughtException', (error) => {
  logger.error('excecao nao capturada', { error: errorMessage(error) });
});

/** Espera que acorda na hora se o worker estiver encerrando. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();

    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };

    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
  });
}

async function runJob(job: JobRow): Promise<void> {
  const log = logger.child({ jobId: job.id, type: job.type });
  currentJobId = job.id;

  log.info('job iniciado', { attempts: job.attempts, deferCount: job.defer_count });

  // Sinal de vida periodico: sem isso o reaper acha que o worker morreu.
  const heartbeat = setInterval(() => {
    heartbeatJob(job.id).catch((e) => log.warn('heartbeat falhou', { error: errorMessage(e) }));
  }, queue.heartbeatMs);

  const ctx: HandlerContext = {
    job,
    log,
    progress: async (step, opts = {}) => {
      await heartbeatJob(job.id, {
        step,
        current: opts.current ?? null,
        total: opts.total ?? null,
        message: opts.message ?? null,
      });
    },
    signal: shutdownController.signal,
  };

  try {
    const handler = resolveHandler(job.type);
    const { result, costUsd } = await handler(ctx);

    await completeJob(job.id, result, costUsd);
    log.info('job concluido', { costUsd: costUsd ?? 0 });
  } catch (error) {
    if (isBlockedError(error)) {
      // Sinal do Instagram. Terminal por decisao de projeto: quem decide
      // retomar e voce, depois de olhar o que aconteceu.
      log.error('BLOQUEADO — worker nao vai tentar de novo sozinho', {
        reason: error.reason,
        message: error.message,
      });

      await blockJob(job.id, error.reason, { message: error.message, ...error.detail });
      await logScrapeEvent({
        jobId: job.id,
        kind: 'block',
        target: error.reason,
        detail: { message: error.message, ...error.detail },
      });
      return;
    }

    if (isRateLimitReached(error)) {
      // Teto nosso. Nao e falha: volta para a fila depois da virada do dia,
      // e o que ja foi coletado continua salvo no banco.
      const until = nextMidnightInTimezone();

      log.warn('teto diario atingido, job adiado', {
        cap: error.cap,
        used: error.used,
        limit: error.limit,
        until: until.toISOString(),
      });

      await deferJob(job.id, until, error.message);
      await logScrapeEvent({
        jobId: job.id,
        kind: 'limit',
        target: error.cap,
        detail: { used: error.used, limit: error.limit, until: until.toISOString() },
      });
      return;
    }

    const message = errorMessage(error);
    log.error('job falhou', { error: message });
    await failJob(job.id, message);
    await logScrapeEvent({ jobId: job.id, kind: 'error', detail: { message } });
  } finally {
    clearInterval(heartbeat);
    currentJobId = null;
  }
}

/** Jobs orfaos viram `failed`. Nunca voltam para a fila sozinhos. */
async function reap(): Promise<void> {
  try {
    const reaped = await reapStaleJobs(queue.staleJobTimeoutMs);
    if (reaped.length > 0) {
      logger.warn('jobs orfaos marcados como failed', {
        count: reaped.length,
        ids: reaped.map((j) => j.id),
      });
    }
  } catch (e) {
    logger.warn('reaper falhou', { error: errorMessage(e) });
  }
}

/**
 * Orcamento de tempo desta execucao, em milissegundos.
 *
 * Quem define e o workflow (MOLDE_RUN_MINUTES). A diferenca em relacao a matar
 * o processo por fora e a que importa: aqui o worker para de PEGAR trabalho
 * novo quando o orcamento acaba, mas termina o que ja estava fazendo. Job
 * morto no meio ficava `running` orfao e so virava `failed` meia hora depois —
 * do lado de fora, isso parece o site travado.
 */
function orcamentoMs(): number | null {
  const minutos = Number(process.env.MOLDE_RUN_MINUTES);
  return Number.isFinite(minutos) && minutos > 0 ? minutos * 60_000 : null;
}

async function main() {
  requireEnv('SUPABASE_URL');
  if (!supabaseSecretKey()) {
    throw new Error(
      'Falta a chave secreta do Supabase: defina SUPABASE_SECRET_KEY (chave nova, ' +
        'sb_secret_...) ou SUPABASE_SERVICE_ROLE_KEY (legada). Veja .env.example.',
    );
  }

  for (const dir of [paths.logs, paths.media, paths.data]) {
    mkdirSync(dir, { recursive: true });
  }

  logger.info('worker iniciado', {
    workerId,
    dataDir: paths.data,
    timezone: config.TIMEZONE,
    pollIntervalMs: queue.pollIntervalMs,
    // Qual versao do codigo esta rodando. Um worker so carrega o codigo uma vez,
    // no inicio: se ele ficar de pe por 10 minutos, pega trabalhos novos com o
    // codigo antigo. Sem esta linha, isso e invisivel e custa muito tempo.
    commit: process.env.GITHUB_SHA?.slice(0, 7) ?? 'local',
    analise: `${models.analysis.provider}:${models.analysis.model}`,
  });

  try {
    logger.info('tetos de hoje', await remainingToday());
  } catch (e) {
    logger.error('nao consegui falar com o banco', { error: errorMessage(e) });
    throw e;
  }

  await reap();
  let lastReapAt = Date.now();

  const orcamento = orcamentoMs();
  const prazo = orcamento ? Date.now() + orcamento : null;
  let ociosoDesde: number | null = null;
  let processados = 0;

  while (!shuttingDown) {
    // O prazo so e checado ENTRE jobs: o que estiver em andamento termina.
    if (prazo && Date.now() >= prazo) {
      logger.info('orcamento desta execucao acabou; encerrando entre jobs', { processados });
      break;
    }

    if (Date.now() - lastReapAt > queue.reaperIntervalMs) {
      await reap();
      lastReapAt = Date.now();
    }

    let job: JobRow | null = null;
    try {
      job = await claimJob(workerId);
    } catch (e) {
      // Banco fora do ar nao derruba o worker: espera e tenta de novo.
      logger.error('falha ao consultar a fila', { error: errorMessage(e) });
      await sleep(queue.pollIntervalMs, shutdownController.signal);
      continue;
    }

    if (!job) {
      ociosoDesde ??= Date.now();

      // Fila vazia por tempo demais: sair e mais barato que ficar de pe. Quando
      // chegar trabalho novo, o site sobe outro worker.
      if (Date.now() - ociosoDesde >= queue.idleExitMs) {
        logger.info('fila vazia; encerrando para nao gastar minuto a toa', { processados });
        break;
      }

      await sleep(queue.pollIntervalMs, shutdownController.signal);
      continue;
    }

    ociosoDesde = null;
    await runJob(job);
    processados += 1;
  }

  logger.info('worker encerrado', { processados });
  process.exit(0);
}

main().catch((error) => {
  logger.error('worker morreu na inicializacao', { error: errorMessage(error) });
  process.exit(1);
});
