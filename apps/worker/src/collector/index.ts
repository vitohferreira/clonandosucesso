import { collection } from '@molde/config';
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
      return coletorOficial;
    case 'scraper':
      return coletorNavegador;
    default: {
      const inalcancavel: never = collection.source;
      throw new Error(`Fonte de coleta desconhecida: ${String(inalcancavel)}`);
    }
  }
}
