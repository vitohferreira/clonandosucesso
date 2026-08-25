import type { PlacarDeCamadas } from '@molde/db';

/**
 * Quantos links resolveram em cada camada.
 *
 * Este numero decide o rumo: se a camada 1 estiver perdendo na maioria, nao
 * adianta refinar em cima dela. Melhor descobrir com 10 links do que com 200.
 */
export function PlacarCamadas({ placar }: { placar: PlacarDeCamadas }) {
  if (placar.total === 0) return null;

  const linhas = [
    { rotulo: 'Camada 1 — yt-dlp', valor: placar.camada1, bom: true },
    { rotulo: 'Camada 2 — embed público', valor: placar.camada2, bom: true },
    { rotulo: 'Nenhuma resolveu', valor: placar.nenhuma, bom: false },
    { rotulo: 'Link inválido', valor: placar.link_invalido, bom: false },
  ].filter((l) => l.valor > 0);

  const pct = (n: number) => Math.round((n / placar.total) * 100);
  const taxa1 = pct(placar.camada1);

  return (
    <section className="rounded-xl border border-line bg-surface p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-medium">Onde os links resolveram</h2>
        <span className="font-mono text-[11px] text-ink-faint">
          {placar.total} {placar.total === 1 ? 'link' : 'links'}
        </span>
      </div>

      <ul className="mt-4 space-y-2">
        {linhas.map((l) => (
          <li key={l.rotulo} className="flex items-center gap-3">
            <span className="w-44 shrink-0 text-xs text-ink-dim">{l.rotulo}</span>
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-raised">
              <span
                className={`block h-full rounded-full ${l.bom ? 'bg-ink-dim' : 'bg-signal'}`}
                style={{ width: `${pct(l.valor)}%` }}
              />
            </span>
            <span className="w-16 shrink-0 text-right font-mono text-[11px] text-ink-faint">
              {l.valor} · {pct(l.valor)}%
            </span>
          </li>
        ))}
      </ul>

      {placar.total >= 5 && taxa1 < 50 && (
        <p className="mt-4 border-t border-line pt-3 text-[11px] leading-relaxed text-signal">
          A camada 1 está resolvendo {taxa1}% dos links. Abaixo de 50% ela não sustenta a
          ingestão por link sozinha — vale decidir outra abordagem antes de construir mais
          em cima dela.
        </p>
      )}
    </section>
  );
}
