import type { z } from 'zod';
import { models } from '@molde/config';
import { profileSynthesisSchema, structuredScriptSchema } from '@molde/shared';
import { requireEnv } from '../env';
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

interface Parte {
  text?: string;
  inline_data?: { mime_type: string; data: string };
}

interface Resposta {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  error?: { message?: string; status?: string; code?: number };
}

async function chamar(sistema: string, partes: Parte[]): Promise<Resposta> {
  const apiKey = requireEnv('GEMINI_API_KEY');
  const url = `${BASE}/${models.analysis.model}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: sistema }] },
      contents: [{ role: 'user', parts: partes }],
      generationConfig: {
        maxOutputTokens: models.analysis.maxTokens,
        temperature: 0.3,
        // Obriga a saida a ser json — sem isto o modelo tende a embrulhar em prosa.
        responseMimeType: 'application/json',
      },
    }),
  });

  const corpo = (await response.json()) as Resposta;

  if (!response.ok || corpo.error) {
    const msg = corpo.error?.message ?? `HTTP ${response.status}`;

    if (response.status === 404) {
      throw new Error(
        `O Gemini nao conhece o modelo "${models.analysis.model}". ` +
          'Os nomes mudam de tempos em tempos — confira o atual no Google AI Studio e ' +
          'ajuste em packages/config (analysisProviders.gemini.model).',
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
}): Promise<{ dado: T; entrada: number; saida: number; tentativas: number }> {
  let partes = params.partes;
  let entrada = 0;
  let saida = 0;

  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    const resposta = await chamar(params.sistema, partes);

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
    (entrada / 1_000_000) * models.analysis.usdPerMillionInput +
    (saida / 1_000_000) * models.analysis.usdPerMillionOutput;
  return Number(total.toFixed(6));
}

export async function estruturarRoteiro(ctx: ContextoVideo): Promise<EstruturaResultado> {
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
    partes: [{ text: `${montarContextoPerfil(ctx)}\n\n${FORMATO_JSON_PERFIL}` }],
    schema: profileSynthesisSchema,
  });

  return {
    synthesis: dado,
    modelUsed: models.analysis.model,
    usage: { input_tokens: entrada, output_tokens: saida, tentativas },
    costUsd: custoDe(entrada, saida),
  };
}
