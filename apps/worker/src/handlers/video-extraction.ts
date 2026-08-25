import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { media } from '@molde/config';
import { downloadFile, removeFiles } from '@molde/db';
import { videoExtractionPayloadSchema } from '@molde/shared';
import { analisarVideoLocal, comPastaDeTrabalho } from '../media/pipeline';
import type { Handler } from './index';

/**
 * Modulo B — de um arquivo enviado a um roteiro anotado.
 *
 * A analise em si vive em media/pipeline.ts, compartilhada com o Modulo A: o
 * que muda entre os dois e apenas como o arquivo chegou. Aqui ele vem do
 * Storage, la ele vem do CDN do Instagram.
 */
export const videoExtraction: Handler = async ({ job, log, progress, signal }) => {
  const payload = videoExtractionPayloadSchema.parse(job.payload);

  if (payload.source === 'instagram') {
    throw new Error(
      'Extracao a partir de um reel avulso ainda nao existe. Por enquanto, ou upload de arquivo, ' +
        'ou analise do perfil inteiro (que ja processa os videos que explodiram).',
    );
  }

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
