'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { parseInstagramLink } from '@molde/shared';
import { mensagemDaFila, type RespostaDeJob } from '@/lib/worker-status';

/**
 * Extração a partir do link de um reel.
 *
 * A API oficial busca por PERFIL, não por post — então quando o link não traz o
 * @ (o formato `instagram.com/reel/CODIGO`), pedimos o perfil junto. O campo só
 * aparece quando é necessário, para não pedir o que já dá para deduzir.
 */
export function LinkDoReel() {
  const router = useRouter();
  const [link, setLink] = useState('');
  const [handleManual, setHandleManual] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<{ texto: string; bom: boolean } | null>(null);

  const lido = link.trim() ? parseInstagramLink(link) : null;
  const linkInvalido = link.trim().length > 0 && !lido;
  const precisaDoHandle = lido !== null && lido.handle === null;
  const handleFinal = lido?.handle ?? handleManual.trim();
  const pronto = lido !== null && handleFinal.length > 0;

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!lido || !handleFinal) return;

    setEnviando(true);
    setErro(null);
    setOk(null);

    const r = await fetch('/api/jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'video_extraction',
        payload: {
          source: 'instagram',
          shortcode: lido.shortcode,
          handle: handleFinal,
          postId: null,
        },
      }),
    });

    setEnviando(false);

    if (!r.ok) {
      const b = (await r.json().catch(() => ({}))) as { error?: string };
      setErro(b.error ?? 'não consegui enfileirar');
      return;
    }

    setOk(mensagemDaFila((await r.json().catch(() => ({}))) as RespostaDeJob));
    setLink('');
    setHandleManual('');
    router.refresh();
    setTimeout(() => setOk(null), 8000);
  }

  return (
    <form onSubmit={enviar} className="rounded-2xl border border-line bg-surface p-5">
      <label className="block text-[13px] text-ink-dim">Ou cole o link de um reel</label>

      <input
        value={link}
        onChange={(e) => setLink(e.target.value)}
        placeholder="https://www.instagram.com/reel/..."
        className="mt-3 w-full rounded-xl border border-line bg-void px-3.5 py-2.5 text-[14px] outline-none transition-colors placeholder:text-ink-faint focus:border-line-bright"
      />

      {linkInvalido && (
        <p className="mt-2 text-[12px] text-ink-faint">
          Isso não parece um link de post ou reel.
        </p>
      )}

      {/* Só pedimos o @ quando o link não o traz. */}
      {precisaDoHandle && (
        <div className="mt-3">
          <p className="text-[12px] text-ink-faint">
            Esse link não diz de quem é o reel. Qual o perfil?
          </p>
          <div className="relative mt-2">
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[14px] text-ink-faint">
              @
            </span>
            <input
              value={handleManual}
              onChange={(e) => setHandleManual(e.target.value)}
              placeholder="perfil"
              className="w-full rounded-xl border border-line bg-void py-2.5 pl-7 pr-3.5 text-[14px] outline-none transition-colors placeholder:text-ink-faint focus:border-line-bright"
            />
          </div>
        </div>
      )}

      {lido?.handle && (
        <p className="mt-2 text-[12px] text-ink-faint">
          Perfil identificado: <span className="text-ink-dim">@{lido.handle}</span>
        </p>
      )}

      <button
        type="submit"
        disabled={enviando || !pronto}
        className="mt-3 rounded-xl bg-ink px-4 py-2.5 text-[14px] font-medium text-void transition-opacity hover:opacity-90 disabled:opacity-30"
      >
        {enviando ? 'enfileirando…' : 'extrair roteiro'}
      </button>

      {erro && <p className="mt-3 text-[13px] text-bad">{erro}</p>}
      {ok && (
        <p className={`mt-3 text-[13px] ${ok.bom ? 'text-good' : 'text-signal'}`}>{ok.texto}</p>
      )}

      <p className="mt-3 text-[12px] leading-relaxed text-ink-faint">
        Funciona com perfil profissional e público, e com posts recentes o bastante para
        aparecerem na listagem da API.
      </p>
    </form>
  );
}
