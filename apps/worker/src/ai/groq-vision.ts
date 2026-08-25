import type { z } from 'zod';
import { analysisProviders } from '@molde/config';
import { profileSynthesisSchema, structuredScriptSchema } from '@molde/shared';
import { requireEnv } from '../env';
import type { Logger } from '../logger';
import { chamarApi } from './http';
import {
  FORMATO_JSON,
  FORMATO_JSON_PERFIL,
  SISTEMA,
  SISTEMA_PERFIL,
  montarContexto,
  montarContextoPerfil,
  type ContextoPerfil,
  type ContextoVideo,
  type EstruturaResultado,
  type SinteseResultado,
} from './prompt';

/**
 * Este arquivo fala SEMPRE pelo seu proprio provedor, nunca por
 * `models.analysis`. E o que permite o ai/index.ts cair para ca quando o
 * provedor escolhido esta fora do ar: aqui o modelo e o preco sao os do
 * Groq, aconteca o que acontecer la fora.
 */
const PERFIL = analysisProviders.groq;

/**
 * Analise pelo Groq, com modelo de visao.
 *
 * E a opcao GRATUITA: a mesma chave que ja transcreve o audio serve aqui, entao
 * nao ha conta nova nem cartao. O modelo e menos preciso que o Claude para ler
 * texto pequeno na tela, e aceita menos imagens por requisicao — por isso
 * `maxImages` e declarado por provedor, e o pipeline amostra menos quadros.
 *
 * Como todo provedor sem json_schema, o formato e garantido aqui, validando
 * contra o schema e dando uma segunda chance com o erro de volta ao modelo.
 */
const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const LISTA = 'https://api.groq.com/openai/v1/models';

/**
 * O Groq aposenta nome de modelo com frequencia — e mais rapido que o Google.
 * Chumbar um nome aqui e garantir que este arquivo quebre sozinho em alguns
 * meses, exatamente como quebrou. Entao o nome da config e so a PREFERENCIA: se
 * ele nao existir mais, perguntamos a propria API o que a sua chave alcanca.
 */
let ranking: string[] | null = null;
let escolhido = 0;

const MAX_TROCAS = 3;

function modeloAtual(): string {
  return ranking?.[escolhido] ?? PERFIL.model;
}

/**
 * Quanto este modelo serve para a nossa tarefa. Maior e melhor, e negativo
 * significa "nao serve".
 *
 * O detalhe que manda aqui: precisamos de um modelo que ENXERGUE IMAGEM. A
 * lista do Groq nao marca isso em lugar nenhum, entao a familia do nome e a
 * unica pista — e por isso um nome sem sinal de visao e descartado, em vez de
 * ser aceito e falhar depois, no meio do job, com um erro obscuro.
 */
function pontuar(id: string): number {
  const n = id.toLowerCase();

  // Transcricao, moderacao, voz, embeddings: nada disso le imagem.
  if (/whisper|guard|tts|embed|reranker/.test(n)) return -1;

  let pontos = 0;
  if (n.includes('scout')) pontos += 100;
  if (n.includes('maverick')) pontos += 90;
  if (/vision|multimodal|omni|\bvl\b/.test(n)) pontos += 80;

  // Sem nenhum sinal de visao nao arriscamos: mandar imagem para um modelo so
  // de texto falha la na frente, depois de ja ter gasto transcricao e quadros.
  if (pontos === 0) return -1;

  // Versao mais nova ganha: llama-5 vence llama-4.
  const versao = n.match(/llama-?(\d+)/)?.[1];
  if (versao) pontos += Number(versao) * 10;

  // Preview some sem aviso e costuma ter cota menor.
  if (/preview|exp\b/.test(n)) pontos -= 15;

  return pontos;
}

async function listarModelos(apiKey: string): Promise<string[]> {
  const r = await chamarApi(LISTA, {
    method: 'GET',
    headers: { authorization: `Bearer ${apiKey}` },
  }, 'Groq');

  if (!r.ok) {
    throw new Error(
      `Nao consegui listar os modelos do Groq (HTTP ${r.status}). Confira a GROQ_API_KEY.`,
    );
  }

  const dados = (await r.json()) as { data?: Array<{ id?: string }> };

  const candidatos = (dados.data ?? [])
    .map((m) => m.id ?? '')
    .filter((id) => id.length > 0)
    .map((id) => ({ id, pontos: pontuar(id) }))
    .filter((c) => c.pontos > 0)
    .sort((a, b) => b.pontos - a.pontos);

  if (candidatos.length === 0) {
    const todos = (dados.data ?? []).map((m) => m.id).filter(Boolean).join(', ');
    throw new Error(
      'A sua chave do Groq nao alcanca nenhum modelo que enxergue imagem. ' +
        `Modelos disponiveis: ${todos.slice(0, 300) || 'nenhum'}.`,
    );
  }

  return candidatos.map((c) => c.id);
}

/** Avanca para o proximo modelo da lista. null = acabaram. */
async function proximoModelo(apiKey: string): Promise<string | null> {
  if (!ranking) {
    const encontrados = await listarModelos(apiKey);
    ranking = [PERFIL.model, ...encontrados.filter((id) => id !== PERFIL.model)];
    escolhido = 0;
  }

  if (escolhido + 1 >= ranking.length) return null;
  escolhido += 1;
  return ranking[escolhido] ?? null;
}

type Bloco = { type: string; text?: string; image_url?: { url: string } };

interface Mensagem {
  role: 'system' | 'user' | 'assistant';
  content: string | Bloco[];
}

