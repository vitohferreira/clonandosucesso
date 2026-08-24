import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { media } from '@molde/config';
import { downloadFile, removeFiles, saveVideoAnalysis, uploadFile } from '@molde/db';
import { videoExtractionPayloadSchema } from '@molde/shared';
import { estruturarRoteiro } from '../ai';
import { transcribe } from '../ai/groq';
import { paths } from '../env';
import {
  averageShotSeconds,
  chooseFrameTimestamps,
  detectScenes,
  ensureFfmpeg,
  extractAudio,
  extractFrames,
  probe,
} from '../media/ffmpeg';
import type { Handler } from './index';

/**
 * Modulo B — de um arquivo de video a um roteiro anotado.
 *
 * Funciona sozinho, sem depender de scraping nenhum. Na Fase 3 o mesmo pipeline
 * e reaproveitado nos videos outliers de um perfil; por isso a analise ja aceita
 * um `post_id`, que aqui vem nulo.
 */
export const videoExtraction: Handler = async ({ job, log, progress, signal }) => {
  const payload = videoExtractionPayloadSchema.parse(job.payload);

  if (payload.source === 'instagram') {
    throw new Error(
      'Extracao a partir de um reel do Instagram entra na Fase 3. Por enquanto, so upload de arquivo.',
    );
  }

  await ensureFfmpeg();

  const trabalho = join(paths.media, job.id);
  await mkdir(trabalho, { recursive: true });

  const videoLocal = join(trabalho, 'fonte.mp4');
  const audioLocal = join(trabalho, `audio.${media.audio.format}`);

  try {
    // ---------------------------------------------------------------- baixar
    await progress('baixando o video', { current: 1, total: 6 });
    const bytes = await downloadFile(payload.storagePath);
    await writeFile(videoLocal, bytes);

    const info = await probe(videoLocal);
    log.info('video recebido', {
      arquivo: payload.filename,
      duracao: info.durationSeconds,
      resolucao: `${info.width}x${info.height}`,
      temAudio: info.hasAudio,
    });

    if (info.durationSeconds <= 0) {
      throw new Error('Nao consegui ler a duracao do video. Arquivo corrompido ou formato exotico?');
    }
    if (!info.hasAudio) {
      throw new Error('Este video nao tem faixa de audio, entao nao ha fala para transcrever.');
    }

    // ----------------------------------------------------------- transcrever
    if (signal.aborted) throw new Error('Worker encerrando antes da transcricao');
    await progress('extraindo o audio', { current: 2, total: 6 });
    const audio = await extractAudio(videoLocal, audioLocal);

    await progress('transcrevendo a fala', { current: 3, total: 6 });
    const transcricao = await transcribe(audio, `${job.id}.${media.audio.format}`);
    log.info('transcricao pronta', {
      segmentos: transcricao.segments.length,
      caracteres: transcricao.text.length,
      custoUsd: transcricao.costUsd,
    });

    // ---------------------------------------------------------- ritmo visual
    if (signal.aborted) throw new Error('Worker encerrando antes da analise visual');
    await progress('detectando os cortes', { current: 4, total: 6 });
    const cortes = await detectScenes(videoLocal);
    const instantes = chooseFrameTimestamps(cortes, info.durationSeconds);
    const frames = await extractFrames(videoLocal, instantes, join(trabalho, 'frames'));
    const mediaPlano = averageShotSeconds(cortes, info.durationSeconds);

    log.info('ritmo lido', {
      cortes: cortes.length,
      framesEnviados: frames.length,
      duracaoMediaPlano: mediaPlano,
    });

    // --------------------------------------------------------------- roteiro
    if (signal.aborted) throw new Error('Worker encerrando antes de estruturar');
    await progress('montando o roteiro', { current: 5, total: 6 });
    const analise = await estruturarRoteiro({
      durationSeconds: info.durationSeconds,
      segments: transcricao.segments,
      frames,
      sceneTimestamps: cortes,
      avgShotSeconds: mediaPlano,
    });

    // ---------------------------------------------------------------- gravar
    await progress('salvando', { current: 6, total: 6 });

    const pastaMidia = `analises/${job.id}`;
    const caminhoAudio = await uploadFile(
      `${pastaMidia}/audio.${media.audio.format}`,
      audio,
      'audio/mpeg',
    );

    // Os frames ficam: sao o que a tela de resultado mostra ao lado de cada bloco.
    for (const [i, frame] of frames.entries()) {
      await uploadFile(
        `${pastaMidia}/frames/${String(i).padStart(3, '0')}.jpg`,
        Buffer.from(frame.base64, 'base64'),
        'image/jpeg',
      );
    }

    const salvo = await saveVideoAnalysis({
      jobId: job.id,
      source: 'upload',
      sourceUrl: payload.filename,
      audioPath: caminhoAudio,
      framesPath: `${pastaMidia}/frames`,
      durationSeconds: info.durationSeconds,
      transcriptRaw: transcricao.raw,
      transcriptText: transcricao.text,
      script: analise.script,
      cutCount: cortes.length,
      avgShotSeconds: mediaPlano,
      shotBoundaries: { timestamps: cortes, framesEnviados: instantes },
      modelUsed: analise.modelUsed,
      usage: { ...analise.usage, audio_seconds: transcricao.audioSeconds },
      costUsd: Number((analise.costUsd + transcricao.costUsd).toFixed(6)),
    });

    // O mp4 original nao serve para mais nada depois disto, e ocupa o storage
    // inteiro do plano gratuito. Guardamos audio, frames e a analise.
    if (!media.keepSourceVideo) {
      await removeFiles([payload.storagePath]).catch((e) =>
        log.warn('nao consegui apagar o video original', { error: String(e) }),
      );
    }

    log.info('roteiro pronto', {
      analiseId: salvo.id,
      blocos: analise.script.blocks.length,
      gancho: analise.script.hook.kind,
      custoUsd: salvo.cost_usd,
    });

    return {
      result: {
        videoAnalysisId: salvo.id,
        durationSeconds: info.durationSeconds,
        blockCount: analise.script.blocks.length,
        cutCount: cortes.length,
        hookText: analise.script.hook.text,
      },
      costUsd: Number((analise.costUsd + transcricao.costUsd).toFixed(6)),
    };
  } finally {
    // Temporarios sempre saem, mesmo se algo falhou no meio.
    await rm(trabalho, { recursive: true, force: true }).catch(() => {});
  }
};
