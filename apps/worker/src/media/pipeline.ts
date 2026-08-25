import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { media, models } from '@molde/config';
import { saveVideoAnalysis, uploadFile } from '@molde/db';
import type { MediaSource, VideoAnalysis } from '@molde/shared';
import { estruturarRoteiro } from '../ai';
import { paths } from '../env';
import type { Logger } from '../logger';
import {
  averageShotSeconds,
  chooseFrameTimestamps,
  detectScenes,
  ensureFfmpeg,
  extractAudio,
  extractFrames,
  probe,
} from './ffmpeg';
import { transcribe } from '../ai/groq';

/**
 * De um arquivo de video local ao roteiro gravado.
 *
 * Este e o pipeline da Fase 1, extraido para ser reaproveitado: o Modulo B o
 * chama com um upload, e o Modulo A o chama com os videos que explodiram num
 * perfil. A logica de analise e exatamente a mesma nos dois casos — a diferenca
 * esta so em como o arquivo chegou ate aqui.
 */
export interface EntradaPipeline {
  videoLocal: string;
  pastaDeTrabalho: string;
  jobId: string;
  postId?: string | null;
  source: MediaSource;
  sourceUrl?: string | null;
  log: Logger;
  aoProgredir?: (etapa: string) => Promise<void>;
}

export interface SaidaPipeline {
  analise: VideoAnalysis;
  custoUsd: number;
  blocos: number;
  cortes: number;
}

export async function analisarVideoLocal(entrada: EntradaPipeline): Promise<SaidaPipeline> {
  const { videoLocal, pastaDeTrabalho, jobId, log } = entrada;
  const passo = entrada.aoProgredir ?? (async () => {});

  await ensureFfmpeg();

  const info = await probe(videoLocal);
  if (info.durationSeconds <= 0) {
    throw new Error('Nao consegui ler a duracao do video. Arquivo corrompido ou formato exotico?');
  }
  if (!info.hasAudio) {
    throw new Error('Este video nao tem faixa de audio, entao nao ha fala para transcrever.');
  }

  await passo('extraindo o audio');
  const audioLocal = join(pastaDeTrabalho, `audio.${media.audio.format}`);
  const audio = await extractAudio(videoLocal, audioLocal);

  await passo('transcrevendo a fala');
  const transcricao = await transcribe(audio, `${jobId}.${media.audio.format}`);

  await passo('detectando os cortes');
  const cortes = await detectScenes(videoLocal);
  const instantes = chooseFrameTimestamps(cortes, info.durationSeconds, models.analysis.maxImages);
  const frames = await extractFrames(videoLocal, instantes, join(pastaDeTrabalho, 'frames'));
  const mediaPlano = averageShotSeconds(cortes, info.durationSeconds);

  log.info('ritmo lido', {
    cortes: cortes.length,
    framesEnviados: frames.length,
    duracaoMediaPlano: mediaPlano,
  });

  await passo('montando o roteiro');
  const analise = await estruturarRoteiro({
    durationSeconds: info.durationSeconds,
    segments: transcricao.segments,
    frames,
    sceneTimestamps: cortes,
    avgShotSeconds: mediaPlano,
  });

  await passo('salvando');
  const pastaMidia = `analises/${jobId}/${entrada.postId ?? 'upload'}`;
  const caminhoAudio = await uploadFile(
    `${pastaMidia}/audio.${media.audio.format}`,
    audio,
    'audio/mpeg',
  );

  for (const [i, frame] of frames.entries()) {
    await uploadFile(
      `${pastaMidia}/frames/${String(i).padStart(3, '0')}.jpg`,
      Buffer.from(frame.base64, 'base64'),
      'image/jpeg',
    );
  }

  const custoUsd = Number((analise.costUsd + transcricao.costUsd).toFixed(6));

  const salvo = await saveVideoAnalysis({
    postId: entrada.postId ?? null,
    jobId,
    source: entrada.source,
    sourceUrl: entrada.sourceUrl ?? null,
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
    costUsd: custoUsd,
  });

  log.info('roteiro pronto', {
    analiseId: salvo.id,
    blocos: analise.script.blocks.length,
    gancho: analise.script.hook.kind,
    custoUsd,
  });

  return {
    analise: salvo,
    custoUsd,
    blocos: analise.script.blocks.length,
    cortes: cortes.length,
  };
}

/** Pasta temporaria por job, sempre limpa no fim. */
export async function comPastaDeTrabalho<T>(
  jobId: string,
  sufixo: string,
  acao: (pasta: string) => Promise<T>,
): Promise<T> {
  const pasta = join(paths.media, jobId, sufixo);
  await mkdir(pasta, { recursive: true });
  try {
    return await acao(pasta);
  } finally {
    await rm(pasta, { recursive: true, force: true }).catch(() => {});
  }
}
