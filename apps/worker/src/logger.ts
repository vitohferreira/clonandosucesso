import { appendFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { dayInTimezone } from '@molde/shared';
import { paths } from './env';

/**
 * Log em JSONL, um arquivo por dia, em apps/worker/data/logs.
 *
 * Toda navegacao e toda acao do navegador passam por aqui — e o que permite
 * auditar depois se o comportamento do scraper foi discreto de fato.
 *
 * Escrita sincrona de proposito: garante ordem e nao perde as ultimas linhas
 * quando o processo morre, que e exatamente quando o log importa.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: '\x1b[90m',
  info: '\x1b[36m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
};

const RESET = '\x1b[0m';

let logDirReady = false;

function ensureLogDir() {
  if (logDirReady) return;
  mkdirSync(paths.logs, { recursive: true });
  logDirReady = true;
}

export type LogFields = Record<string, unknown>;

export class Logger {
  constructor(private readonly base: LogFields = {}) {}

  /** Deriva um logger que carrega contexto fixo (jobId, handle, etc). */
  child(fields: LogFields): Logger {
    return new Logger({ ...this.base, ...fields });
  }

  debug(msg: string, fields?: LogFields) {
    this.write('debug', msg, fields);
  }
  info(msg: string, fields?: LogFields) {
    this.write('info', msg, fields);
  }
  warn(msg: string, fields?: LogFields) {
    this.write('warn', msg, fields);
  }
  error(msg: string, fields?: LogFields) {
    this.write('error', msg, fields);
  }

  private write(level: LogLevel, msg: string, fields?: LogFields) {
    const entry = {
      ts: new Date().toISOString(),
      level,
      msg,
      ...this.base,
      ...fields,
    };

    try {
      ensureLogDir();
      const file = resolve(paths.logs, `molde-${dayInTimezone()}.jsonl`);
      appendFileSync(file, `${JSON.stringify(entry)}\n`, 'utf8');
    } catch (e) {
      // Falhar ao escrever log nunca pode derrubar o worker.
      console.error('[logger] nao consegui escrever no arquivo de log:', e);
    }

    const context = { ...this.base, ...fields };
    const extras = Object.keys(context).length
      ? ` ${Object.entries(context)
          .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
          .join(' ')}`
      : '';

    const time = new Date().toLocaleTimeString('pt-BR');
    console.log(
      `${LEVEL_COLORS[level]}${time} ${level.toUpperCase().padEnd(5)}${RESET} ${msg}${extras}`,
    );
  }
}

export const logger = new Logger();
