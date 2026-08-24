import { models } from '@molde/config';
import { structuredScriptSchema } from '@molde/shared';
import { requireEnv } from '../env';
import {
  FORMATO_JSON,
  SISTEMA,
  montarContexto,
  type ContextoVideo,
  type EstruturaResultado,
} from './prompt';

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

  const response = await fetch(ENDPOINT, {
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
  });

  if (!response.ok) {
    const detalhe = await response.text().catch(() => '');
    throw new Error(`DeepSeek recusou (HTTP ${response.status}): ${detalhe.slice(0, 500)}`);
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

export async function estruturarRoteiro(ctx: ContextoVideo): Promise<EstruturaResultado> {
  // As imagens vao como data URL, o caminho documentado para arquivo local.
  const conteudo: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
    { type: 'text', text: montarContexto(ctx) },
  ];

  for (const frame of ctx.frames) {
    conteudo.push({ type: 'text', text: `--- frame aos ${frame.seconds.toFixed(1)}s ---` });
    conteudo.push({
      type: 'image_url',
      image_url: { url: `data:image/jpeg;base64,${frame.base64}` },
    });
  }

  conteudo.push({
    type: 'text',
    text: `Monte o roteiro anotado deste video seguindo as regras.\n\n${FORMATO_JSON}`,
  });

  const mensagens: MensagemDeepSeek[] = [
    { role: 'system', content: SISTEMA },
    { role: 'user', content: conteudo },
  ];

  let entrada = 0;
  let saida = 0;

  // Duas tentativas: a segunda leva o erro de validacao de volta ao modelo.
  // Sem json_schema, e isto que garante o formato.
  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    const resposta = await chamar(mensagens);

    entrada += resposta.usage?.prompt_tokens ?? 0;
    saida += resposta.usage?.completion_tokens ?? 0;

    const bruto = resposta.choices?.[0]?.message?.content ?? '';

    // Devolver conteudo vazio e uma falha conhecida do modo json do DeepSeek.
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

    const validado = structuredScriptSchema.safeParse(candidato);
    if (validado.success) {
      const custo =
        (entrada / 1_000_000) * models.analysis.usdPerMillionInput +
        (saida / 1_000_000) * models.analysis.usdPerMillionOutput;

      return {
        script: validado.data,
        modelUsed: models.analysis.model,
        usage: {
          input_tokens: entrada,
          output_tokens: saida,
          frames_enviados: ctx.frames.length,
          tentativas: tentativa,
        },
        costUsd: Number(custo.toFixed(6)),
      };
    }

    if (tentativa === 2) {
      throw new Error(
        `DeepSeek devolveu json fora do formato: ${validado.error.issues
          .slice(0, 5)
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ')}`,
      );
    }

    mensagens.push({ role: 'assistant', content: bruto.slice(0, 2000) });
    mensagens.push({
      role: 'user',
      content: `O json nao bate com o formato. Problemas: ${validado.error.issues
        .slice(0, 5)
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}. Corrija e responda apenas com o objeto json.`,
    });
  }

  throw new Error('DeepSeek nao produziu um roteiro valido.');
}
