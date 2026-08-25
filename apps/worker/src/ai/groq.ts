import { models } from '@molde/config';
import { requireEnv } from '../env';
import { chamarApi } from './http';

/**
 * Transcricao via Groq (Whisper).
 *
 * Usa fetch direto em vez de SDK: a API e multipart simples e nao vale mais uma
 * dependencia. O endpoint e compativel com o formato da OpenAI.
 */
const ENDPOINT = 'https://api.groq.com/openai/v1/audio/transcriptions';

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface Transcript {
  text: string;
  segments: TranscriptSegment[];
  raw: unknown;
  audioSeconds: number;
  costUsd: number;
}

export async function transcribe(audio: Buffer, filename: string): Promise<Transcript> {
  const apiKey = requireEnv('GROQ_API_KEY');

  if (audio.byteLength > models.transcription.maxUploadBytes) {
    throw new Error(
      `Audio de ${(audio.byteLength / 1024 / 1024).toFixed(1)} MB passa do teto do Groq. ` +
        'Video longo demais para uma requisicao so.',
    );
  }

  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(audio)], { type: 'audio/mpeg' }), filename);
  form.append('model', models.transcription.model);
  // verbose_json e o que traz os segments com timestamp — sem isso o roteiro
  // nao tem como ser fatiado em blocos.
  form.append('response_format', 'verbose_json');
  form.append('language', 'pt');

  const response = await chamarApi(
    ENDPOINT,
    { method: 'POST', headers: { authorization: `Bearer ${apiKey}` }, body: form },
    'Groq',
  );

  if (!response.ok) {
    const detalhe = await response.text().catch(() => '');
    throw new Error(`Groq recusou a transcricao (HTTP ${response.status}): ${detalhe.slice(0, 500)}`);
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
    segments,
    raw: data,
    audioSeconds,
    costUsd: Number(((audioSeconds / 3600) * models.transcription.usdPerAudioHour).toFixed(6)),
  };
}
