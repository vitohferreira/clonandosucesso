import { seguranca } from '@molde/config';

/**
 * A trava que garante que a SUA conta nunca entra na jogada.
 *
 * O raciocinio e simples: o Instagram so tem como punir uma conta se conseguir
 * ligar a requisicao a ela. Ele faz isso por cookie de sessao, por token, por
 * login. Se nada disso sai daqui, nao existe conta para punir — no maximo o IP
 * do runner do GitHub leva um limite temporario, que nao e seu, e nao esta
 * ligado a voce de forma nenhuma.
 *
 * Por que isto e codigo e nao um comentario dizendo "lembre-se de nao mandar
 * cookie": porque comentario nao segura ninguem. Daqui a tres meses alguem
 * (inclusive eu) vai estar tentando melhorar a taxa de sucesso as duas da
 * manha, vai ler num forum que "com cookie funciona", e vai ligar. Com esta
 * trava, essa tentativa QUEBRA na hora, alto e claro, em vez de silenciosamente
 * comecar a expor a sua conta.
 */

/**
 * Argumentos do yt-dlp que carregam ou geram credencial. Nenhum deles pode
 * aparecer na linha de comando, nunca.
 */
const ARGUMENTOS_PROIBIDOS = [
  '--cookies',
  '--cookies-from-browser',
  '--username',
  '--password',
  '--netrc',
  '--netrc-cmd',
  '--netrc-location',
  '--video-password',
  '--ap-username',
  '--ap-password',
  '--client-certificate',
];

/**
 * Cabecalhos que identificam uma sessao. `authorization` e `cookie` sao os
 * obvios; os `x-ig-*` sao os que o app do Instagram manda e que denunciam que
 * quem chamou tinha uma sessao na mao.
 */
const CABECALHOS_PROIBIDOS = [
  'cookie',
  'authorization',
  'x-ig-app-id',
  'x-ig-www-claim',
  'x-csrftoken',
  'x-instagram-ajax',
  'x-asbd-id',
];

export class CredencialVazandoError extends Error {
  constructor(oQue: string) {
    super(
      `TRAVA DE SEGURANCA: alguma parte do codigo tentou mandar credencial para o ` +
        `Instagram (${oQue}). A requisicao foi cancelada. Esta ferramenta acessa ` +
        `apenas conteudo publico, deslogada — e assim que a sua conta fica fora de ` +
        `risco. Se voce quer mesmo usar sessao, isso e uma decisao consciente: ` +
        `mude \`seguranca.jamaisEnviarCredencial\` no packages/config.`,
    );
    this.name = 'CredencialVazandoError';
  }
}

/** Confere a linha de comando do yt-dlp antes de ela virar processo. */
export function conferirArgumentos(argv: string[]): void {
  if (!seguranca.jamaisEnviarCredencial) return;

  for (const arg of argv) {
    // Pega tanto `--cookies X` quanto `--cookies=X`.
    const nome = arg.split('=')[0] ?? arg;
    if (ARGUMENTOS_PROIBIDOS.includes(nome)) {
      throw new CredencialVazandoError(`argumento ${nome} do yt-dlp`);
    }
  }
}

/** Confere os cabecalhos de uma requisicao HTTP antes de ela sair. */
export function conferirCabecalhos(headers: Record<string, string>): void {
  if (!seguranca.jamaisEnviarCredencial) return;

  for (const chave of Object.keys(headers)) {
    if (CABECALHOS_PROIBIDOS.includes(chave.toLowerCase())) {
      throw new CredencialVazandoError(`cabecalho ${chave}`);
    }
  }
}

/**
 * Os unicos cabecalhos que mandamos ao Instagram. Lista fechada de proposito:
 * o que nao esta aqui nao sai. E o mesmo conjunto que um navegador comum manda
 * ao abrir uma pagina publica pela primeira vez, sem nunca ter feito login.
 */
export function cabecalhosPublicos(): Record<string, string> {
  const headers = {
    'user-agent': seguranca.userAgent,
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'accept-language': 'pt-BR,pt;q=0.9,en;q=0.8',
    'sec-fetch-dest': 'document',
    'sec-fetch-mode': 'navigate',
    'sec-fetch-site': 'none',
  };

  // Cinto e suspensorio: mesmo esta lista, que eu mesmo escrevi, passa pela
  // conferencia. Se alguem editar a lista errado, quebra aqui.
  conferirCabecalhos(headers);
  return headers;
}

/**
 * Espera aleatoria entre requisicoes. Intervalo fixo e assinatura de robo, e
 * rajada e falta de educacao com o servidor dos outros.
 */
export function esperarUmPouco(): Promise<void> {
  const { min, max } = seguranca.esperaEntreRequisicoesMs;
  const ms = min + Math.floor(Math.random() * (max - min));
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Contador de requisicoes por job. Teto duro: se algo entrar em loop, para
 * antes de virar rajada contra o Instagram.
 */
export class OrcamentoDeRequisicoes {
  private usadas = 0;

  constructor(private readonly teto = seguranca.maxRequisicoesPorJob) {}

  gastar(): void {
    this.usadas += 1;
    if (this.usadas > this.teto) {
      throw new Error(
        `Teto de ${this.teto} requisicoes ao Instagram neste job foi atingido. ` +
          'Parei por seguranca em vez de continuar insistindo.',
      );
    }
  }

  get consumidas(): number {
    return this.usadas;
  }
}
