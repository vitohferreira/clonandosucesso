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
 * Gemini, aconteca o que acontecer la fora.
 */
const PERFIL = analysisProviders.gemini;

/**
 * Analise pelo Gemini (Google AI Studio).
 *
 * E a melhor opcao gratuita para esta tarefa: visao nativa, sem teto baixo de
 * imagens por requisicao, e `responseMimeType: application/json` que ja obriga
 * a saida a ser json — o que reduz muito a chance de precisar da rodada de
 * correcao.
 *
 * A camada gratuita vale enquanto o faturamento estiver DESLIGADO no projeto do
 * Google. Ligar cobranca faz a cota gratuita desaparecer.
 */
const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * O Google renomeia os modelos com frequencia — 2.5 Flash virou legado, e a
 * familia 3.x apareceu depois. Um nome chumbado no codigo quebra sozinho a cada
 * poucos meses, entao o nome da config e apenas a PREFERENCIA: se ele nao
 * existir mais, descobrimos o substituto perguntando a propria API.
 */
let modeloResolvido: string | null = null;

interface ModeloListado {
  name?: string;
  supportedGenerationMethods?: string[];
}

/** Quanto este modelo serve para a nossa tarefa. Maior e melhor. */
function pontuar(nome: string): number {
  if (!nome.includes('gemini')) return -1;

  let pontos = 0;

  // Flash e o que a camada gratuita cobre.
  if (nome.includes('flash')) pontos += 100;
  // Lite e mais fraco; serve, mas so se nao houver Flash normal.
  if (nome.includes('lite')) pontos -= 40;
  // Preview e experimental tendem a ter cota menor e sumir sem aviso.
  if (/preview|exp\b/.test(nome)) pontos -= 20;
  // Pro saiu da camada gratuita em 2026.
  if (nome.includes('pro')) pontos -= 60;

  // Versao mais nova ganha: "gemini-3.7-flash" vence "gemini-3-flash".
  const versao = nome.match(/gemini-(\d+(?:\.\d+)?)/)?.[1];
  if (versao) pontos += Number(versao) * 10;

  return pontos;
}

