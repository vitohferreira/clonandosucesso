'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { mensagemDaFila, type RespostaDeJob } from '@/lib/worker-status';

/** Reenfileira um trabalho que falhou, sem exigir reenviar o arquivo. */
export function BotaoRepetir({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [estado, setEstado] = useState<'parado' | 'enviando' | 'pronto'>('parado');
  const [aviso, setAviso] = useState<string | null>(null);

  async function repetir() {
    setEstado('enviando');
    setAviso(null);

    const r = await fetch(`/api/jobs/${jobId}/retry`, { method: 'POST' });
    const corpo = (await r.json().catch(() => ({}))) as RespostaDeJob & { error?: string };

    if (!r.ok) {
      setAviso(corpo.error ?? 'não consegui repetir');
      setEstado('parado');
      return;
    }

    setAviso(mensagemDaFila(corpo).texto);
    setEstado('pronto');
    router.refresh();
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        onClick={repetir}
        disabled={estado !== 'parado'}
        className="rounded-md border border-line px-2 py-0.5 text-[11px] text-ink-faint transition-colors hover:border-line-bright hover:text-ink-dim disabled:opacity-40"
      >
        {estado === 'enviando' ? 'repetindo…' : 'tentar de novo'}
      </button>
      {aviso && <span className="text-[11px] text-ink-faint">{aviso}</span>}
    </span>
  );
}
