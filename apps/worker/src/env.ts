import { existsSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';

const here = dirname(fileURLToPath(import.meta.url));

/** Raiz do app worker: apps/worker */
export const workerRoot = resolve(here, '..');

/** Raiz do monorepo. */
export const repoRoot = resolve(workerRoot, '..', '..');

// Variavel de ambiente real sempre vence o .env (dotenv nao sobrescreve por
// padrao), entao no Docker o compose manda e o arquivo e so conveniencia local.
for (const candidate of [resolve(repoRoot, '.env'), resolve(workerRoot, '.env')]) {
  if (existsSync(candidate)) loadDotenv({ path: candidate });
}

/**
 * Onde ficam sessao do navegador, midia temporaria e logs.
 * No Docker isto e um volume montado do host — e por isso que o storageState
 * gravado pelo script de login (que roda NO HOST) e visto pelo container.
 */
export const dataDir = process.env.MOLDE_DATA_DIR
  ? resolve(process.env.MOLDE_DATA_DIR)
  : resolve(workerRoot, 'data');

export const paths = {
  data: dataDir,
  /** Credencial viva: quem tem este arquivo esta logado na conta. Nunca versionar. */
  storageState: resolve(dataDir, 'session', 'instagram.json'),
  logs: resolve(dataDir, 'logs'),
  media: resolve(dataDir, 'media'),
} as const;

/** Identidade deste worker, gravada em jobs.locked_by. */
export const workerId = `${hostname()}#${process.pid}`;

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Variavel de ambiente obrigatoria ausente: ${name}. Veja .env.example.`);
  }
  return value;
}

/** True quando estamos rodando dentro de um container. */
export function isInsideContainer(): boolean {
  return existsSync('/.dockerenv') || process.env.MOLDE_IN_CONTAINER === '1';
}
