import { models } from '@molde/config';
import { requireEnv } from '../env';
import type { Logger } from '../logger';
import { idsDoGroq, rankear } from './groq-modelos';
import { chamarApi } from './http';

/**
 * Transcricao via Groq (Whisper).
 *
 * Usa fetch direto em vez de SDK: a API e multipart simples e nao vale mais uma
 * dependencia. O endpoint e compativel com o formato da OpenAI.
 */
const ENDPOINT = 'https://api.groq.com/openai/v1/audio/transcriptions';

/**
 * O nome do modelo na config e PREFERENCIA, nao lei. O Groq aposenta nome com
 * frequencia, e aqui isso e grave: a transcricao e o coracao da ferramenta —
 * sem ela nao existe roteiro nenhum, e nao ha segundo fornecedor gratuito para
 * onde cair. Entao, se o nome nao existir mais, perguntamos a propria API qual
 * Whisper a chave alcanca.
 */
let ranking: string[] | null = null;
let escolhido = 0;
const MAX_TROCAS = 2;

function modeloAtual(): string {
  return ranking?.[escolhido] ?? models.transcription.model;
}

/** Quanto este modelo serve para transcrever. Negativo = nao serve. */
function pontuar(id: string): number {
  const n = id.toLowerCase();
  if (!n.includes('whisper')) return -1;

  let pontos = 10;
  // Turbo e o que a camada gratuita cobre com folga, e e o mais rapido.
  if (n.includes('turbo')) pontos += 50;
  if (n.includes('large')) pontos += 30;
  // Distil e menor e erra mais em portugues; serve so se nao houver outro.
  if (n.includes('distil')) pontos -= 40;
  // "en" no fim quer dizer so-ingles: nao serve para o nosso caso.
  if (/[-_]en$/.test(n)) return -1;

  const versao = n.match(/v(\d+)/)?.[1];
  if (versao) pontos += Number(versao) * 5;

  return pontos;
}

/** Avanca para o proximo Whisper da lista. null = acabaram. */
async function proximoModelo(apiKey: string): Promise<string | null> {
  if (!ranking) {
    const encontrados = rankear(await idsDoGroq(apiKey), pontuar);
    if (encontrados.length === 0) {
      throw new Error(
        'A sua chave do Groq nao alcanca nenhum modelo Whisper. ' +
          'Gere outra em console.groq.com/keys.',
      );
    }
    ranking = [
      models.transcription.model,
      ...encontrados.filter((id) => id !== models.transcription.model),
    ];
    escolhido = 0;
  }

  if (escolhido + 1 >= ranking.length) return null;
  escolhido += 1;
  return ranking[escolhido] ?? null;
}

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface Transcript {
  text: string;
  /** Qual Whisper de fato respondeu — pode nao ser o da config. */
  modelUsed: string;
  segments: TranscriptSegment[];
  raw: unknown;
  audioSeconds: number;
  costUsd: number;
}

export async function transcribe(
  audio: Buffer,
  filename: string,
  log?: Logger,
  trocas = 0,
): Promise<Transcript> {
  const apiKey = requireEnv('GROQ_API_KEY');
  const modelo = modeloAtual();

  if (audio.byteLength > models.transcription.maxUploadBytes) {
    throw new Error(
      `Audio de ${(audio.byteLength / 1024 / 1024).toFixed(1)} MB passa do teto do Groq. ` +
        'Video longo demais para uma requisicao so.',
    );
  }

  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(audio)], { type: 'audio/mpeg' }), filename);
  form.append('model', modelo);
  // verbose_json e o que traz os segments com timestamp — sem isso o roteiro
  // nao tem como ser fatiado em blocos.
  form.append('response_format', 'verbose_json');
  // Sem `language` o Whisper detecta sozinho. Ver o comentario na config: fixar
  // 'pt' num video gringo nao da erro, da transcricao errada.
  if (models.transcription.language) {
    form.append('language', models.transcription.language);
  }

  const response = await chamarApi(
    ENDPOINT,
    { method: 'POST', headers: { authorization: `Bearer ${apiKey}` }, body: form },
    'Groq',
  );

  if (!response.ok) {
    const detalhe = await response.text().catch(() => '');

    // Nome aposentado: pergunta a API qual Whisper existe e tenta de novo, em
    // vez de derrubar o job e exigir que alguem edite a config.
    const sumiu = response.status === 404 || /model_not_found|does not exist/i.test(detalhe);
    if (sumiu && trocas < MAX_TROCAS) {
      const substituto = await proximoModelo(apiKey);
      if (substituto) {
        log?.warn('modelo de transcricao nao existe mais', { era: modelo, usando: substituto });
        return transcribe(audio, filename, log, trocas + 1);
      }
    }

    throw new Error(
      `Groq recusou a transcricao (${modelo}, HTTP ${response.status}): ${detalhe.slice(0, 500)}`,
    );
  }

  const data = (await response.json()) as {
    text?: string;
    duration?: number;
    segments?: Array<{ start: number; end: number; text: string }>;
  };

  const segments = (data.segments ?? []).map((s) => ({
    start: s.start,
    end: s.end,
    text: s.text.trim(),
  }));

  const audioSeconds = data.duration ?? 0;

  return {
    text: (data.text ?? '').trim(),
    modelUsed: modelo,
    segments,
    raw: data,
    audioSeconds,
    costUsd: Number(((audioSeconds / 3600) * models.transcription.usdPerAudioHour).toFixed(6)),
  };
}
