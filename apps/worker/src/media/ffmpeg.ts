import { execFile } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { media } from '@molde/config';

const run = promisify(execFile);

/**
 * Tudo que depende de ffmpeg. E o motivo de o worker nao caber na Vercel.
 *
 * Nenhuma funcao aqui lanca por defeito do video em si (audio mudo, sem cortes
 * detectaveis): elas devolvem o caso vazio, e quem chama decide. So erro real de
 * processo estoura.
 */

const MAX_BUFFER = 32 * 1024 * 1024; // showinfo em video longo passa do padrao de 1MB

async function ffmpeg(args: string[]): Promise<{ stdout: string; stderr: string }> {
  try {
    return await run('ffmpeg', ['-hide_banner', '-nostdin', ...args], { maxBuffer: MAX_BUFFER });
  } catch (error) {
    // ffmpeg escreve tudo em stderr e sai != 0 em varios casos benignos.
    const e = error as { stdout?: string; stderr?: string; code?: number };
    if (typeof e.stderr === 'string' && typeof e.stdout === 'string') {
      return { stdout: e.stdout, stderr: e.stderr };
    }
    throw error;
  }
}

export interface VideoInfo {
  durationSeconds: number;
  width: number;
  height: number;
  hasAudio: boolean;
}

export async function probe(inputPath: string): Promise<VideoInfo> {
  const { stdout } = await run(
    'ffprobe',
    [
      '-v', 'error',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      inputPath,
    ],
    { maxBuffer: MAX_BUFFER },
  );

  const data = JSON.parse(stdout) as {
    format?: { duration?: string };
    streams?: Array<{ codec_type?: string; width?: number; height?: number }>;
  };

  const video = data.streams?.find((s) => s.codec_type === 'video');
  const audio = data.streams?.find((s) => s.codec_type === 'audio');

  return {
    durationSeconds: Number(data.format?.duration ?? 0),
    width: video?.width ?? 0,
    height: video?.height ?? 0,
    hasAudio: Boolean(audio),
  };
}

/**
 * Extrai o audio ja no formato que o Whisper quer: mono, 16kHz, comprimido.
 * Acima disso o Whisper nao ganha nada, e o arquivo fica ~10x menor — o que
 * importa porque o Groq tem teto de tamanho por requisicao.
 */
export async function extractAudio(inputPath: string, outputPath: string): Promise<Buffer> {
  await ffmpeg([
    '-i', inputPath,
    '-vn',
    '-ac', String(media.audio.channels),
    '-ar', String(media.audio.sampleRate),
    '-b:a', media.audio.bitrate,
    '-y', outputPath,
  ]);

  return readFile(outputPath);
}

/**
 * Detecta os cortes de cena. Devolve os instantes, em segundos, onde a imagem
 * muda o suficiente para contar como corte.
 *
 * Video sem corte nenhum (um plano so) devolve lista vazia — e um resultado
 * valido, nao um erro.
 */
export async function detectScenes(inputPath: string): Promise<number[]> {
  const { stderr } = await ffmpeg([
    '-i', inputPath,
    '-vf', `select='gt(scene,${media.frames.sceneThreshold})',showinfo`,
    '-f', 'null',
    '-',
  ]);

  const instantes: number[] = [];
  // O showinfo imprime uma linha por frame selecionado, com pts_time:<segundos>.
  for (const match of stderr.matchAll(/pts_time:([0-9.]+)/g)) {
    const t = Number(match[1]);
    if (Number.isFinite(t)) instantes.push(t);
  }

  return instantes.sort((a, b) => a - b).slice(0, media.frames.maxExtracted);
}

/**
 * Escolhe QUAIS instantes viram imagem para o modelo.
 *
 * Um reel de 90s pode ter 100+ cortes. Mandar todos e caro e nao melhora a
 * analise. A regra: uma fatia reservada aos primeiros segundos, onde mora o
 * gancho, e o resto distribuido pelos cortes ao longo do video.
 */
