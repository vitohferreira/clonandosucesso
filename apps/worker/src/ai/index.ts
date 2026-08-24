import { models } from '@molde/config';
import { estruturarRoteiro as viaAnthropic } from './anthropic';
import { estruturarRoteiro as viaDeepseek } from './deepseek';
import type { ContextoVideo, EstruturaResultado } from './prompt';

export type { ContextoVideo, EstruturaResultado } from './prompt';

/**
 * Ponto unico de entrada da analise. O handler nao sabe qual provedor esta
 * ativo — quem decide e `models.analysis` no packages/config.
 */
export async function estruturarRoteiro(ctx: ContextoVideo): Promise<EstruturaResultado> {
  switch (models.analysis.provider) {
    case 'deepseek':
      return viaDeepseek(ctx);
    case 'anthropic':
      return viaAnthropic(ctx);
    default: {
      // Se um provedor novo entrar na config sem handler, quebra aqui em vez
      // de silenciosamente usar o errado.
      const inalcancavel: never = models.analysis;
      throw new Error(`Provedor de analise sem implementacao: ${JSON.stringify(inalcancavel)}`);
    }
  }
}
