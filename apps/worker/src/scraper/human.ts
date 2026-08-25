import type { Page } from 'playwright';
import { scraping } from '@molde/config';

/**
 * Comportamento do navegador.
 *
 * Existe para nao parecer robo. Nenhum valor aqui e fixo de proposito: intervalo
 * constante e assinatura de automacao, e e o tipo de coisa que se detecta com
 * um histograma trivial do lado deles.
 */

export function aleatorio(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

export function esperar(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Pausa entre duas acoes quaisquer. */
export function pausaEntreAcoes(): Promise<void> {
  return esperar(aleatorio(scraping.actionDelayMs.min, scraping.actionDelayMs.max));
}

/** Pausa maior, depois de abrir uma pagina ou um post. */
export function pausaDeNavegacao(): Promise<void> {
  return esperar(aleatorio(scraping.navigationDelayMs.min, scraping.navigationDelayMs.max));
}

/**
 * Scroll incremental com pausa. Nunca `scrollTo(0, scrollHeight)`: chegar ao fim
 * de uma pagina infinita num quadro nao e coisa que gente faz.
 *
 * Para quando `aoRolar` avisar que ja tem o suficiente, quando nada novo
 * aparecer por algumas rodadas, ou no teto de passos.
 */
export async function rolarAosPoucos(
  page: Page,
  aoRolar: () => Promise<{ suficiente: boolean; total: number }>,
): Promise<void> {
  let rodadasSemNovidade = 0;
  let ultimoTotal = 0;

  for (let passo = 0; passo < scraping.scroll.maxSteps; passo++) {
    const estado = await aoRolar();
    if (estado.suficiente) return;

    if (estado.total <= ultimoTotal) {
      rodadasSemNovidade++;
      if (rodadasSemNovidade >= scraping.scroll.idleRoundsBeforeStop) return;
    } else {
      rodadasSemNovidade = 0;
      ultimoTotal = estado.total;
    }

    const fracao = aleatorio(scraping.scroll.stepRatio.min, scraping.scroll.stepRatio.max);
    // O callback roda dentro do browser, nao no Node — por isso o tipo da janela
    // e declarado aqui, em vez de abrir a lib DOM inteira para codigo de servidor.
    await page.evaluate((f: number) => {
      const janela = globalThis as unknown as {
        scrollBy: (x: number, y: number) => void;
        innerHeight: number;
      };
      janela.scrollBy(0, janela.innerHeight * f);
    }, fracao);
    await esperar(aleatorio(scraping.scroll.pauseMs.min, scraping.scroll.pauseMs.max));
  }
}

/**
 * Move o mouse um pouco antes de clicar. Barato, e tira do trafego o padrao de
 * clique sem nenhum movimento anterior.
 */
export async function mexerOMouse(page: Page): Promise<void> {
  try {
    await page.mouse.move(
      aleatorio(100, scraping.viewport.width - 100),
      aleatorio(100, scraping.viewport.height - 100),
      { steps: Math.round(aleatorio(5, 15)) },
    );
  } catch {
    // Movimento de mouse falhar nao e motivo para parar nada.
  }
}
