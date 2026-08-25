import { logger } from '../logger';

/**
 * Chamada HTTP para provedor de IA: preserva o motivo real da falha e insiste
 * quando o problema e passageiro.
 *
 * Duas coisas diferentes derrubam uma chamada dessas, e as duas precisam de
 * tratamento aqui:
 *
 * 1. A conexao cai. O `fetch` do Node embrulha isso num `TypeError: fetch
 *    failed` generico e esconde a causa em `error.cause` — que e justamente
 *    onde mora a informacao util (conexao derrubada, DNS, TLS, tempo esgotado).
 *
 * 2. O servidor responde, mas dizendo "estou ocupado, tente mais tarde" (429,
 *    503, "high demand"). Isso NAO e erro nosso e NAO e erro da requisicao: e o
 *    provedor sobrecarregado. Desistir na primeira resposta dessas faz o job
 *    inteiro falhar por causa de um pico de trafego do outro lado — que e
 *    exatamente o que a mensagem esta pedindo para nao fazer.
 *
 * O que este arquivo NAO faz e insistir em erro de verdade (chave errada,
 * modelo inexistente, corpo malformado): esses voltam na hora, porque tentar de
 * novo so atrasaria a mensagem certa.
 */

const TENTATIVAS = 4;
const TIMEOUT_MS = 180_000;
const ESPERA_MAXIMA_MS = 60_000;

/**
 * Status que significam "tente de novo", nao "voce pediu errado".
 * 529 e o "overloaded" da Anthropic; 529/503 tambem aparecem no Gemini.
 */
const STATUS_PASSAGEIRO = new Set([408, 409, 425, 429, 500, 502, 503, 504, 529]);

/**
 * Alguns provedores devolvem sobrecarga com status generico, e a unica pista
 * esta no texto. Vale so para resposta que ja veio com erro.
 */
const TEXTO_PASSAGEIRO =
  /high demand|overload|temporar|try again|currently unavailable|capacity|server error|timeout|is busy|please retry/i;

function descreverCausa(erro: unknown): string {
  const causa = (erro as { cause?: unknown })?.cause;
  if (!causa) return erro instanceof Error ? erro.message : String(erro);

  const c = causa as { code?: string; message?: string; errno?: number };
  const partes = [c.code, c.message].filter(Boolean);

  // Os codigos mais comuns, traduzidos para o que significam na pratica.
  const explicacao: Record<string, string> = {
    ECONNRESET: 'o servidor derrubou a conexao no meio do envio',
    ETIMEDOUT: 'o servidor nao respondeu a tempo',
    ENOTFOUND: 'nao consegui resolver o endereco do servidor',
    ECONNREFUSED: 'o servidor recusou a conexao',
    EPIPE: 'a conexao fechou antes de o envio terminar',
    UND_ERR_HEADERS_TIMEOUT: 'o servidor demorou demais para comecar a responder',
    UND_ERR_BODY_TIMEOUT: 'o servidor parou de enviar a resposta no meio',
  };

  const humana = c.code ? explicacao[c.code] : undefined;
  return `${partes.join(': ')}${humana ? ` — ${humana}` : ''}`;
}

function ehTransitorio(erro: unknown): boolean {
  const codigo = (erro as { cause?: { code?: string } })?.cause?.code;
  return (
    codigo === 'ECONNRESET' ||
    codigo === 'ETIMEDOUT' ||
    codigo === 'EPIPE' ||
    codigo === 'UND_ERR_HEADERS_TIMEOUT' ||
    codigo === 'UND_ERR_BODY_TIMEOUT' ||
    erro instanceof DOMException // AbortError do nosso proprio timeout
  );
}

/** Quanto esperar antes da proxima tentativa. O servidor tem preferencia. */
function esperaDe(response: Response | null, tentativa: number): number {
  const cabecalho = response?.headers.get('retry-after');
  if (cabecalho) {
    const segundos = Number(cabecalho);
    if (Number.isFinite(segundos) && segundos > 0) {
      return Math.min(segundos * 1_000, ESPERA_MAXIMA_MS);
    }
    const data = Date.parse(cabecalho);
    if (Number.isFinite(data)) {
      const ms = data - Date.now();
      if (ms > 0) return Math.min(ms, ESPERA_MAXIMA_MS);
    }
  }

  // 2s, 4s, 8s. O ruido evita que varias chamadas voltem no mesmo instante.
  const base = 2_000 * 2 ** (tentativa - 1);
  return Math.min(base, ESPERA_MAXIMA_MS) + Math.floor(Math.random() * 1_000);
}

/**
 * O corpo de uma resposta so pode ser lido uma vez. Como precisamos ler para
 * decidir se vale tentar de novo, devolvemos uma copia intacta para quem chamou
 * continuar usando `.json()` / `.text()` normalmente.
 */
function reconstruir(response: Response, corpo: string): Response {
  const headers = new Headers(response.headers);
  // O corpo ja saiu descomprimido ao virar texto; manter estes cabecalhos faria
  // o consumidor tentar descomprimir de novo.
  headers.delete('content-encoding');
  headers.delete('content-length');
  return new Response(corpo, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function resumir(corpo: string): string {
  const texto = corpo.trim();
  if (!texto) return '';
  try {
    const json = JSON.parse(texto) as { error?: { message?: string } | string; message?: string };
    const msg =
      typeof json.error === 'string' ? json.error : (json.error?.message ?? json.message);
    if (msg) return msg.slice(0, 300);
  } catch {
    // Corpo nao e json; segue com o texto cru.
  }
  return texto.slice(0, 300);
}

export async function chamarApi(
  url: string,
  init: RequestInit,
  provedor: string,
): Promise<Response> {
  let ultimoErro: unknown;

  for (let tentativa = 1; tentativa <= TENTATIVAS; tentativa++) {
    let response: Response;

    try {
      response = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (erro) {
      ultimoErro = erro;

      if (!ehTransitorio(erro) || tentativa === TENTATIVAS) break;

      const espera = esperaDe(null, tentativa);
      logger.warn('provedor de IA caiu no meio da conexao; tentando de novo', {
        provedor,
        tentativa,
        de: TENTATIVAS,
        emMs: espera,
        motivo: descreverCausa(erro),
      });
      await new Promise((r) => setTimeout(r, espera));
      continue;
    }

    // Resposta boa: entrega direto, sem tocar no corpo.
    if (response.ok) return response;

    const corpo = await response.text().catch(() => '');
    const passageiro =
      STATUS_PASSAGEIRO.has(response.status) || TEXTO_PASSAGEIRO.test(corpo);

    // Erro de verdade (chave, modelo, formato) ou acabaram as tentativas:
    // devolve a resposta para o provedor traduzir a mensagem no lugar certo.
    if (!passageiro || tentativa === TENTATIVAS) return reconstruir(response, corpo);

    const espera = esperaDe(response, tentativa);
    logger.warn('provedor de IA ocupado; esperando e tentando de novo', {
      provedor,
      status: response.status,
      tentativa,
      de: TENTATIVAS,
      emMs: espera,
      motivo: resumir(corpo),
    });
    await new Promise((r) => setTimeout(r, espera));
  }

  throw new Error(
    `Nao consegui falar com o ${provedor} apos ${TENTATIVAS} tentativas: ${descreverCausa(ultimoErro)}`,
  );
}
