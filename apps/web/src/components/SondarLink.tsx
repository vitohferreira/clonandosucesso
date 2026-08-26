'use client';

import { useState } from 'react';

/**
 * Sondagem de link — medir antes de construir.
 *
 * Esta tela existe para responder uma pergunta concreta: o Instagram entrega
 * conteudo publico para quem chega deslogado a partir do servidor do GitHub?
 * A resposta muda o rumo do projeto, e ninguem consegue adivinhar — so medir.
 *
 * Nenhuma credencial sua e usada aqui. Sem login, sem cookie, sem sessao.
 */
export function SondarLink() {
  const [link, setLink] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [enviado, setEnviado] = useState(false);

  async function sondar() {
    const url = link.trim();
    if (!url) return;

    setEnviando(true);
    setErro(null);
    setEnviado(false);

    try {
      const r = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'video_extraction',
          payload: { source: 'sondagem', url },
        }),
      });

      const dados = (await r.json()) as { error?: string };
      if (!r.ok) throw new Error(dados.error ?? `A API respondeu ${r.status}`);

      setEnviado(true);
      setLink('');
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao enfileirar');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <section className="rounded-xl border border-line bg-surface p-5">
      <h2 className="text-sm font-medium">Sondar um link</h2>
      <p className="mt-1 text-xs text-ink-faint">
        Cole um reel ou um perfil. Não gera roteiro: descobre o que o Instagram entrega
        sem login e registra qual camada resolveu.
      </p>

      <div className="mt-4 flex gap-2">
        <input
          value={link}
          onChange={(e) => setLink(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !enviando) sondar();
          }}
          placeholder="instagram.com/reel/… ou @perfil"
          className="min-w-0 flex-1 rounded-lg border border-line bg-base px-3 py-2 font-mono text-xs
                     outline-none placeholder:text-ink-faint focus:border-ink-faint"
        />
        <button
          type="button"
          onClick={sondar}
          disabled={enviando || link.trim().length === 0}
          className="shrink-0 rounded-lg border border-line px-4 py-2 text-xs font-medium
                     transition-colors hover:bg-surface-raised disabled:opacity-40"
        >
          {enviando ? 'Enfileirando…' : 'Sondar'}
        </button>
      </div>

      {erro && <p className="mt-3 text-xs text-signal">{erro}</p>}
      {enviado && (
        <p className="mt-3 text-xs text-ink-dim">
          Na fila. O resultado aparece na lista abaixo quando o worker terminar.
        </p>
      )}

      <p className="mt-4 border-t border-line pt-3 text-[11px] leading-relaxed text-ink-faint">
        Sua conta do Instagram não é usada em nenhum momento — sem login, sem cookie, sem
        sessão. Uma trava no worker cancela a requisição se algum código tentar mandar
        credencial.
      </p>
    </section>
  );
}
