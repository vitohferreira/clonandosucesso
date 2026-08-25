import { collection } from '@molde/config';
import type { Logger } from '../logger';
import { abrirSessao } from '../scraper/browser';
import type { MidiaColetada } from '../scraper/parse';
import {
  coletarDestaques,
  coletarGrade,
  coletarSugestoes,
  visitarPerfil,
  visitarPost,
} from '../scraper/profile';
import type { Coletor, ResultadoColeta } from './types';

/**
 * Coleta pelo navegador, com a sua sessao.
 *
 * Alcanca o que a API oficial nao alcanca — texto de comentario, destaques,
 * perfis sugeridos, e perfil pessoal —, mas exige rodar numa maquina sua e
 * carrega risco de bloqueio da conta. Por isso nao e o padrao.
 */
export const coletorNavegador: Coletor = {
  nome: 'navegador com sessao',
  arriscado: true,
  leComentarios: true,

  async coletar(handle: string, log: Logger, jobId: string): Promise<ResultadoColeta> {
    const sessao = await abrirSessao(log);

    try {
      const perfil = await visitarPerfil(sessao, handle, log, jobId);
      const midias = await coletarGrade(sessao, log);
      const destaques = await coletarDestaques(sessao, log);
      const sugestoes = await coletarSugestoes(sessao);

      return {
        perfil,
        midias,
        destaques,
        sugestoes,

        async abrirPost(shortcode: string) {
          return visitarPost(sessao, shortcode, log, jobId, { lerComentarios: true });
        },

        async baixarVideo(midia: MidiaColetada) {
          if (!midia.videoUrl) {
            throw new Error(`Post ${midia.shortcode} nao tem arquivo de video.`);
          }
          // Pelo contexto do navegador, para o CDN receber os mesmos cabecalhos
          // e cookies que ele receberia numa navegacao normal.
          const resposta = await sessao.context.request.get(midia.videoUrl);
          if (!resposta.ok()) {
            throw new Error(`CDN recusou o video (HTTP ${resposta.status()})`);
          }
          return Buffer.from(await resposta.body());
        },

        fechar: sessao.fechar,
      };
    } catch (erro) {
      await sessao.fechar();
      throw erro;
    }
  },
};

export { collection };
