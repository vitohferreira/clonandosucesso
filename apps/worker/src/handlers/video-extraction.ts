import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { media } from '@molde/config';
import { consume, downloadFile, ensureCapacity, removeFiles } from '@molde/db';
import { videoExtractionPayloadSchema } from '@molde/shared';
import { coletorAtivo } from '../collector';
import { sondarLink } from './link-probe';
import { analisarVideoLocal, comPastaDeTrabalho } from '../media/pipeline';
import type { Handler } from './index';

/**
 * Modulo B — de um video a um roteiro anotado.
 *
 * Duas entradas possiveis:
 *
 *   upload     arquivo que voce enviou, que chega pelo Storage.
 *   instagram  link de um reel, que e buscado pela fonte de coleta ativa.
 *
 * A analise em si vive em media/pipeline.ts, compartilhada com o Modulo A: o que
 * muda entre os caminhos e apenas como o arquivo chegou ate aqui.
 */
export const videoExtraction: Handler = async (ctx) => {
  const { job, log, progress, signal } = ctx;
  const payload = videoExtractionPayloadSchema.parse(job.payload);

  /* -------------------------------------------------------- sondagem */
  // Nao produz roteiro: mede o que o Instagram entrega para quem chega
  // deslogado. Sai antes de tudo porque nao compartilha nada com os outros
  // dois caminhos.
  if (payload.source === 'sondagem') {
    return sondarLink(ctx, payload.url);
  }

  /* ------------------------------------------------------ link de um reel */
  if (payload.source === 'instagram') {
    const coletor = coletorAtivo();
    log.info('buscando o reel', { handle: payload.handle, shortcode: payload.shortcode });

    await progress('procurando o post', { current: 1, total: 6, message: `@${payload.handle}` });

    // A fonte busca por PERFIL: pegamos a listagem e achamos o post nela.
    const coleta = await coletor.coletar(payload.handle, log, job.id);

    try {
      const alvo = coleta.midias.find((m) => m.shortcode === payload.shortcode);

      if (!alvo) {
        throw new Error(
          `Nao achei o post ${payload.shortcode} entre as ultimas ${coleta.midias.length} publicacoes de @${payload.handle}. ` +
            'Ou o link e de outro perfil, ou o post e antigo demais para aparecer na listagem.',
        );
      }

      if (!alvo.videoUrl) {
        throw new Error(
          `O post ${payload.shortcode} nao tem arquivo de video — provavelmente e foto ou carrossel.`,
        );
      }

      // Teto de custo: cada video processado gasta API paga.
      await ensureCapacity('videos_downloaded', 1);

      const saida = await comPastaDeTrabalho(job.id, payload.shortcode, async (pasta) => {
        await progress('baixando o video', { current: 2, total: 6 });
        const caminho = join(pasta, 'fonte.mp4');
        await writeFile(caminho, await coleta.baixarVideo(alvo));

        if (signal.aborted) throw new Error('Worker encerrando antes de processar');

        let etapa = 2;
        return analisarVideoLocal({
          videoLocal: caminho,
          pastaDeTrabalho: pasta,
          jobId: job.id,
          postId: payload.postId,
          source: 'instagram',
          sourceUrl: alvo.url,
          log,
          aoProgredir: async (nome) => {
            etapa++;
            await progress(nome, { current: etapa, total: 6 });
          },
        });
      });

      await consume('videos_downloaded', 1);

      return {
        result: {
          videoAnalysisId: saida.analise.id,
          durationSeconds: saida.analise.duration_s,
          blockCount: saida.blocos,
          cutCount: saida.cortes,
          hookText: saida.analise.hook_text,
        },
        costUsd: saida.custoUsd,
      };
    } finally {
      await coleta.fechar();
    }
  }

  /* ------------------------------------------------------ arquivo enviado */
  return comPastaDeTrabalho(job.id, 'upload', async (pasta) => {
    await progress('baixando o video', { current: 1, total: 6 });

    const videoLocal = join(pasta, 'fonte.mp4');
    await writeFile(videoLocal, await downloadFile(payload.storagePath));

    if (signal.aborted) throw new Error('Worker encerrando antes de processar');

    let etapa = 1;
    const saida = await analisarVideoLocal({
      videoLocal,
      pastaDeTrabalho: pasta,
      jobId: job.id,
      source: 'upload',
      sourceUrl: payload.filename,
      log,
      aoProgredir: async (nome) => {
        etapa++;
        await progress(nome, { current: etapa, total: 6 });
      },
    });

    // O mp4 original nao serve para mais nada depois disto, e ocupa o storage
    // inteiro do plano gratuito. Ficam audio, frames e a analise.
    if (!media.keepSourceVideo) {
      await removeFiles([payload.storagePath]).catch((e) =>
        log.warn('nao consegui apagar o video original', { error: String(e) }),
      );
    }

    return {
      result: {
        videoAnalysisId: saida.analise.id,
        durationSeconds: saida.analise.duration_s,
        blockCount: saida.blocos,
        cutCount: saida.cortes,
        hookText: saida.analise.hook_text,
      },
      costUsd: saida.custoUsd,
    };
  });
};

