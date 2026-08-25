/**
 * O que a tela diz depois de enfileirar, conforme o worker tenha ligado ou não.
 *
 * A distinção importa: "na fila" sozinho não diz se algo vai acontecer, e foi
 * exatamente essa ambiguidade que fez um trabalho ficar parado sem ninguém
 * entender por quê.
 */
export interface RespostaDeJob {
  worker?: { disparado?: boolean; motivo?: string };
}

export function mensagemDaFila(resposta: RespostaDeJob): {
  texto: string;
  bom: boolean;
} {
  if (resposta.worker?.disparado) {
    return { texto: 'Na fila, e o worker já está ligando. Leva uns 2 minutos.', bom: true };
  }

  return {
    texto:
      'Na fila. O worker não ligou sozinho — abra Actions → Worker → Run workflow no GitHub para processar.',
    bom: false,
  };
}