interface Resposta {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

async function chamar(mensagens: Mensagem[], log?: Logger, trocas = 0): Promise<Resposta> {
  const apiKey = requireEnv('GROQ_API_KEY');
  const modelo = modeloAtual();

  const response = await chamarApi(ENDPOINT, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: modelo,
      max_tokens: PERFIL.maxTokens,
      messages: mensagens,
      response_format: { type: 'json_object' },
      temperature: 0.3,
    }),
  }, 'Groq', { tentativas: 2 });

  if (!response.ok) {
    const detalhe = await response.text().catch(() => '');

    if (response.status === 401) {
      throw new Error('Groq recusou a chave (HTTP 401). Confira o secret GROQ_API_KEY.');
    }

    // Nome aposentado ou modelo lotado: os dois se resolvem trocando de modelo,
    // nao insistindo. O chamarApi ja insistiu neste antes de chegar aqui.
    const sumiu = response.status === 404 || /model_not_found|does not exist/i.test(detalhe);
    const lotado =
      response.status === 429 ||
      response.status === 503 ||
      /over capacity|high demand|overload/i.test(detalhe);

    if ((sumiu || lotado) && trocas < MAX_TROCAS) {
      const substituto = await proximoModelo(apiKey);
      if (substituto) {
        log?.warn(sumiu ? 'modelo do Groq nao existe mais' : 'modelo do Groq sobrecarregado', {
          era: modelo,
          usando: substituto,
        });
        return chamar(mensagens, log, trocas + 1);
      }
    }

    if (sumiu) {
      throw new Error(
        `O Groq nao conhece o modelo "${modelo}", nem os substitutos que encontrei. ` +
          'Confira a chave em console.groq.com/keys.',
      );
    }
    if (lotado) {
      throw new Error(
        'Groq recusou por limite de uso. A camada gratuita tem teto por minuto — ' +
          `tentei ${trocas + 1} modelo(s). Ultimo: ${modelo}.`,
      );
    }

    throw new Error(`Groq recusou (${modelo}, HTTP ${response.status}): ${detalhe.slice(0, 400)}`);
  }

  return (await response.json()) as Resposta;
}

function limpar(texto: string): string {
  return texto
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
}

async function pedirJson<T>(params: {
  sistema: string;
  blocos: Bloco[];
  schema: z.ZodType<T>;
  log?: Logger;
}): Promise<{ dado: T; entrada: number; saida: number; tentativas: number }> {
  const mensagens: Mensagem[] = [
    { role: 'system', content: params.sistema },
    { role: 'user', content: params.blocos },
  ];

  let entrada = 0;
  let saida = 0;

  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    const resposta = await chamar(mensagens, params.log);
    entrada += resposta.usage?.prompt_tokens ?? 0;
    saida += resposta.usage?.completion_tokens ?? 0;

    const bruto = resposta.choices?.[0]?.message?.content ?? '';

    let candidato: unknown;
    try {
      candidato = JSON.parse(limpar(bruto));
    } catch (erro) {
      if (tentativa === 2) {
        throw new Error(`Groq nao devolveu json valido: ${(erro as Error).message}`);
      }
      mensagens.push({ role: 'assistant', content: bruto.slice(0, 2000) });
      mensagens.push({
        role: 'user',
        content: 'Isso nao e json valido. Responda apenas com o objeto json, sem mais nada.',
      });
      continue;
    }

    const validado = params.schema.safeParse(candidato);
    if (validado.success) {
      return { dado: validado.data, entrada, saida, tentativas: tentativa };
    }

    const problemas = validado.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');

    if (tentativa === 2) throw new Error(`Groq devolveu json fora do formato: ${problemas}`);

    mensagens.push({ role: 'assistant', content: bruto.slice(0, 2000) });
    mensagens.push({
      role: 'user',
      content: `O json nao bate com o formato. Problemas: ${problemas}. Corrija e responda apenas com o objeto json.`,
    });
  }

  throw new Error('Groq nao produziu resposta valida.');
}

function custoDe(entrada: number, saida: number): number {
  const total =
    (entrada / 1_000_000) * PERFIL.usdPerMillionInput +
    (saida / 1_000_000) * PERFIL.usdPerMillionOutput;
  return Number(total.toFixed(6));
}

export async function estruturarRoteiro(
  ctx: ContextoVideo,
  log?: Logger,
): Promise<EstruturaResultado> {
  const blocos: Bloco[] = [{ type: 'text', text: montarContexto(ctx) }];

  for (const frame of ctx.frames) {
    blocos.push({ type: 'text', text: `--- frame aos ${frame.seconds.toFixed(1)}s ---` });
    blocos.push({
      type: 'image_url',
      image_url: { url: `data:image/jpeg;base64,${frame.base64}` },
    });
  }

  blocos.push({
    type: 'text',
    text: `Monte o roteiro anotado deste video seguindo as regras.\n\n${FORMATO_JSON}`,
  });

  const { dado, entrada, saida, tentativas } = await pedirJson({
    sistema: SISTEMA,
    blocos,
    schema: structuredScriptSchema,
    log,
  });

  return {
    script: dado,
    modelUsed: modeloAtual(),
    usage: {
      input_tokens: entrada,
      output_tokens: saida,
      frames_enviados: ctx.frames.length,
      tentativas,
    },
    costUsd: custoDe(entrada, saida),
  };
}

export async function sintetizarPerfil(
  ctx: ContextoPerfil,
  log?: Logger,
): Promise<SinteseResultado> {
  const { dado, entrada, saida, tentativas } = await pedirJson({
    sistema: SISTEMA_PERFIL,
    blocos: [{ type: 'text', text: `${montarContextoPerfil(ctx)}\n\n${FORMATO_JSON_PERFIL}` }],
    schema: profileSynthesisSchema,
    log,
  });

  return {
    synthesis: dado,
    modelUsed: modeloAtual(),
    usage: { input_tokens: entrada, output_tokens: saida, tentativas },
    costUsd: custoDe(entrada, saida),
  };
}
