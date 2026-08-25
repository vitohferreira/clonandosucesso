'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { mensagemDaFila, type RespostaDeJob } from '@/lib/worker-status';

/** Dispara a análise de um perfil. O trabalho pesado é do worker. */
export function AnalisarPerfil() {
  const router = useRouter();
  const [handle, setHandle] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<{ texto: string; bom: boolean } | null>(null);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setErro(null);
    setOk(null);

    const r = await fetch('/api/jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'profile_analysis',
        payload: { handle, forceRefetch: false },
      }),
    });

    setEnviando(false);

    if (!r.ok) {
      const b = (await r.json().catch(() => ({}))) as { error?: string; issues?: unknown[] };
      setErro(b.issues?.length ? 'Handle inválido. Use só letras, números, ponto e underline.' : (b.error ?? 'falhou'));
      return;
    }

    setOk(mensagemDaFila((await r.json().catch(() => ({}))) as RespostaDeJob));
    setHandle('');
    router.refresh();
    setTimeout(() => setOk(null), 8000);
  }

  return (
    <form onSubmit={enviar} className="rounded-2xl border border-line bg-surface p-5">
      <label className="block text-[13px] text-ink-dim">
        Qual perfil você quer destrinchar?
      </label>

      <div className="mt-3 flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[15rem]">
          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[14px] text-ink-faint">
            @
          </span>
          <input
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            placeholder="perfil"
            className="w-full rounded-xl border border-line bg-void py-2.5 pl-7 pr-3.5 text-[14px] outline-none transition-colors placeholder:text-ink-faint focus:border-line-bright"
          />
        </div>

        <button
          type="submit"
          disabled={enviando || handle.trim().length === 0}
          className="rounded-xl bg-ink px-4 py-2.5 text-[14px] font-medium text-void transition-opacity hover:opacity-90 disabled:opacity-30"
        >
          {enviando ? 'enfileirando…' : 'analisar'}
        </button>
      </div>

      {erro && <p className="mt-3 text-[13px] text-bad">{erro}</p>}
      {ok && (
        <p className={`mt-3 text-[13px] ${ok.bom ? 'text-good' : 'text-signal'}`}>{ok.texto}</p>
      )}

      <p className="mt-3 text-[12px] leading-relaxed text-ink-faint">
        Roda em segundo plano: você pode fechar a aba. Perfil privado não é coletado, e o worker
        para sozinho se o Instagram pedir confirmação.
      </p>
    </form>
  );
}