export function chooseFrameTimestamps(
  sceneTimestamps: number[],
  durationSeconds: number,
  tetoDeFrames: number = media.frames.maxSentToModel,
): number[] {
  // O provedor ativo pode aceitar menos imagens que o nosso teto; vale o menor.
  const total = Math.max(1, Math.min(tetoDeFrames, media.frames.maxSentToModel));
  const janela = Math.min(media.hookWindowSeconds, durationSeconds);
  const vagasGancho = Math.max(1, Math.round(total * media.frames.hookFrameShare));
  const vagasCorpo = total - vagasGancho;

  // O gancho tem poucos segundos e pode nao ter corte nenhum, entao amostramos
  // por tempo em vez de depender dos cortes.
  const gancho: number[] = [];
  for (let i = 0; i < vagasGancho; i++) {
    gancho.push((janela * i) / vagasGancho);
  }

  const cortesDepois = sceneTimestamps.filter((t) => t > janela);
  const corpo: number[] = [];

  if (cortesDepois.length >= vagasCorpo) {
    // Mais cortes que vagas: pega espalhado, para cobrir o video todo.
    const passo = cortesDepois.length / vagasCorpo;
    for (let i = 0; i < vagasCorpo; i++) {
      const t = cortesDepois[Math.floor(i * passo)];
      if (t !== undefined) corpo.push(t);
    }
  } else {
    // Cortes de menos: usa todos e completa amostrando por tempo.
    corpo.push(...cortesDepois);
    const faltam = vagasCorpo - cortesDepois.length;
    const util = Math.max(0, durationSeconds - janela);
    for (let i = 1; i <= faltam && util > 0; i++) {
      corpo.push(janela + (util * i) / (faltam + 1));
    }
  }

  return [...new Set([...gancho, ...corpo])]
    .filter((t) => t >= 0 && t < durationSeconds)
    .sort((a, b) => a - b);
}

export interface Frame {
  seconds: number;
  path: string;
  base64: string;
}

/**
 * Renderiza so os frames escolhidos. Nao guardamos os 100+ frames possiveis:
 * o que nao vai ao modelo nao serve para nada e ocupa storage.
 */
export async function extractFrames(
  inputPath: string,
  timestamps: number[],
  outputDir: string,
): Promise<Frame[]> {
  await mkdir(outputDir, { recursive: true });
  const frames: Frame[] = [];

  for (const [indice, segundos] of timestamps.entries()) {
    const caminho = join(outputDir, `frame-${String(indice).padStart(3, '0')}.jpg`);

    try {
      await ffmpeg([
        // -ss antes de -i faz busca rapida, suficiente para um quadro de referencia.
        '-ss', segundos.toFixed(3),
        '-i', inputPath,
        '-frames:v', '1',
        '-vf', `scale=w=${media.frames.maxEdgePx}:h=${media.frames.maxEdgePx}:force_original_aspect_ratio=decrease`,
        '-q:v', '4',
        '-y', caminho,
      ]);

      const bytes = await readFile(caminho);
      frames.push({ seconds: segundos, path: caminho, base64: bytes.toString('base64') });
    } catch {
      // Um frame que nao renderizou nao derruba a analise: seguimos com os outros.
      continue;
    }
  }

  return frames;
}

/** Duracao media de cada plano. Numero que resume o ritmo de corte. */
export function averageShotSeconds(sceneTimestamps: number[], durationSeconds: number): number {
  const planos = sceneTimestamps.length + 1;
  return durationSeconds > 0 ? Number((durationSeconds / planos).toFixed(2)) : 0;
}

export async function ensureFfmpeg(): Promise<void> {
  try {
    await run('ffmpeg', ['-version'], { maxBuffer: 1024 * 1024 });
    await run('ffprobe', ['-version'], { maxBuffer: 1024 * 1024 });
  } catch {
    throw new Error(
      'ffmpeg/ffprobe nao encontrados. Instale o ffmpeg (no container do worker ele ja vem).',
    );
  }
}
