'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { media } from '@molde/config';

type Etapa = 'parado' | 'assinando' | 'enviando' | 'enfileirando' | 'pronto';

/**
 * Upload direto para o Storage.
 *
 * O arquivo nunca passa pela API: pedimos uma URL assinada, o browser envia o
 * video para o Supabase, e so entao registramos o job. E o que permite mandar
 * um reel de 90s sem esbarrar no limite de corpo da Vercel.
 */
export function UploadVideo() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [etapa, setEtapa] = useState<Etapa>('parado');
  const [progresso, setProgresso] = useState(0);
  const [erro, setErro] = useState<string | null>(null);
  const [arrastando, setArrastando] = useState(false);

  const ocupado = etapa !== 'parado' && etapa !== 'pronto';

  const limiteMb = Math.round(media.maxUploadBytes / 1024 / 1024);

  async function enviar(file: File) {
    setErro(null);
    setProgresso(0);

    // Conferimos ANTES de começar: deixar o envio rodar até o fim para só então
    // o Storage recusar é desperdiçar o tempo de quem espera.
    if (file.size > media.maxUploadBytes) {
      setErro(
        `Esse vídeo tem ${(file.size / 1024 / 1024).toFixed(0)} MB, e o limite do plano é ${limiteMb} MB. ` +
          'Comprima o arquivo, ou use a opção de link ao lado — ela não passa pelo Storage.',
      );
      return;
    }

    try {
      setEtapa('assinando');
      const assinatura = await fetch('/api/uploads/sign', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          filename: file.name,
          sizeBytes: file.size,
          contentType: file.type,
        }),
      });

      if (!assinatura.ok) {
        const b = (await assinatura.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error ?? 'não consegui preparar o envio');
      }

      const { path, uploadUrl } = (await assinatura.json()) as {
        path: string;
        uploadUrl: string;
      };

      setEtapa('enviando');
      await enviarComProgresso(uploadUrl, file, setProgresso);

      setEtapa('enfileirando');
      const job = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'video_extraction',
          payload: {
            source: 'upload',
            storagePath: path,
            filename: file.name,
            sizeBytes: file.size,
          },
        }),
      });

      if (!job.ok) {
        const b = (await job.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error ?? 'não consegui enfileirar o trabalho');
      }

      setEtapa('pronto');
      router.refresh();
      setTimeout(() => setEtapa('parado'), 2500);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'falhou');
      setEtapa('parado');
    }
  }

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!ocupado) setArrastando(true);
        }}
        onDragLeave={() => setArrastando(false)}
        onDrop={(e) => {
          e.preventDefault();
          setArrastando(false);
          const file = e.dataTransfer.files?.[0];
          if (file && !ocupado) void enviar(file);
        }}
        onClick={() => !ocupado && inputRef.current?.click()}
        className={`cursor-pointer rounded-2xl border border-dashed p-10 text-center transition-colors ${
          arrastando
            ? 'border-signal bg-signal-wash'
            : 'border-line bg-surface/40 hover:border-line-bright'
        } ${ocupado ? 'pointer-events-none opacity-60' : ''}`}
      >
        <input
          ref={inputRef}
          type="file"
          accept="video/mp4,video/quicktime,video/webm,video/x-matroska"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void enviar(file);
            e.target.value = '';
          }}
        />

        {etapa === 'parado' && (
          <>
            <p className="font-display text-[15px] font-medium">
              Arraste um vídeo aqui, ou clique para escolher
            </p>
            <p className="mt-1.5 text-[12px] text-ink-faint">
              MP4, MOV, WebM ou MKV — até {limiteMb} MB
            </p>
          </>
        )}

        {etapa === 'assinando' && <p className="text-[13px] text-ink-dim">preparando o envio…</p>}

        {etapa === 'enviando' && (
          <div className="mx-auto max-w-sm">
            <p className="tabular text-[13px] text-ink-dim">enviando… {progresso}%</p>
            <div className="mt-3 h-1 overflow-hidden rounded-full bg-line">
              <div
                className="h-full rounded-full bg-signal transition-all"
                style={{ width: `${progresso}%` }}
              />
            </div>
          </div>
        )}

        {etapa === 'enfileirando' && (
          <p className="text-[13px] text-ink-dim">colocando na fila…</p>
        )}

        {etapa === 'pronto' && (
          <p className="text-[13px] text-good">
            Na fila. O worker pega assim que estiver ligado.
          </p>
        )}
      </div>

      {erro && <p className="mt-3 text-[13px] text-bad">{erro}</p>}
    </div>
  );
}

/**
 * O navegador reporta o MIME de forma inconsistente: o mesmo .mp4 pode chegar
 * como video/mp4, como application/octet-stream, ou vazio. Como o Storage usa
 * esse cabeçalho, deduzimos pela extensão quando o navegador não ajuda.
 */
const MIME_POR_EXTENSAO: Record<string, string> = {
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  m4v: 'video/mp4',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
};

function tipoDoArquivo(file: File): string {
  if (file.type && file.type.startsWith('video/')) return file.type;
  const extensao = file.name.split('.').pop()?.toLowerCase() ?? '';
  return MIME_POR_EXTENSAO[extensao] ?? 'video/mp4';
}

/**
 * XMLHttpRequest em vez de fetch por um motivo so: fetch nao reporta progresso
 * de upload, e mandar 200 MB sem barra e uma tela travada do ponto de vista de
 * quem espera.
 */
function enviarComProgresso(
  url: string,
  file: File,
  aoProgredir: (pct: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('content-type', tipoDoArquivo(file));
    // O cliente oficial do Supabase manda este cabeçalho; sem ele, reenviar o
    // mesmo caminho falha.
    xhr.setRequestHeader('x-upsert', 'true');

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) aoProgredir(Math.round((e.loaded / e.total) * 100));
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();

      // Mostrar só o número do status torna a falha impossível de diagnosticar.
      // O Storage explica o motivo no corpo — é isso que precisa chegar na tela.
      let detalhe = '';
      try {
        const corpo = JSON.parse(xhr.responseText) as { message?: string; error?: string };
        detalhe = corpo.message ?? corpo.error ?? '';
      } catch {
        detalhe = xhr.responseText.slice(0, 200);
      }

      reject(
        new Error(
          `O Storage recusou o arquivo (HTTP ${xhr.status})` +
            (detalhe ? `: ${detalhe}` : '. Sem detalhe no corpo da resposta.'),
        ),
      );
    });

    xhr.addEventListener('error', () => reject(new Error('falha de rede durante o envio')));
    xhr.send(file);
  });
}