async function descobrirModelo(apiKey: string): Promise<string> {
  const r = await chamarApi(
    `${BASE}?key=${encodeURIComponent(apiKey)}&pageSize=200`,
    { method: 'GET' },
    'Gemini',
  );
  if (!r.ok) {
    throw new Error(
      `Nao consegui listar os modelos do Gemini (HTTP ${r.status}). Confira a GEMINI_API_KEY.`,
    );
  }

  const dados = (await r.json()) as { models?: ModeloListado[] };

  const candidatos = (dados.models ?? [])
    .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
    .map((m) => (m.name ?? '').replace(/^models\//, ''))
    .filter((nome) => nome.length > 0)
    .map((nome) => ({ nome, pontos: pontuar(nome) }))
    .filter((c) => c.pontos > 0)
    .sort((a, b) => b.pontos - a.pontos);

  const melhor = candidatos[0]?.nome;
  if (!melhor) {
    throw new Error(
      'A sua chave do Gemini nao da acesso a nenhum modelo com generateContent. ' +
        'Gere outra em aistudio.google.com/apikey.',
    );
  }

  return melhor;
}

interface Parte {
  text?: string;
  inline_data?: { mime_type: string; data: string };
}

interface Resposta {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  error?: { message?: string; status?: string; code?: number };
}

async function chamar(sistema: string, partes: Parte[], log?: Logger): Promise<Resposta> {
  const apiKey = requireEnv('GEMINI_API_KEY');
  const modelo = modeloResolvido ?? PERFIL.model;
  const url = `${BASE}/${modelo}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const response = await chamarApi(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: sistema }] },
      contents: [{ role: 'user', parts: partes }],
      generationConfig: {
        maxOutputTokens: PERFIL.maxTokens,
        temperature: 0.3,
        // Obriga a saida a ser json — sem isto o modelo tende a embrulhar em prosa.
        responseMimeType: 'application/json',
      },
    }),
  }, 'Gemini');

  // Nao usamos `.json()` direto: quando o Google devolve 5xx, a resposta as
  // vezes vem em HTML de proxy, e ai o `.json()` estoura um SyntaxError cru que
  // esconde por completo o que aconteceu de verdade.
  const texto = await response.text().catch(() => '');
  let corpo: Resposta;
  try {
    corpo = JSON.parse(texto) as Resposta;
  } catch {
    throw new Error(
      `Gemini respondeu algo que nao e json (HTTP ${response.status}): ${texto.slice(0, 300) || '<corpo vazio>'}`,
    );
  }

  if (!response.ok || corpo.error) {
    const msg = corpo.error?.message ?? `HTTP ${response.status}`;

    // Modelo renomeado ou aposentado: perguntamos a API qual existe agora e
    // tentamos de novo, em vez de exigir que alguem edite a config.
    if (response.status === 404 && !modeloResolvido) {
      const substituto = await descobrirModelo(apiKey);
      modeloResolvido = substituto;
      log?.warn('modelo do Gemini nao existe mais; usando o substituto encontrado', {
        configurado: PERFIL.model,
        usando: substituto,
      });
      return chamar(sistema, partes, log);
    }

    if (response.status === 404) {
      throw new Error(
        `O Gemini nao conhece o modelo "${modelo}", nem o substituto que encontrei. ` +
          'Confira a chave em aistudio.google.com/apikey.',
      );
    }
    if (response.status === 429) {
      throw new Error(
        'Gemini recusou por limite de uso (HTTP 429). A camada gratuita tem teto diario — ' +
          'espere e tente de novo, ou troque de provedor em packages/config.',
      );
    }
    if (response.status === 400 && /API key/i.test(msg)) {
      throw new Error('Gemini recusou a chave. Confira o secret GEMINI_API_KEY.');
    }

    throw new Error(`Gemini recusou: ${msg}`);
  }

  return corpo;
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
  partes: Parte[];
  schema: z.ZodType<T>;
  log?: Logger;
}): Promise<{ dado: T; entrada: number; saida: number; tentativas: number }> {
  let partes = params.partes;
  let entrada = 0;
  let saida = 0;

  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    const resposta = await chamar(params.sistema, partes, params.log);

    entrada += resposta.usageMetadata?.promptTokenCount ?? 0;
    saida += resposta.usageMetadata?.candidatesTokenCount ?? 0;

    const bruto = resposta.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';

    if (!bruto.trim()) {
      const motivo = resposta.candidates?.[0]?.finishReason ?? 'desconhecido';
      throw new Error(`Gemini devolveu resposta vazia (finishReason: ${motivo}).`);
    }

    let candidato: unknown;
    try {
      candidato = JSON.parse(limpar(bruto));
    } catch (erro) {
      if (tentativa === 2) {
        throw new Error(`Gemini nao devolveu json valido: ${(erro as Error).message}`);
      }
      partes = [
        ...params.partes,
        { text: `Sua resposta anterior nao era json valido:\n${bruto.slice(0, 1500)}` },
        { text: 'Responda APENAS com o objeto json pedido.' },
      ];
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

    if (tentativa === 2) throw new Error(`Gemini devolveu json fora do formato: ${problemas}`);

    partes = [
      ...params.partes,
      { text: `Sua resposta anterior nao bateu com o formato. Problemas: ${problemas}` },
      { text: 'Corrija e responda APENAS com o objeto json pedido.' },
    ];
  }

  throw new Error('Gemini nao produziu resposta valida.');
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
  const partes: Parte[] = [{ text: montarContexto(ctx) }];

  for (const frame of ctx.frames) {
    partes.push({ text: `--- frame aos ${frame.seconds.toFixed(1)}s ---` });
    partes.push({ inline_data: { mime_type: 'image/jpeg', data: frame.base64 } });
  }

  partes.push({
    text: `Monte o roteiro anotado deste video seguindo as regras.\n\n${FORMATO_JSON}`,
  });

  const { dado, entrada, saida, tentativas } = await pedirJson({
    sistema: SISTEMA,
    partes,
    schema: structuredScriptSchema,
    log,
  });

  return {
    script: dado,
    modelUsed: modeloResolvido ?? PERFIL.model,
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
    partes: [{ text: `${montarContextoPerfil(ctx)}\n\n${FORMATO_JSON_PERFIL}` }],
    schema: profileSynthesisSchema,
    log,
  });

  return {
    synthesis: dado,
    modelUsed: modeloResolvido ?? PERFIL.model,
    usage: { input_tokens: entrada, output_tokens: saida, tentativas },
    costUsd: custoDe(entrada, saida),
  };
}
