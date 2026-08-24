import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { models } from '@molde/config';
import { structuredScriptSchema } from '@molde/shared';
import {
  SISTEMA,
  montarContexto,
  type ContextoVideo,
  type EstruturaResultado,
} from './prompt';

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
    model: models.analysis.model,
    max_tokens: models.analysis.maxTokens,
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
    (entrada / 1_000_000) * models.analysis.usdPerMillionInput +
    (saida / 1_000_000) * models.analysis.usdPerMillionOutput;

  return {
    script: response.parsed_output,
    modelUsed: models.analysis.model,
    usage: {
      input_tokens: entrada,
      output_tokens: saida,
      cache_read_input_tokens: response.usage.cache_read_input_tokens ?? 0,
      frames_enviados: ctx.frames.length,
    },
    costUsd: Number(custo.toFixed(6)),
  };
}
