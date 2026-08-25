import type { Logger } from '../logger';
import type { MidiaColetada, PerfilColetado } from '../scraper/parse';

/**
 * O contrato entre "de onde vem o dado" e "o que fazemos com ele".
 *
 * Existem duas fontes possiveis, e o handler do Modulo A nao sabe qual esta
 * ativa:
 *
 *   graph    — API oficial do Instagram (Business Discovery). Risco zero para a
 *              sua conta, roda em qualquer lugar, mas so alcanca perfil
 *              profissional e publico, e nao traz texto de comentario.
 *   scraper  — navegador com a sua sessao. Alcanca tudo, mas exige maquina sua
 *              e carrega risco de bloqueio.
 *
 * Quem escolhe e `collection.source` no packages/config.
 */

export interface Comentario {
  text: string;
  likeCount: number | null;
}

export interface ResultadoColeta {
  perfil: PerfilColetado;
  midias: MidiaColetada[];
  destaques: Array<{ title: string; position: number }>;
  sugestoes: string[];

  /**
   * Abre um post para pegar o que a listagem nao deu.
   *
   * Na fonte oficial isso e gratuito e ja vem tudo; no scraper custa teto
   * diario. Por isso quem chama trata as duas como se custassem.
   */
  abrirPost(shortcode: string): Promise<{
    midia: MidiaColetada | null;
    comentarios: Comentario[];
  }>;

  baixarVideo(midia: MidiaColetada): Promise<Buffer>;

  fechar(): Promise<void>;
}

export interface Coletor {
  nome: string;
  /** Se true, o handler aplica teto diario e circuit breaker a cada acao. */
  arriscado: boolean;
  /** Se true, a fonte devolve o texto dos comentarios. */
  leComentarios: boolean;
  coletar(handle: string, log: Logger, jobId: string): Promise<ResultadoColeta>;
}
