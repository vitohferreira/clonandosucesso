import { media } from '@molde/config';
import type { Frame } from '../media/ffmpeg';
import type { TranscriptSegment } from './groq';

/**
 * O prompt e o contrato de saida, compartilhados por todos os provedores.
 *
 * Fica aqui, fora dos arquivos de cada provedor, para trocar de modelo nao
 * significar reescrever o que a ferramenta pede — e para uma melhoria no prompt
 * valer para os dois de uma vez.
 */

export const SISTEMA = `Voce faz engenharia reversa de video curto vertical (reel, TikTok, Shorts).

Sua saida NAO e uma transcricao corrida. E um roteiro anotado, no formato que um
editor de video receberia para reproduzir a estrutura do original com outro conteudo.

Regras:

- Os blocos devem cobrir o video inteiro, em ordem, sem buracos e sem sobreposicao.
- O primeiro bloco e sempre o gancho, e vai ate onde a promessa inicial se fecha
  (normalmente os primeiros 2 a 5 segundos).
- "onScreenText" e o texto que aparece ESCRITO na tela: legenda queimada, titulo,
  etiqueta. Transcreva literalmente o que da para ler. Se nao houver, use null.
  Nao repita a fala aqui a menos que ela esteja mesmo escrita na tela.
- "scene" descreve o que esta em quadro de forma acionavel: quem aparece,
  enquadramento, o que acontece, movimento de camera. Escreva para alguem que
  vai recriar aquilo, nao para alguem que ja viu.
- "isBRoll" e true quando o que esta na tela nao e a pessoa falando em quadro
  (imagem de apoio, captura de tela, produto, texto animado).
- "cutCount" e quantos cortes caem dentro daquele bloco, usando a lista de
  instantes de corte fornecida.
- O gancho classificado vira biblioteca: "kind" precisa descrever o MECANISMO
  usado para segurar a atencao, nao o assunto.

Nao invente o que nao da para ver. Os frames sao amostras, nao o video inteiro:
se um trecho nao tem frame, descreva o que a fala e os frames vizinhos permitem
sustentar, sem afirmar detalhe visual que voce nao viu.

Responda em portugues do Brasil.`;

/** O formato exigido, escrito por extenso — provedor sem json_schema depende disto. */
export const FORMATO_JSON = `Responda com um unico objeto json, sem texto antes ou depois,
sem cerca de codigo, exatamente nesta forma:

{
  "blocks": [
    {
      "tIn": 0,
      "tOut": 3.2,
      "role": "gancho",
      "speech": "a fala transcrita deste trecho",
      "onScreenText": "TEXTO NA TELA ou null",
      "scene": "descricao acionavel do que esta em quadro",
      "isBRoll": false,
      "cutCount": 2
    }
  ],
  "hook": {
    "text": "a frase de abertura, literal",
    "kind": "pergunta",
    "onScreenText": "texto na tela durante o gancho ou null",
    "spanSeconds": 3.2,
    "rationale": "por que esse gancho segura, em uma frase"
  },
  "summary": "o que o video faz, em uma frase",
  "cta": "a chamada para acao identificada ou null"
}

"role" so aceita: gancho, contexto, desenvolvimento, virada, prova, cta, outro.
"kind" so aceita: pergunta, contradicao, promessa, numero, erro_comum, pov,
autoridade, historia, urgencia, outro.`;

export interface ContextoVideo {
  durationSeconds: number;
  segments: TranscriptSegment[];
  frames: Frame[];
  sceneTimestamps: number[];
  avgShotSeconds: number;
}

export function formatarTranscricao(segments: TranscriptSegment[]): string {
  if (segments.length === 0) return '(sem fala detectada no audio)';
  return segments
    .map((s) => `[${s.start.toFixed(1)}s - ${s.end.toFixed(1)}s] ${s.text}`)
    .join('\n');
}

/** O bloco de texto que antecede os frames, igual para todos os provedores. */
export function montarContexto(ctx: ContextoVideo): string {
  return [
    `Duracao: ${ctx.durationSeconds.toFixed(1)}s`,
    `Cortes detectados: ${ctx.sceneTimestamps.length}`,
    `Duracao media de cada plano: ${ctx.avgShotSeconds.toFixed(2)}s`,
    `Instantes dos cortes (s): ${
      ctx.sceneTimestamps.length
        ? ctx.sceneTimestamps.map((t) => t.toFixed(1)).join(', ')
        : 'nenhum'
    }`,
    `Janela considerada gancho: primeiros ${media.hookWindowSeconds}s`,
    '',
    'FALA TRANSCRITA:',
    formatarTranscricao(ctx.segments),
    '',
    `FRAMES (${ctx.frames.length} amostras, cada uma identificada pelo instante):`,
  ].join('\n');
}

export interface EstruturaResultado {
  script: import('@molde/shared').StructuredScript;
  modelUsed: string;
  usage: Record<string, unknown>;
  costUsd: number;
}
