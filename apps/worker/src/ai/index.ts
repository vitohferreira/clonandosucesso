import { models } from '@molde/config';
import {
  estruturarRoteiro as roteiroAnthropic,
  sintetizarPerfil as perfilAnthropic,
} from './anthropic';
import {
  estruturarRoteiro as roteiroDeepseek,
  sintetizarPerfil as perfilDeepseek,
} from './deepseek';
import type {
  ContextoPerfil,
  ContextoVideo,
  EstruturaResultado,
  SinteseResultado,
} from './prompt';

export type {
  ContextoPerfil,
  ContextoVideo,
  EstruturaResultado,
  PostDestacado,
  SinteseResultado,
} from './prompt';

/**
 * Ponto unico de entrada da analise. O handler nao sabe qual provedor esta
 * ativo — quem decide e `models.analysis` no packages/config.
 */
export async function estruturarRoteiro(ctx: ContextoVideo): Promise<EstruturaResultado> {
  switch (models.analysis.provider) {
    case 'deepseek':
      return roteiroDeepseek(ctx);
    case 'anthropic':
      return roteiroAnthropic(ctx);
    default: {
      // Se um provedor novo entrar na config sem handler, quebra aqui em vez
      // de silenciosamente usar o errado.
      const inalcancavel: never = models.analysis;
      throw new Error(`Provedor de analise sem implementacao: ${JSON.stringify(inalcancavel)}`);
    }
  }
}

/** Sintese do perfil, pelo mesmo provedor ativo. */
export async function sintetizarPerfil(ctx: ContextoPerfil): Promise<SinteseResultado> {
  switch (models.analysis.provider) {
    case 'deepseek':
      return perfilDeepseek(ctx);
    case 'anthropic':
      return perfilAnthropic(ctx);
    default: {
      const inalcancavel: never = models.analysis;
      throw new Error(`Provedor sem implementacao: ${JSON.stringify(inalcancavel)}`);
    }
  }
}
