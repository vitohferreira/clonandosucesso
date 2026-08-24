/**
 * Erros que o worker trata como CASO ESPERADO, nao como excecao.
 * Cada um leva o job para um estado diferente, e essa distincao e o coracao
 * do circuit breaker.
 */

/** Motivos pelos quais o Instagram nos barra. Todos sao terminais. */
export const BLOCK_REASONS = [
  'checkpoint', // "confirme que e voce", verificacao de identidade
  'captcha',
  'rate_limit', // "Please wait a few minutes before you try again"
  'login_required', // sessao expirou: rodar scripts/login.ts de novo
  'unexpected_redirect', // fomos parar numa pagina que nao pedimos
  'account_disabled',
  'private_profile', // nunca coletamos perfil privado
  'not_found',
] as const;

export type BlockReason = (typeof BLOCK_REASONS)[number];

/**
 * Sinal do Instagram. Para tudo imediatamente, marca o job como `blocked`,
 * e NAO tenta de novo sozinho. Quem decide retomar e o usuario.
 */
export class BlockedError extends Error {
  readonly reason: BlockReason;
  readonly detail?: Record<string, unknown>;

  constructor(reason: BlockReason, message?: string, detail?: Record<string, unknown>) {
    super(message ?? `Bloqueado pelo Instagram: ${reason}`);
    this.name = 'BlockedError';
    this.reason = reason;
    this.detail = detail;
  }
}

/**
 * Teto diario nosso, nao deles. NAO e falha e NAO e bloqueio: o job volta para
 * a fila agendado para depois da virada do dia, e o que ja foi coletado fica salvo.
 */
export class RateLimitReachedError extends Error {
  readonly cap: string;
  readonly used: number;
  readonly limit: number;

  constructor(cap: string, used: number, limit: number) {
    super(`Teto diario atingido: ${cap} (${used}/${limit})`);
    this.name = 'RateLimitReachedError';
    this.cap = cap;
    this.used = used;
    this.limit = limit;
  }
}

/**
 * Um item nao carregou. O worker registra, pula e segue.
 * Nunca derruba o job inteiro por causa de um post.
 */
export class ItemSkipped extends Error {
  readonly target: string;

  constructor(target: string, message: string) {
    super(message);
    this.name = 'ItemSkipped';
    this.target = target;
  }
}

export function isBlockedError(e: unknown): e is BlockedError {
  return e instanceof BlockedError || (e as Error)?.name === 'BlockedError';
}

export function isRateLimitReached(e: unknown): e is RateLimitReachedError {
  return e instanceof RateLimitReachedError || (e as Error)?.name === 'RateLimitReachedError';
}

/** Mensagem legivel de um erro desconhecido, sem estourar. */
export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.stack ? `${e.message}\n${e.stack}` : e.message;
  return String(e);
}
