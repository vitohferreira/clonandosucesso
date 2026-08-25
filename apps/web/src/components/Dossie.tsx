import type { Highlight, Post, PostMetrics, ProfileAnalysis, ProfileSnapshot } from '@molde/shared';
import { Markdown } from '@/lib/markdown';

/**
 * O dossiê.
 *
 * A ordem das seções é a ordem da pergunta que se faz na prática: primeiro por
 * que o perfil funciona, depois quais posts explodiram, e só então os números
 * que sustentam isso. O post mediano não interessa — por isso os outliers vêm
 * antes de qualquer distribuição.
 */

type Metrica = PostMetrics & { post: Post };

const COR_TIER: Record<string, string> = {
  '5': 'bg-signal text-void',
  '3': 'bg-signal/25 text-signal',
  '2': 'bg-signal/15 text-signal',
  '-1': 'bg-bad/15 text-bad',
};

function Secao({
  titulo,
  children,
  nota,
}: {
  titulo: string;
  children: React.ReactNode;
  nota?: string;
}) {
  return (
    <section className="mt-12">
      <h2 className="text-[11px] font-medium uppercase tracking-[0.12em] text-ink-faint">
        {titulo}
      </h2>
      {nota && <p className="mt-1 text-[12px] text-ink-faint">{nota}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Pares({ itens }: { itens: Array<{ titulo: string; corpo: string }> }) {
  if (itens.length === 0) {
    return <p className="text-[13px] text-ink-faint">Nada identificado.</p>;
  }
  return (
    <ul className="space-y-2">
      {itens.map((item, i) => (
        <li key={i} className="rounded-xl border border-line bg-surface p-4">
          <p className="text-[14px] font-medium">{item.titulo}</p>
          <p className="mt-1.5 text-[13px] leading-relaxed text-ink-faint">{item.corpo}</p>
        </li>
      ))}
    </ul>
  );
}

export function Dossie({
  analise,
  metricas,
  destaques,
  semelhantes,
  snapshots,
}: {
  analise: ProfileAnalysis;
  metricas: Metrica[];
  destaques: Highlight[];
  semelhantes: string[];
  snapshots: ProfileSnapshot[];
}) {
  const explodiram = metricas
    .filter((m) => m.outlier_tier !== null && m.outlier_tier > 0)
    .sort((a, b) => b.multiple - a.multiple);
  const morreram = metricas
    .filter((m) => m.outlier_tier === -1)
    .sort((a, b) => a.multiple - b.multiple)
    .slice(0, 6);

  const formatos = analise.format_distribution as {
    contagem?: Record<string, number>;
    desempenhoMediano?: Record<string, number>;
  } | null;
  const cadencia = analise.cadence as {
    postsPorSemana?: number;
    porDiaDaSemana?: Record<string, number>;
    porHora?: Record<string, number>;
  } | null;
  const duracoes = analise.duration_buckets as Array<{
    faixa: string;
    posts: number;
    multiploMediano: number;
    outliers: number;
  }> | null;
  const formula = (analise.usage as { hookFormula?: string } | null)?.hookFormula;

  return (
    <div>
      {/* Por que funciona — a resposta que a ferramenta existe para dar. */}
      <section className="rounded-2xl border border-signal-dim bg-signal-wash/30 p-6">
        <h2 className="text-[11px] font-medium uppercase tracking-[0.12em] text-signal">
          Por que esse perfil funciona
        </h2>
        <div className="mt-3">
          <Markdown texto={analise.synthesis_md ?? ''} />
        </div>

        {formula && (
          <div className="mt-5 border-t border-signal-dim/40 pt-4">
            <p className="text-[11px] uppercase tracking-[0.12em] text-ink-faint">
              A fórmula de gancho dele
            </p>
            <p className="mt-1.5 font-display text-[15px] leading-snug">{formula}</p>
          </div>
        )}
      </section>

      <Secao
        titulo={`Os que explodiram (${explodiram.length})`}
        nota="Comparados com a mediana dos posts vizinhos no tempo, não com a do perfil inteiro."
      >
        {explodiram.length === 0 ? (
          <p className="text-[13px] text-ink-faint">
            Nenhum post se destacou o suficiente. Pode ser um perfil muito consistente — ou poucos
            posts coletados.
          </p>
        ) : (
          <ul className="space-y-2">
            {explodiram.map((m) => (
              <li key={m.id} className="rounded-xl border border-line bg-surface p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={`tabular rounded-md px-2 py-0.5 text-[11px] font-semibold ${
                          COR_TIER[String(m.outlier_tier)] ?? 'bg-raised text-ink-dim'
                        }`}
                      >
                        {m.multiple.toFixed(1)}x
                      </span>
                      <span className="text-[11px] text-ink-faint">{m.post.type}</span>
                      {m.post.video_duration_s != null && (
                        <span className="tabular text-[11px] text-ink-faint">
                          {m.post.video_duration_s.toFixed(0)}s
                        </span>
                      )}
                      <span className="text-[11px] text-ink-faint">base {m.basis}</span>
                    </div>

                    {m.post.caption && (
                      <p className="mt-2 line-clamp-2 text-[13px] leading-relaxed text-ink-dim">
                        {m.post.caption}
                      </p>
                    )}
                  </div>

                  <a
                    href={m.post.url ?? '#'}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 text-[11px] text-ink-faint transition-colors hover:text-signal"
                  >
                    ver ↗
                  </a>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Secao>

      <Secao titulo="Padrões narrativos">
        <Pares
          itens={((analise.narrative_patterns ?? []) as Array<{ pattern: string; evidence: string }>).map(
            (p) => ({ titulo: p.pattern, corpo: p.evidence }),
          )}
        />
      </Secao>

      <Secao titulo="A dor da audiência" nota="Lida nos comentários dos posts que explodiram.">
        <Pares
          itens={((analise.audience_pain ?? []) as Array<{ pain: string; evidence: string }>).map(
            (p) => ({ titulo: p.pain, corpo: p.evidence }),
          )}
        />
      </Secao>

      <Secao titulo="O que ele tenta e não funciona">
        <Pares
          itens={((analise.what_fails ?? []) as Array<{ attempt: string; why: string }>).map((p) => ({
            titulo: p.attempt,
            corpo: p.why,
          }))}
        />
      </Secao>

      <Secao titulo="Chamadas para ação">
        <Pares
          itens={((analise.cta_patterns ?? []) as Array<{ cta: string; frequency: string }>).map(
            (p) => ({ titulo: p.cta, corpo: p.frequency }),
          )}
        />
      </Secao>

      <Secao titulo="Números">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-line bg-surface p-4">
            <p className="text-[12px] text-ink-faint">Formatos</p>
            <ul className="tabular mt-2.5 space-y-1.5 text-[13px]">
              {Object.entries(formatos?.contagem ?? {})
                .filter(([, n]) => n > 0)
                .sort((a, b) => b[1] - a[1])
                .map(([tipo, n]) => (
                  <li key={tipo} className="flex justify-between">
                    <span className="text-ink-dim">{tipo}</span>
                    <span>
                      {n}
                      {formatos?.desempenhoMediano?.[tipo] != null && (
                        <span className="ml-2 text-ink-faint">
                          {formatos.desempenhoMediano[tipo]?.toFixed(2)}x
                        </span>
                      )}
                    </span>
                  </li>
                ))}
            </ul>
          </div>

          <div className="rounded-xl border border-line bg-surface p-4">
            <p className="text-[12px] text-ink-faint">Cadência</p>
            <p className="tabular mt-2.5 text-[13px]">
              {cadencia?.postsPorSemana?.toFixed(1) ?? '—'} posts por semana
            </p>
            <p className="mt-2 text-[12px] text-ink-faint">
              {Object.entries(cadencia?.porDiaDaSemana ?? {})
                .sort((a, b) => b[1] - a[1])
                .slice(0, 3)
                .map(([dia, n]) => `${dia} (${n})`)
                .join(' · ')}
            </p>
            <p className="mt-1 text-[12px] text-ink-faint">
              {Object.entries(cadencia?.porHora ?? {})
                .sort((a, b) => b[1] - a[1])
                .slice(0, 3)
                .map(([h, n]) => `${h} (${n})`)
                .join(' · ')}
            </p>
          </div>
        </div>

        {duracoes && duracoes.some((d) => d.posts > 0) && (
          <div className="mt-4 overflow-x-auto rounded-xl border border-line bg-surface">
            <table className="tabular w-full text-[13px]">
              <thead>
                <tr className="border-b border-line text-[11px] text-ink-faint">
                  <th className="p-3 text-left font-medium">duração</th>
                  <th className="p-3 text-right font-medium">posts</th>
                  <th className="p-3 text-right font-medium">mediana</th>
                  <th className="p-3 text-right font-medium">explodiram</th>
                </tr>
              </thead>
              <tbody>
                {duracoes
                  .filter((d) => d.posts > 0)
                  .map((d) => (
                    <tr key={d.faixa} className="border-b border-line last:border-0">
                      <td className="p-3 text-ink-dim">{d.faixa}</td>
                      <td className="p-3 text-right">{d.posts}</td>
                      <td className="p-3 text-right">{d.multiploMediano.toFixed(2)}x</td>
                      <td className="p-3 text-right text-signal">{d.outliers || ''}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </Secao>

      {morreram.length > 0 && (
        <Secao titulo="Os que morreram" nota="Bem abaixo da mediana dos vizinhos.">
          <ul className="space-y-2">
            {morreram.map((m) => (
              <li
                key={m.id}
                className="flex items-center gap-3 rounded-xl border border-line bg-surface p-3.5"
              >
                <span className="tabular rounded-md bg-bad/15 px-2 py-0.5 text-[11px] text-bad">
                  {m.multiple.toFixed(2)}x
                </span>
                <span className="text-[11px] text-ink-faint">{m.post.type}</span>
                <span className="line-clamp-1 flex-1 text-[13px] text-ink-dim">
                  {m.post.caption ?? m.post.shortcode}
                </span>
              </li>
            ))}
          </ul>
        </Secao>
      )}

      {destaques.length > 0 && (
        <Secao titulo="Destaques fixados">
          <div className="flex flex-wrap gap-2">
            {destaques.map((d) => (
              <span
                key={d.id}
                className="rounded-lg border border-line bg-surface px-3 py-1.5 text-[13px] text-ink-dim"
              >
                {d.title}
              </span>
            ))}
          </div>
        </Secao>
      )}

      {semelhantes.length > 0 && (
        <Secao titulo="Do mesmo ecossistema" nota="Sugeridos pelo próprio Instagram.">
          <div className="flex flex-wrap gap-2">
            {semelhantes.map((h) => (
              <a
                key={h}
                href={`https://instagram.com/${h}`}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border border-line bg-surface px-3 py-1.5 text-[13px] text-ink-dim transition-colors hover:border-line-bright hover:text-ink"
              >
                @{h}
              </a>
            ))}
          </div>
        </Secao>
      )}

      {snapshots.length > 1 && (
        <Secao titulo="Evolução" nota="Um registro por análise.">
          <ul className="tabular space-y-1.5 text-[13px]">
            {snapshots.map((s) => (
              <li key={s.id} className="flex gap-6 text-ink-dim">
                <span className="text-ink-faint">{s.captured_at.slice(0, 10)}</span>
                <span>{s.followers?.toLocaleString('pt-BR') ?? '—'} seguidores</span>
                <span className="text-ink-faint">{s.posts_count ?? '—'} posts</span>
              </li>
            ))}
          </ul>
        </Secao>
      )}
    </div>
  );
}
