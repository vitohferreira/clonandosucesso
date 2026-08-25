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


/* ------------------------------------------------------- sintese do perfil */

export const SISTEMA_PERFIL = `Voce analisa um perfil do Instagram para descobrir a
estrutura por tras do que funciona nele.

O leitor nao quer conselho generico sobre redes sociais. Ele quer entender o
mecanismo especifico DESTE perfil, para reproduzir a estrutura com identidade
propria.

Regras:

- Toda afirmacao precisa estar amarrada ao que foi coletado. Se os dados nao
  sustentam, nao afirme.
- O post mediano nao interessa. O que interessa e por que uns poucos explodiram
  e a maioria nao.
- "whatFails" e tao valioso quanto o que funciona: aponte o que o perfil tenta
  repetidamente e nao decola.
- "audiencePain" sai dos comentarios, nao da sua intuicao. Cite o que foi dito.
- "hookFormula" precisa ser acionavel: alguem deve conseguir escrever um gancho
  novo seguindo ela.
- A sintese em markdown responde diretamente: por que esse perfil funciona.

Responda em portugues do Brasil.`;

export const FORMATO_JSON_PERFIL = `Responda com um unico objeto json, sem texto antes
ou depois, sem cerca de codigo, exatamente nesta forma:

{
  "narrativePatterns": [{ "pattern": "o padrao observado", "evidence": "o que sustenta" }],
  "ctaPatterns": [{ "cta": "o tipo de chamada", "frequency": "com que frequencia aparece" }],
  "whatFails": [{ "attempt": "o que o perfil tenta", "why": "por que nao funciona" }],
  "audiencePain": [{ "pain": "a dor identificada", "evidence": "o comentario que mostra isso" }],
  "hookFormula": "a formula de gancho deste perfil, acionavel",
  "synthesisMd": "a sintese em markdown, respondendo por que o perfil funciona"
}`;

export interface PostDestacado {
  shortcode: string;
  tipo: string;
  multiplo: number;
  tier: number | null;
  base: string;
  engajamento: number;
  publicadoEm: string | null;
  duracaoSegundos: number | null;
  legenda: string | null;
  /** Preenchido quando o video passou pelo pipeline de roteiro. */
  gancho?: string | null;
  tipoDeGancho?: string | null;
  resumoDoRoteiro?: string | null;
}

export interface ContextoPerfil {
  handle: string;
  nome: string | null;
  bio: string | null;
  categoria: string | null;
  seguidores: number | null;
  totalDePosts: number | null;
  postsColetados: number;
  distribuicaoDeFormato: unknown;
  cadencia: unknown;
  faixasDeDuracao: unknown;
  outliers: PostDestacado[];
  fracassos: PostDestacado[];
  destaques: string[];
  comentarios: string[];
}

export interface SinteseResultado {
  synthesis: import('@molde/shared').ProfileSynthesis;
  modelUsed: string;
  usage: Record<string, unknown>;
  costUsd: number;
}

function renderPost(p: PostDestacado): string {
  const partes = [
    `- ${p.shortcode} (${p.tipo}) ${p.multiplo.toFixed(2)}x da mediana` +
      (p.tier ? ` [tier ${p.tier}]` : '') +
      ` — ${p.engajamento} de engajamento em base "${p.base}"`,
  ];
  if (p.publicadoEm) partes.push(`  publicado em ${p.publicadoEm.slice(0, 10)}`);
  if (p.duracaoSegundos) partes.push(`  duracao ${p.duracaoSegundos.toFixed(0)}s`);
  if (p.gancho) partes.push(`  GANCHO (${p.tipoDeGancho ?? '?'}): "${p.gancho}"`);
  if (p.resumoDoRoteiro) partes.push(`  roteiro: ${p.resumoDoRoteiro}`);
  if (p.legenda) partes.push(`  legenda: ${p.legenda.slice(0, 300).replace(/\n/g, ' ')}`);
  return partes.join('\n');
}

export function montarContextoPerfil(ctx: ContextoPerfil): string {
  const blocos: string[] = [
    `PERFIL: @${ctx.handle}${ctx.nome ? ` (${ctx.nome})` : ''}`,
    ctx.categoria ? `Categoria declarada: ${ctx.categoria}` : '',
    ctx.bio ? `Bio: ${ctx.bio}` : '',
    `Seguidores: ${ctx.seguidores ?? 'desconhecido'}`,
    `Publicacoes no total: ${ctx.totalDePosts ?? 'desconhecido'} (coletamos ${ctx.postsColetados})`,
    '',
    'DISTRIBUICAO DE FORMATO (contagem, fracao e desempenho mediano por formato):',
    JSON.stringify(ctx.distribuicaoDeFormato, null, 2),
    '',
    'CADENCIA (dias e horarios ja no fuso de Sao Paulo):',
    JSON.stringify(ctx.cadencia, null, 2),
    '',
    'DURACAO CRUZADA COM PERFORMANCE:',
    JSON.stringify(ctx.faixasDeDuracao, null, 2),
    '',
    `OS QUE EXPLODIRAM (${ctx.outliers.length}) — a mediana e movel, dos posts vizinhos no tempo:`,
    ctx.outliers.map(renderPost).join('\n') || '(nenhum)',
    '',
    `OS QUE MORRERAM (${ctx.fracassos.length}):`,
    ctx.fracassos.map(renderPost).join('\n') || '(nenhum)',
  ];

  if (ctx.destaques.length > 0) {
    blocos.push('', `DESTAQUES FIXADOS: ${ctx.destaques.join(', ')}`);
  }

  if (ctx.comentarios.length > 0) {
    blocos.push(
      '',
      `COMENTARIOS DOS POSTS QUE EXPLODIRAM (${ctx.comentarios.length} amostras, sem identificacao de autor):`,
      ctx.comentarios.map((c) => `- ${c.slice(0, 200).replace(/\n/g, ' ')}`).join('\n'),
    );
  }

  return blocos.filter((b) => b !== '').join('\n');
}
