import { ingest } from '@molde/config';
import { logScrapeEvent } from '@molde/db';
import { linkProbePayloadSchema } from '@molde/shared';
import { consultarEmbed, embedLigado } from '../ingest/embed';
import { lerLink } from '../ingest/link';
import { OrcamentoDeRequisicoes, esperarUmPouco } from '../ingest/seguranca';
import { consultar } from '../ingest/ytdlp';
import type { Handler } from './index';

/**
 * Sondagem de link — medir antes de construir.
 *
 * Este job nao entrega roteiro nenhum. Ele responde uma pergunta que eu nao
 * tenho como responder do meu lado: **o que o Instagram entrega para quem chega
 * deslogado, a partir do runner do GitHub?**
 *
 * A pergunta importa porque o Instagram trata IP de datacenter (que e o do
 * runner) com muito mais rigor que IP residencial. Construir a ingestao inteira
 * antes de saber isso seria apostar dois dias num palpite.
 *
 * Nenhuma credencial sua sai daqui — nem cookie, nem sessao, nem login. A trava
 * em `ingest/seguranca.ts` derruba a chamada se alguem tentar. O maximo que
 * pode acontecer e o IP do runner do GitHub levar um limite temporario: nao e
 * seu, nao esta ligado a voce, e nao ha conta nenhuma para ser punida.
 */
export const linkProbe: Handler = async ({ job, log, progress }) => {
  const { url } = linkProbePayloadSchema.parse(job.payload);
  const orcamento = new OrcamentoDeRequisicoes();

  await progress('lendo o link', { current: 1, total: 4 });

  const lido = lerLink(url);
  if (lido.tipo === 'erro') {
    // Link ilegivel nao merece uma ida ao Instagram.
    await logScrapeEvent({ jobId: job.id, kind: 'resolve', target: 'link_invalido', detail: { url, motivo: lido.motivo } });
    throw new Error(lido.motivo);
  }

  const alvo =
    lido.tipo === 'post'
      ? { tipo: 'post' as const, chave: lido.shortcode, url: lido.url }
      : { tipo: 'perfil' as const, chave: lido.handle, url: lido.url };

  log.info('link lido', alvo);

  /* ------------------------------------------------- camada 1: yt-dlp */
  await progress('camada 1: yt-dlp deslogado', { current: 2, total: 4 });
  orcamento.gastar();

  const camada1 = await consultar(
    alvo.url,
    log,
    alvo.tipo === 'perfil' ? { maxItens: ingest.maxVideosPorPerfil, listagem: true } : {},
  );

  await logScrapeEvent({
    jobId: job.id,
    kind: 'probe',
    target: 'camada1',
    detail: camada1.ok
      ? { ok: true, chave: alvo.chave, itens: camada1.itens.length, segundos: camada1.segundos }
      : { ok: false, chave: alvo.chave, motivo: camada1.motivo, mensagem: camada1.mensagem, segundos: camada1.segundos },
  });

  /* --------------------------------------------------- camada 2: embed */
  // A camada 2 roda SEMPRE na sondagem, mesmo se a 1 deu certo: o objetivo aqui
  // e medir as duas, nao entregar o resultado mais rapido.
  let camada2: Awaited<ReturnType<typeof consultarEmbed>> | { pulada: true } = { pulada: true };

  if (alvo.tipo === 'post' && embedLigado()) {
    await progress('camada 2: pagina publica de embed', { current: 3, total: 4 });
    await esperarUmPouco();
    orcamento.gastar();

    camada2 = await consultarEmbed(alvo.chave, log);

    await logScrapeEvent({
      jobId: job.id,
      kind: 'probe',
      target: 'camada2',
      detail: camada2.ok
        ? { ok: true, chave: alvo.chave, campos: camada2.dados, segundos: camada2.segundos }
        : { ok: false, chave: alvo.chave, motivo: camada2.motivo, mensagem: camada2.mensagem, segundos: camada2.segundos },
    });
  }

  /* ------------------------------------------------------- o relatorio */
  await progress('montando o relatorio', { current: 4, total: 4 });

  // Campo por campo: o que veio e o que nao veio. E o que voce pediu para eu
  // reportar antes de construir tela para dado que talvez nao exista.
  const primeiro = camada1.ok ? camada1.itens[0] : null;
  const camposDoPost = primeiro
    ? {
        shortcode: primeiro.shortcode,
        perfil: primeiro.uploader,
        legenda: primeiro.tituloOuLegenda ? `${primeiro.tituloOuLegenda.length} caracteres` : null,
        duracao_s: primeiro.duracaoS,
        publicado_em: primeiro.publicadoEm,
        curtidas: primeiro.curtidas,
        comentarios: primeiro.comentarios,
        visualizacoes: primeiro.visualizacoes,
        tem_arquivo_de_video: primeiro.formatos.length > 0,
        formatos: primeiro.formatos.length,
      }
    : null;

  const resolveuEm = camada1.ok
    ? 'camada 1 (yt-dlp)'
    : 'ok' in camada2 && camada2.ok
      ? 'camada 2 (embed, sem arquivo de video)'
      : 'nenhuma';

  const camadaVencedora = camada1.ok
    ? 'camada1'
    : 'ok' in camada2 && camada2.ok
      ? 'camada2'
      : 'nenhuma';

  await logScrapeEvent({
    jobId: job.id,
    kind: 'resolve',
    target: camadaVencedora,
    detail: {
      tipo: alvo.tipo,
      chave: alvo.chave,
      motivo: camada1.ok ? null : camada1.motivo,
    },
  });

  log.info('sondagem concluida', { resolveuEm, requisicoes: orcamento.consumidas });

  return {
    result: {
      link: { tipo: alvo.tipo, chave: alvo.chave, url: alvo.url },
      resolveuEm,
      requisicoes: orcamento.consumidas,
      camada1: camada1.ok
        ? { ok: true, itens: camada1.itens.length, segundos: camada1.segundos, campos: camposDoPost,
            amostraDePerfil: alvo.tipo === 'perfil'
              ? camada1.itens.slice(0, 5).map((i) => ({
                  shortcode: i.shortcode, duracao_s: i.duracaoS, publicado_em: i.publicadoEm,
                  curtidas: i.curtidas, comentarios: i.comentarios, visualizacoes: i.visualizacoes,
                }))
              : null }
        : { ok: false, motivo: camada1.motivo, mensagem: camada1.mensagem, segundos: camada1.segundos },
      camada2:
        'pulada' in camada2
          ? { pulada: true, porque: alvo.tipo === 'perfil' ? 'embed so existe para post' : 'desligada na config' }
          : camada2.ok
            ? { ok: true, campos: camada2.dados, segundos: camada2.segundos }
            : { ok: false, motivo: camada2.motivo, mensagem: camada2.mensagem, segundos: camada2.segundos },
    },
    costUsd: 0,
  };
};
