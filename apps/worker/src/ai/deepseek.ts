import type { z } from 'zod';
import { analysisProviders } from '@molde/config';
import { profileSynthesisSchema, structuredScriptSchema } from '@molde/shared';
import { requireEnv } from '../env';
import { chamarApi } from './http';
import {
  FORMATO_JSON,
  FORMATO_JSON_PERFIL,
  SISTEMA,
  SISTEMA_PERFIL,
  montarContexto,
  type ContextoPerfil,
  type ContextoVideo,
  type EstruturaResultado,
  type SinteseResultado,
  montarContextoPerfil,
} from './prompt';

/**
 * Este arquivo fala SEMPRE pelo seu proprio provedor, nunca por
 * `models.analysis`. E o que permite o ai/index.ts cair para ca quando o
 * provedor escolhido esta fora do ar: aqui o modelo e o preco sao os do
 * DeepSeek, aconteca o que acontecer la fora.
 */
const PERFIL = analysisProviders.deepseek;

/**
 * Estruturacao do roteiro via DeepSeek.
 *
 * A API e compativel com o formato da OpenAI, entao fetch direto basta.
 *
 * Duas particularidades do provedor moldam este arquivo:
 *
 * 1. Nao existe json_schema, so `json_object`. A validacao contra o schema e
 *    feita aqui, na aplicacao, com uma segunda tentativa levando o erro de volta
 *    ao modelo quando a primeira sai fora do formato.
 * 2. Cada imagem e comprimida para no maximo 384 tokens. Texto pequeno na tela
 *    pode nao sobreviver a essa compressao — se a leitura de tela vier fraca,
 *    e aqui que se olha primeiro.
 */
const ENDPOINT = 'https://api.deepseek.com/chat/completions';

interface MensagemDeepSeek {
  role: 'system' | 'user' | 'assistant';
  content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
}

interface RespostaDeepSeek {
  choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

async function chamar(mensagens: MensagemDeepSeek[]): Promise<RespostaDeepSeek> {
  const apiKey = requireEnv('DEEPSEEK_API_KEY');

  const response = await chamarApi(ENDPOINT, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: PERFIL.model,
      max_tokens: PERFIL.maxTokens,
      messages: mensagens,
      response_format: { type: 'json_object' },
      temperature: 0.3,
    }),
  }, 'DeepSeek');

  if (!response.ok) {
    const detalhe = await response.text().catch(() => '');

    // 402 significa conta sem saldo. Dizer so o numero deixa a pessoa sem saber
    // o que fazer — e a saida aqui nao e obvia.
    if (response.status === 402) {
      throw new Error(
        'A conta do DeepSeek esta sem saldo. Ou adicione credito em ' +
          'platform.deepseek.com, ou troque o provedor em packages/config ' +
          '(models.analysis) para `analysisProviders.groq`, que e gratuito.',
      );
    }
    if (response.status === 401) {
      throw new Error('DeepSeek recusou a chave (HTTP 401). Confira o secret DEEPSEEK_API_KEY.');
    }

    throw new Error(`DeepSeek recusou (HTTP ${response.status}): ${detalhe.slice(0, 400)}`);
  }

  return (await response.json()) as RespostaDeepSeek;
}

/** Tira cerca de codigo, que o modelo as vezes coloca mesmo em modo json. */
function limpar(texto: string): string {
  return texto
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
}

type Bloco = { type: string; text?: string; image_url?: { url: string } };

/**
 * Nucleo generico: manda blocos (texto e imagem), exige json, valida contra o
 * schema, e da UMA segunda chance levando o erro de volta ao modelo.
 *
 * Sem json_schema no provedor, e esta funcao que garante o formato — e ela vale
 * tanto para o roteiro quanto para a sintese do perfil.
 */
async function pedirJson<T>(params: {
  sistema: string;
  blocos: Bloco[];
  schema: z.ZodType<T>;
  imagensEnviadas: number;
}): Promise<{ dado: T; entrada: number; saida: number; tentativas: number }> {
  const mensagens: MensagemDeepSeek[] = [
    { role: 'system', content: params.sistema },
    { role: 'user', content: params.blocos },
  ];

  let entrada = 0;
  let saida = 0;

  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    const resposta = await chamar(mensagens);
    entrada += resposta.usage?.prompt_tokens ?? 0;
    saida += resposta.usage?.completion_tokens ?? 0;

    const bruto = resposta.choices?.[0]?.message?.content ?? '';

    // Resposta vazia e uma falha conhecida do modo json do DeepSeek.
    if (!bruto.trim()) {
      if (tentativa === 2) throw new Error('DeepSeek devolveu resposta vazia duas vezes.');
      mensagens.push({ role: 'assistant', content: '' });
      mensagens.push({
        role: 'user',
        content: 'Sua resposta veio vazia. Responda apenas com o objeto json pedido.',
      });
      continue;
    }

    let candidato: unknown;
    try {
      candidato = JSON.parse(limpar(bruto));
    } catch (erro) {
      if (tentativa === 2) {
        throw new Error(`DeepSeek nao devolveu json valido: ${(erro as Error).message}`);
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

    if (tentativa === 2) {
      throw new Error(`DeepSeek devolveu json fora do formato: ${problemas}`);
    }

    mensagens.push({ role: 'assistant', content: bruto.slice(0, 2000) });
    mensagens.push({
      role: 'user',
      content: `O json nao bate com o formato. Problemas: ${problemas}. Corrija e responda apenas com o objeto json.`,
    });
  }

  throw new Error('DeepSeek nao produziu resposta valida.');
}

function custoDe(entrada: number, saida: number): number {
  const total =
    (entrada / 1_000_000) * PERFIL.usdPerMillionInput +
    (saida / 1_000_000) * PERFIL.usdPerMillionOutput;
  return Number(total.toFixed(6));
}

export async function estruturarRoteiro(ctx: ContextoVideo): Promise<EstruturaResultado> {
  // As imagens vao como data URL, o caminho documentado para arquivo local.
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
    imagensEnviadas: ctx.frames.length,
  });

  return {
    script: dado,
    modelUsed: PERFIL.model,
    usage: {
      input_tokens: entrada,
      output_tokens: saida,
      frames_enviados: ctx.frames.length,
      tentativas,
    },
    costUsd: custoDe(entrada, saida),
  };
}

export async function sintetizarPerfil(ctx: ContextoPerfil): Promise<SinteseResultado> {
  const { dado, entrada, saida, tentativas } = await pedirJson({
    sistema: SISTEMA_PERFIL,
    blocos: [
      {
        type: 'text',
        text: `${montarContextoPerfil(ctx)}\n\n${FORMATO_JSON_PERFIL}`,
      },
    ],
    schema: profileSynthesisSchema,
    imagensEnviadas: 0,
  });

  return {
    synthesis: dado,
    modelUsed: PERFIL.model,
    usage: { input_tokens: entrada, output_tokens: saida, tentativas },
    costUsd: custoDe(entrada, saida),
  };
}
