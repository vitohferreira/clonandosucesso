import { collection, escopo } from '@molde/config';
import { coletorOficial } from './graph';
import { coletorNavegador } from './scraper';
import type { Coletor } from './types';

export type { Coletor, Comentario, ResultadoColeta } from './types';

/**
 * Qual fonte de dados esta ativa. Escolhida em `collection.source`, no
 * packages/config — o handler do Modulo A nao sabe a diferenca.
 */
export function coletorAtivo(): Coletor {
  switch (collection.source) {
    case 'graph':
      if (!escopo.apiDoMeta) {
        throw new Error(
          'A coleta pela API oficial do Meta esta CONGELADA nesta etapa. O codigo ' +
            'continua no repositorio; para religar, mude `escopo.apiDoMeta` no ' +
            'packages/config.',
        );
      }
      return coletorOficial;
    case 'scraper':
      if (!escopo.sessaoLogada) {
        throw new Error(
          'A coleta pelo navegador com a SUA sessao esta CONGELADA nesta etapa — ' +
            'ela e a unica parte do sistema que expoe a sua conta do Instagram. ' +
            'Para religar conscientemente, mude `escopo.sessaoLogada` no packages/config.',
        );
      }
      return coletorNavegador;
    default: {
      const inalcancavel: never = collection.source;
      throw new Error(`Fonte de coleta desconhecida: ${String(inalcancavel)}`);
    }
  }
}
