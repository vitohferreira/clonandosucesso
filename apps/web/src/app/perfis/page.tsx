import Link from 'next/link';
import { listJobs, listProfiles } from '@molde/db';
import { AnalisarPerfil } from '@/components/AnalisarPerfil';
import { PageHead, Shell } from '@/components/Shell';
import { relativeTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function PerfisPage() {
  const [perfis, jobs] = await Promise.all([listProfiles(100), listJobs(30)]);
  const emAndamento = jobs.filter(
    (j) => j.type === 'profile_analysis' && (j.status === 'queued' || j.status === 'running'),
  );

  return (
    <Shell>
      <PageHead
        titulo="Perfis"
        descricao="Informe um @ e receba o dossiê: formatos, cadência, os posts que explodiram, o roteiro deles e por que aquele perfil funciona."
      />

      <AnalisarPerfil />

      {emAndamento.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-[11px] font-medium uppercase tracking-[0.12em] text-ink-faint">
            Analisando
          </h2>
          <ul className="space-y-2">
            {emAndamento.map((job) => {
              const p = job.progress;
              const pct = p?.current && p.total ? Math.round((p.current / p.total) * 100) : null;
              return (
                <li key={job.id} className="rounded-xl border border-line bg-surface p-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[13px]">
                      @{String((job.payload as { handle?: string }).handle ?? '?')}
                    </span>
                    <span className="text-[11px] text-ink-faint">
                      {job.status === 'queued' ? 'na fila' : (p?.message ?? p?.step ?? 'coletando')}
                    </span>
                  </div>
                  <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-line">
                    <div
                      className="h-full rounded-full bg-live transition-all"
                      style={{ width: pct != null ? `${pct}%` : '10%' }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="mt-10">
        <h2 className="mb-3 text-[11px] font-medium uppercase tracking-[0.12em] text-ink-faint">
          Já analisados
        </h2>

        {perfis.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-line p-10 text-center text-[13px] text-ink-faint">
            Nenhum ainda. Comece pelo perfil que você mais admira no seu nicho.
          </p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {perfis.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/perfis/${p.handle}`}
                  className="block rounded-xl border border-line bg-surface p-4 transition-colors hover:border-line-bright"
                >
                  <p className="font-display text-[15px] font-medium">@{p.handle}</p>
                  {p.full_name && <p className="mt-0.5 text-[12px] text-ink-dim">{p.full_name}</p>}
                  <p className="mt-2.5 text-[11px] text-ink-faint">
                    {p.category ?? 'sem categoria'} · analisado {relativeTime(p.last_analyzed_at)}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Shell>
  );
}
