import Link from 'next/link';
import { listJobs, listVideoAnalyses } from '@molde/db';
import { PageHead, Shell } from '@/components/Shell';
import { LinkDoReel } from '@/components/LinkDoReel';
import { UploadVideo } from '@/components/UploadVideo';
import { relativeTime, usd } from '@/lib/format';

export const dynamic = 'force-dynamic';

/** O que identifica o trabalho na lista, conforme a origem do vídeo. */
function rotuloDoJob(payload: unknown): string {
  const p = payload as { source?: string; filename?: string; handle?: string; shortcode?: string };
  if (p.source === 'instagram') return `@${p.handle ?? '?'} · ${p.shortcode ?? ''}`;
  return p.filename ?? 'vídeo';
}

export default async function VideosPage() {
  const [analises, jobs] = await Promise.all([listVideoAnalyses(50), listJobs(30)]);
  const emAndamento = jobs.filter(
    (j) => j.type === 'video_extraction' && (j.status === 'queued' || j.status === 'running'),
  );

  return (
    <Shell>
      <PageHead
        titulo="Vídeos"
        descricao="Mande um vídeo e receba o roteiro anotado: fala com timestamp, texto na tela, descrição de cena, ritmo de corte e o gancho isolado."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <UploadVideo />
        <LinkDoReel />
      </div>

      {emAndamento.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-[11px] font-medium uppercase tracking-[0.12em] text-ink-faint">
            Processando
          </h2>
          <ul className="space-y-2">
            {emAndamento.map((job) => {
              const p = job.progress;
              const pct = p?.current && p.total ? Math.round((p.current / p.total) * 100) : null;
              return (
                <li key={job.id} className="rounded-xl border border-line bg-surface p-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[13px]">{rotuloDoJob(job.payload)}</span>
                    <span className="tabular text-[11px] text-ink-faint">
                      {job.status === 'queued' ? 'na fila' : (p?.step ?? 'processando')}
                    </span>
                  </div>
                  <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-line">
                    <div
                      className="h-full rounded-full bg-live transition-all"
                      style={{ width: pct != null ? `${pct}%` : '12%' }}
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
          Roteiros extraídos
        </h2>

        {analises.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-line p-10 text-center text-[13px] text-ink-faint">
            Nenhum ainda. Mande o primeiro vídeo aí em cima.
          </p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {analises.map((a) => (
              <li key={a.id}>
                <Link
                  href={`/videos/${a.id}`}
                  className="block rounded-xl border border-line bg-surface p-4 transition-colors hover:border-line-bright"
                >
                  <p className="line-clamp-2 font-display text-[15px] leading-snug font-medium">
                    {a.hook_text ?? 'sem gancho identificado'}
                  </p>
                  <div className="tabular mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-ink-faint">
                    <span>{a.duration_s?.toFixed(0) ?? '?'}s</span>
                    <span>{a.cut_count ?? 0} cortes</span>
                    <span>plano médio {a.avg_shot_s?.toFixed(1) ?? '?'}s</span>
                    <span>{usd(a.cost_usd)}</span>
                    <span className="ml-auto">{relativeTime(a.created_at)}</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Shell>
  );
}
