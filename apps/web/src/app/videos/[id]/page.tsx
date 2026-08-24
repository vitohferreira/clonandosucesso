import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createReadUrl, getVideoAnalysis } from '@molde/db';
import { structuredScriptSchema } from '@molde/shared';
import { ScriptView, type FrameRef } from '@/components/ScriptView';
import { Shell } from '@/components/Shell';
import { absoluteTime, usd } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function VideoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const analise = await getVideoAnalysis(id);
  if (!analise) notFound();

  // O roteiro foi validado antes de ser gravado, mas revalidamos na leitura:
  // uma linha antiga de um formato anterior nao pode derrubar a tela.
  const script = structuredScriptSchema.safeParse(analise.script);

  // Os frames viram URL assinada aqui, no servidor — o bucket e privado.
  const instantes =
    (analise.shot_boundaries as { framesEnviados?: number[] } | null)?.framesEnviados ?? [];

  const frames: FrameRef[] = [];
  if (analise.frames_path) {
    for (const [i, seconds] of instantes.entries()) {
      try {
        const url = await createReadUrl(
          `${analise.frames_path}/${String(i).padStart(3, '0')}.jpg`,
          3600,
        );
        frames.push({ seconds, url });
      } catch {
        // Frame que sumiu do storage nao impede o roteiro de aparecer.
      }
    }
  }

  return (
    <Shell>
      <Link
        href="/videos"
        className="text-[12px] text-ink-faint transition-colors hover:text-ink-dim"
      >
        ← vídeos
      </Link>

      <div className="mt-4 mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-line pb-6">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight">Roteiro</h1>
          <p className="mt-1 text-[12px] text-ink-faint">
            {analise.source_url ?? 'upload'} · {absoluteTime(analise.created_at)}
          </p>
        </div>

        <dl className="tabular flex gap-6 text-[12px]">
          <div>
            <dt className="text-ink-faint">duração</dt>
            <dd className="mt-0.5 text-ink">{analise.duration_s?.toFixed(1) ?? '?'}s</dd>
          </div>
          <div>
            <dt className="text-ink-faint">cortes</dt>
            <dd className="mt-0.5 text-ink">{analise.cut_count ?? 0}</dd>
          </div>
          <div>
            <dt className="text-ink-faint">plano médio</dt>
            <dd className="mt-0.5 text-ink">{analise.avg_shot_s?.toFixed(2) ?? '?'}s</dd>
          </div>
          <div>
            <dt className="text-ink-faint">custo</dt>
            <dd className="mt-0.5 text-ink">{usd(analise.cost_usd)}</dd>
          </div>
        </dl>
      </div>

      {script.success ? (
        <ScriptView script={script.data} frames={frames} />
      ) : (
        <p className="rounded-xl border border-bad/30 bg-bad/5 p-4 text-[13px] text-bad">
          O roteiro gravado não bate com o formato atual. Rode a extração de novo.
        </p>
      )}

      {analise.transcript_text && (
        <details className="mt-10">
          <summary className="cursor-pointer text-[12px] text-ink-faint hover:text-ink-dim">
            transcrição corrida
          </summary>
          <p className="mt-3 rounded-xl border border-line bg-surface p-5 text-[13px] leading-relaxed text-ink-dim">
            {analise.transcript_text}
          </p>
        </details>
      )}
    </Shell>
  );
}
