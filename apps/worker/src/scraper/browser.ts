import { existsSync } from 'node:fs';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { scraping } from '@molde/config';
import { BlockedError } from '@molde/shared';
import { paths } from '../env';
import type { Logger } from '../logger';
import { vigiarRespostas } from './guard';
import { RESPOSTAS_DE_DADOS } from './selectors';

/**
 * A sessao do navegador.
 *
 * Regras que este arquivo garante:
 *
 * - Sessao unica e persistente. O worker NUNCA faz login programatico e NUNCA
 *   guarda senha. Se o storageState nao existir, ele falha pedindo o login manual.
 * - Somente leitura. Nao existe aqui nenhum caminho que curta, siga ou comente.
 * - Toda navegacao e toda resposta relevante ficam registradas.
 */

export interface Sessao {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  /** Corpos JSON que a propria pagina buscou, para garimpar depois. */
  cargas: unknown[];
  /** Preenchido quando o vigia detecta bloqueio; conferido entre as etapas. */
  bloqueio: BlockedError | null;
  fechar: () => Promise<void>;
}

export async function abrirSessao(log: Logger): Promise<Sessao> {
  if (!existsSync(paths.storageState)) {
    throw new BlockedError(
      'login_required',
      `Nao existe sessao salva em ${paths.storageState}. Rode \`npm run login\` na sua maquina antes de coletar.`,
    );
  }

  const browser = await chromium.launch({ headless: true });

  const context = await browser.newContext({
    storageState: paths.storageState,
    viewport: scraping.viewport,
    locale: scraping.locale,
    timezoneId: 'America/Sao_Paulo',
  });

  context.setDefaultTimeout(scraping.pageTimeoutMs);
  context.setDefaultNavigationTimeout(scraping.pageTimeoutMs);

  const page = await context.newPage();
  const cargas: unknown[] = [];
  const sessao: Sessao = {
    browser,
    context,
    page,
    cargas,
    bloqueio: null,
    fechar: async () => {
      // Salva a sessao de volta: cookie rotacionado pelo Instagram durante a
      // navegacao continua valendo na proxima vez.
      try {
        await context.storageState({ path: paths.storageState });
      } catch {
        // Nao conseguir persistir nao justifica derrubar o job.
      }
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
    },
  };

  // Guarda o JSON que a pagina ja busca sozinha. Isto NAO gera requisicao nova:
  // so escutamos o que ia carregar de qualquer jeito.
  page.on('response', (resposta) => {
    const url = resposta.url();
    if (!RESPOSTAS_DE_DADOS.some((padrao) => padrao.test(url))) return;

    void resposta
      .json()
      .then((corpo) => {
        cargas.push(corpo);
        log.debug('payload capturado', { url: url.slice(0, 120), total: cargas.length });
      })
      .catch(() => {
        // Nem toda resposta que casa o padrao e JSON. Ignorar e o certo.
      });
  });

  vigiarRespostas(page, log, (erro) => {
    // O primeiro bloqueio manda; os seguintes sao consequencia dele.
    sessao.bloqueio ??= erro;
  });

  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) log.info('navegou', { url: frame.url() });
  });

  return sessao;
}

/** Estoura o bloqueio detectado pelo vigia, se houver. Chamar entre as etapas. */
export function conferirBloqueio(sessao: Sessao): void {
  if (sessao.bloqueio) throw sessao.bloqueio;
}
