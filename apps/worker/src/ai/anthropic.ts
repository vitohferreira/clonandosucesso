import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { analysisProviders } from '@molde/config';
import { profileSynthesisSchema, structuredScriptSchema } from '@molde/shared';
import {
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
 * Anthropic, aconteca o que acontecer la fora.
 */
const PERFIL = analysisProviders.anthropic;

/**
 * Estruturacao do roteiro via Anthropic.
 *
 * Diferente do DeepSeek, aqui o formato e garantido pelo proprio modelo
 * (`output_config.format` com o schema Zod), entao nao existe rodada de correcao.
 * Quem escolhe o provedor e o ai/index.ts.
 */

let cliente: Anthropic | null = null;
function client(): Anthropic {
  if (!cliente) cliente = new Anthropic();
  return cliente;
}

export async function estruturarRoteiro(ctx: ContextoVideo): Promise<EstruturaResultado> {
  // Cada imagem vem precedida do seu instante: sem isso o modelo nao sabe a
  // que altura do video aquele quadro pertence.
  const conteudo: Anthropic.ContentBlockParam[] = [
    { type: 'text', text: montarContexto(ctx) },
  ];

  for (const frame of ctx.frames) {
    conteudo.push({ type: 'text', text: `--- frame aos ${frame.seconds.toFixed(1)}s ---` });
    conteudo.push({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: frame.base64 },
    });
  }

  conteudo.push({
    type: 'text',
    text: 'Monte o roteiro anotado deste video seguindo as regras.',
  });

  const response = await client().messages.parse({
    model: PERFIL.model,
    max_tokens: PERFIL.maxTokens,
    system: SISTEMA,
    messages: [{ role: 'user', content: conteudo }],
    output_config: { format: zodOutputFormat(structuredScriptSchema) },
  });

  if (!response.parsed_output) {
    throw new Error(
      `O modelo nao devolveu um roteiro valido (stop_reason: ${response.stop_reason}).`,
    );
  }

  const entrada = response.usage.input_tokens ?? 0;
  const saida = response.usage.output_tokens ?? 0;
  const custo =
    (entrada / 1_000_000) * PERFIL.usdPerMillionInput +
    (saida / 1_000_000) * PERFIL.usdPerMillionOutput;

  return {
    script: response.parsed_output,
    modelUsed: PERFIL.model,
    usage: {
      input_tokens: entrada,
      output_tokens: saida,
      cache_read_input_tokens: response.usage.cache_read_input_tokens ?? 0,
      frames_enviados: ctx.frames.length,
    },
    costUsd: Number(custo.toFixed(6)),
  };
}

/**
 * Sintese do perfil. So texto — os frames ja foram lidos na fase de roteiro, e
 * o que chega aqui e o resultado daquela leitura.
 */
export async function sintetizarPerfil(ctx: ContextoPerfil): Promise<SinteseResultado> {
  const response = await client().messages.parse({
    model: PERFIL.model,
    max_tokens: PERFIL.maxTokens,
    system: SISTEMA_PERFIL,
    messages: [{ role: 'user', content: montarContextoPerfil(ctx) }],
    output_config: { format: zodOutputFormat(profileSynthesisSchema) },
  });

  if (!response.parsed_output) {
    throw new Error(
      `O modelo nao devolveu a sintese (stop_reason: ${response.stop_reason}).`,
    );
  }

  const entrada = response.usage.input_tokens ?? 0;
  const saida = response.usage.output_tokens ?? 0;
  const custo =
    (entrada / 1_000_000) * PERFIL.usdPerMillionInput +
    (saida / 1_000_000) * PERFIL.usdPerMillionOutput;

  return {
    synthesis: response.parsed_output,
    modelUsed: PERFIL.model,
    usage: { input_tokens: entrada, output_tokens: saida },
    costUsd: Number(custo.toFixed(6)),
  };
}
