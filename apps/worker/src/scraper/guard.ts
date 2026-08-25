import type { Page, Response } from 'playwright';
import { BlockedError, type BlockReason } from '@molde/shared';
import type { Logger } from '../logger';
import { SINAIS_DE_BLOQUEIO, URLS } from './selectors';

/**
 * O circuit breaker.
 *
 * Qualquer sinal de que fomos barrados para tudo IMEDIATAMENTE, marca o job como
 * `blocked` e nao tenta de novo sozinho. Retry cego em scraping e exatamente o
 * comportamento que queima conta.
 *
 * A checagem roda em dois lugares: nas respostas HTTP (para pegar 429 e
 * redirecionamento antes mesmo de renderizar) e no conteudo da pagina.
 */

/** Liga a vigilancia das respostas HTTP. Chame uma vez por pagina. */
export function vigiarRespostas(page: Page, log: Logger, aoBloquear: (e: BlockedError) => void) {
  page.on('response', (resposta: Response) => {
    const url = resposta.url();
    const status = resposta.status();

    if (status === 429) {
      aoBloquear(new BlockedError('rate_limit', `HTTP 429 em ${url}`, { url, status }));
      return;
    }

    // 401/403 numa rota de dados significa sessao morta, nao "conteudo restrito".
    if ((status === 401 || status === 403) && url.includes('/api/')) {
      aoBloquear(
        new BlockedError('login_required', `HTTP ${status} em ${url} — sessao expirou?`, {
          url,
          status,
        }),
      );
      return;
    }

    for (const sinal of SINAIS_DE_BLOQUEIO) {
      if (sinal.urls?.some((padrao) => padrao.test(url))) {
        log.warn('resposta suspeita', { url, status, motivo: sinal.motivo });
        aoBloquear(new BlockedError(sinal.motivo, `Redirecionado para ${url}`, { url, status }));
        return;
      }
    }
  });
}

/**
 * Confere a pagina depois que ela carregou.
 *
 * Lanca BlockedError no primeiro sinal. Nunca "tenta contornar": se apareceu
 * checkpoint, o certo e parar e deixar voce decidir.
 */
export async function conferirPagina(page: Page, esperado?: string): Promise<void> {
  const url = page.url();

  for (const sinal of SINAIS_DE_BLOQUEIO) {
    if (sinal.urls?.some((padrao) => padrao.test(url))) {
      throw new BlockedError(sinal.motivo, `A pagina virou ${url}`, { url });
    }
  }

  // Um pedaco do texto basta, e evita serializar uma pagina inteira.
  let texto = '';
  try {
    texto = (await page.locator('body').innerText({ timeout: 5_000 })).slice(0, 4_000);
  } catch {
    texto = '';
  }

  for (const sinal of SINAIS_DE_BLOQUEIO) {
    const bateu = sinal.textos?.find((padrao) => padrao.test(texto));
    if (bateu) {
      throw new BlockedError(sinal.motivo, `A pagina diz: ${bateu.source}`, { url });
    }
  }

  // Fomos parar em lugar nenhum que pedimos.
  if (esperado && !url.includes(esperado) && !url.startsWith(URLS.base)) {
    throw new BlockedError('unexpected_redirect', `Esperava ${esperado}, cheguei em ${url}`, {
      url,
      esperado,
    });
  }
}

/** Traduz o motivo para uma instrucao acionavel, que aparece na tela. */
export function comoResolver(motivo: BlockReason): string {
  switch (motivo) {
    case 'login_required':
      return 'A sessao expirou. Rode `npm run login` na sua maquina e tente de novo.';
    case 'checkpoint':
      return 'O Instagram pediu confirmacao. Abra o app no celular, resolva, e espere algumas horas antes de retomar.';
    case 'captcha':
      return 'Apareceu captcha. Pare por hoje e retome amanha, com o teto diario menor.';
    case 'rate_limit':
      return 'Coletamos rapido demais. Espere algumas horas e reduza os tetos em packages/config.';
    case 'account_disabled':
      return 'A conta foi desativada. Nao insista pela ferramenta.';
    case 'private_profile':
      return 'Perfil privado. A ferramenta nao coleta perfil privado, por decisao de projeto.';
    case 'not_found':
      return 'Perfil inexistente ou removido. Confira o @.';
    case 'unexpected_redirect':
      return 'Fomos parar numa pagina que nao pedimos. Verifique a sessao antes de retomar.';
  }
}
