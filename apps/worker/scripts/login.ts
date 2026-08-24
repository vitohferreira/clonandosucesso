import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { chromium } from 'playwright';
import { scraping } from '@molde/config';
import { isInsideContainer, paths } from '../src/env';

/**
 * Login manual no Instagram, uma vez, na mao.
 *
 * O worker NUNCA faz login programatico e NUNCA guarda sua senha. Ele so
 * reutiliza o storageState que este script grava. Se a sessao expirar, o worker
 * falha com mensagem clara e voce roda isto de novo — ele nao reloga sozinho.
 *
 * IMPORTANTE: este script roda NO HOST, com `npm run login`, nunca dentro do
 * Docker. Playwright headed em container precisa de servidor grafico, e voce
 * quer justamente que o login aconteca do seu navegador, no seu IP residencial,
 * do mesmo jeito que voce sempre entra.
 */

async function main() {
  if (isInsideContainer()) {
    console.error(
      [
        '',
        'Este script nao roda dentro do container.',
        '',
        'Ele abre um navegador de verdade, com janela, para voce logar na mao.',
        'Rode no host, na raiz do repositorio:',
        '',
        '    npm run login',
        '',
        'O arquivo de sessao vai para apps/worker/data/session/, que e o volume',
        'montado pelo container — o worker enxerga a sessao assim que voce terminar.',
        '',
      ].join('\n'),
    );
    process.exit(1);
  }

  mkdirSync(dirname(paths.storageState), { recursive: true });

  if (existsSync(paths.storageState)) {
    console.log(`Ja existe uma sessao em ${paths.storageState}.`);
    console.log('Continuar vai sobrescrever. Ctrl+C para abortar.\n');
  }

  console.log('Abrindo o navegador. Faca login normalmente, como voce sempre faz.');
  console.log('Resolva 2FA e qualquer confirmacao ate cair no feed.\n');

  const browser = await chromium.launch({
    headless: false,
    // Sem --disable-blink-features e sem stealth: quanto mais proximo de um
    // Chromium normal, menos assinatura estranha.
    args: ['--start-maximized'],
  });

  const context = await browser.newContext({
    viewport: scraping.viewport,
    locale: scraping.locale,
    timezoneId: 'America/Sao_Paulo',
  });

  const page = await context.newPage();
  await page.goto('https://www.instagram.com/accounts/login/', {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });

  // Detecta o login pela presenca do cookie de sessao, sem ler o valor dele.
  const deadline = Date.now() + 15 * 60_000;
  let loggedIn = false;

  while (Date.now() < deadline) {
    const cookies = await context.cookies('https://www.instagram.com');
    const session = cookies.find((c) => c.name === 'sessionid' && c.value.length > 0);

    if (session) {
      loggedIn = true;
      break;
    }

    if (page.isClosed()) break;
    await new Promise((r) => setTimeout(r, 3_000));
  }

  if (!loggedIn) {
    console.error('\nNao detectei sessao ativa. Nada foi salvo.');
    await browser.close();
    process.exit(1);
  }

  console.log('\nSessao detectada. Salvando...');

  await context.storageState({ path: paths.storageState });
  // Credencial viva: so o dono le.
  chmodSync(paths.storageState, 0o600);

  await browser.close();

  console.log(`\nPronto. Sessao salva em:\n  ${paths.storageState}\n`);
  console.log('Este arquivo e uma credencial: quem o tiver esta logado na sua conta.');
  console.log('Ele esta no .gitignore. Nao mande para lugar nenhum.\n');
}

main().catch((error) => {
  console.error('Falha no login:', error);
  process.exit(1);
});
