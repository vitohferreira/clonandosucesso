/**
 * Chamada HTTP para provedor de IA, com o motivo real da falha preservado.
 *
 * O `fetch` do Node embrulha qualquer falha de conexao num `TypeError: fetch
 * failed` e esconde a causa em `error.cause` — que e justamente onde mora a
 * informacao util (conexao derrubada, DNS, TLS, tempo esgotado). Deixar isso
 * escapar transforma um diagnostico de trinta segundos numa investigacao.
 *
 * Tambem tenta de novo em falha transitoria: as APIs derrubam conexao com
 * alguma frequencia quando o corpo e grande, e uma unica tentativa faz o job
 * inteiro falhar por um soluco de rede.
 */

const TENTATIVAS = 3;
const TIMEOUT_MS = 180_000;

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

export async function chamarApi(
  url: string,
  init: RequestInit,
  provedor: string,
): Promise<Response> {
  let ultimoErro: unknown;

  for (let tentativa = 1; tentativa <= TENTATIVAS; tentativa++) {
    try {
      return await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (erro) {
      ultimoErro = erro;

      if (!ehTransitorio(erro) || tentativa === TENTATIVAS) break;

      // Espera crescente: 2s, 4s.
      await new Promise((r) => setTimeout(r, 2_000 * tentativa));
    }
  }

  throw new Error(
    `Nao consegui falar com o ${provedor} apos ${TENTATIVAS} tentativas: ${descreverCausa(ultimoErro)}`,
  );
}
