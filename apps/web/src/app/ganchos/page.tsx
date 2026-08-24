import { listHooks } from '@molde/db';
import { PageHead, Shell } from '@/components/Shell';
import { relativeTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

/**
 * A biblioteca de ganchos.
 *
 * Hoje ela enche com os videos que voce sobe. Na Fase 3 passa a encher sozinha,
 * com os ganchos dos posts outliers de cada perfil analisado — e e por isso que
 * ela ja ordena por performance, mesmo antes de existir performance para ordenar.
 */
export default async function GanchosPage() {
  const ganchos = await listHooks(200);

  const porTipo = new Map<string, number>();
  for (const g of ganchos) {
    const tipo = g.kind ?? 'outro';
    porTipo.set(tipo, (porTipo.get(tipo) ?? 0) + 1);
  }

  return (
    <Shell>
      <PageHead
        titulo="Ganchos"
        descricao="Os primeiros segundos de cada vídeo analisado, isolados e classificados pelo mecanismo que usam para segurar a atenção."
      />

      {ganchos.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line p-10 text-center text-[13px] text-ink-faint">
          Vazio por enquanto. Cada vídeo que você analisar deposita o gancho dele aqui.
        </p>
      ) : (
        <>
          <div className="mb-6 flex flex-wrap gap-2">
            {[...porTipo.entries()]
              .sort((a, b) => b[1] - a[1])
              .map(([tipo, quantos]) => (
                <span
                  key={tipo}
                  className="rounded-lg border border-line bg-surface px-2.5 py-1 text-[12px] text-ink-dim"
                >
                  {tipo} <span className="tabular text-ink-faint">{quantos}</span>
                </span>
              ))}
          </div>

          <ul className="space-y-2">
            {ganchos.map((g) => (
              <li key={g.id} className="rounded-xl border border-line bg-surface p-4">
                <div className="flex items-start justify-between gap-4">
                  <p className="font-display text-[15px] leading-snug">“{g.text}”</p>
                  {g.performance_multiple != null && (
                    <span className="tabular shrink-0 rounded-md bg-signal px-2 py-0.5 text-[11px] font-semibold text-void">
                      {g.performance_multiple.toFixed(1)}x
                    </span>
                  )}
                </div>

                <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-faint">
                  {g.kind && (
                    <span className="rounded border border-line-bright px-1.5 py-0.5">
                      {g.kind}
                    </span>
                  )}
                  {g.span_seconds != null && (
                    <span className="tabular">{g.span_seconds.toFixed(1)}s</span>
                  )}
                  {g.on_screen_text && (
                    <span className="font-mono truncate">na tela: {g.on_screen_text}</span>
                  )}
                  <span className="ml-auto">{relativeTime(g.created_at)}</span>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </Shell>
  );
}
