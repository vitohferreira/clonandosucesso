import type { z } from 'zod';
import { models } from '@molde/config';
import { profileSynthesisSchema, structuredScriptSchema } from '@molde/shared';
import { requireEnv } from '../env';
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

type Bloco = { type: string; text?: string; image_url?: { url: string } };

interface Mensagem {
  role: 'system' | 'user' | 'assistant';
  content: string | Bloco[];
}

interface Resposta {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

async function chamar(mensagens: Mensagem[]): Promise<Resposta> {
  const apiKey = requireEnv('GROQ_API_KEY');

  const response = await chamarApi(ENDPOINT, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: models.analysis.model,
      max_tokens: models.analysis.maxTokens,
      messages: mensagens,
      response_format: { type: 'json_object' },
      temperature: 0.3,
    }),
  }, 'Groq');

  if (!response.ok) {
    const detalhe = await response.text().catch(() => '');

    if (response.status === 429) {
      throw new Error(
        'Groq recusou por limite de uso (HTTP 429). A camada gratuita tem teto por minuto — ' +
          'espere um pouco e rode de novo.',
      );
    }
    if (response.status === 401) {
      throw new Error('Groq recusou a chave (HTTP 401). Confira o secret GROQ_API_KEY.');
    }

    throw new Error(`Groq recusou (HTTP ${response.status}): ${detalhe.slice(0, 400)}`);
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
}): Promise<{ dado: T; entrada: number; saida: number; tentativas: number }> {
  const mensagens: Mensagem[] = [
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
    (entrada / 1_000_000) * models.analysis.usdPerMillionInput +
    (saida / 1_000_000) * models.analysis.usdPerMillionOutput;
  return Number(total.toFixed(6));
}

export async function estruturarRoteiro(ctx: ContextoVideo): Promise<EstruturaResultado> {
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
  });

  return {
    script: dado,
    modelUsed: models.analysis.model,
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
    blocos: [{ type: 'text', text: `${montarContextoPerfil(ctx)}\n\n${FORMATO_JSON_PERFIL}` }],
    schema: profileSynthesisSchema,
  });

  return {
    synthesis: dado,
    modelUsed: models.analysis.model,
    usage: { input_tokens: entrada, output_tokens: saida, tentativas },
    costUsd: custoDe(entrada, saida),
  };
}
