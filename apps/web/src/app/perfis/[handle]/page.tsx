import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  getLatestAnalysis,
  getProfileByHandle,
  listHighlights,
  listMetrics,
  listSimilarProfiles,
  listSnapshots,
} from '@molde/db';
import { PageHead, Shell } from '@/components/Shell';
import { Dossie } from '@/components/Dossie';
import { relativeTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function PerfilPage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const perfil = await getProfileByHandle(decodeURIComponent(handle));
  if (!perfil) notFound();

  const [analise, metricas, snapshots, destaques, semelhantes] = await Promise.all([
    getLatestAnalysis(perfil.id),
    listMetrics(perfil.id),
    listSnapshots(perfil.id, 10),
    listHighlights(perfil.id),
    listSimilarProfiles(perfil.id),
  ]);

  const atual = snapshots[0] ?? null;

  return (
    <Shell>
      <Link
        href="/perfis"
        className="text-[12px] text-ink-faint transition-colors hover:text-ink-dim"
      >
        ← perfis
      </Link>

      <div className="mt-4">
        <PageHead
          titulo={`@${perfil.handle}`}
          descricao={perfil.bio ?? perfil.full_name ?? undefined}
        />
      </div>

      <dl className="tabular mb-10 flex flex-wrap gap-x-8 gap-y-3 border-y border-line py-4 text-[13px]">
        <div>
          <dt className="text-[11px] text-ink-faint">seguidores</dt>
          <dd className="mt-0.5">{atual?.followers?.toLocaleString('pt-BR') ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-[11px] text-ink-faint">publicações</dt>
          <dd className="mt-0.5">{atual?.posts_count?.toLocaleString('pt-BR') ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-[11px] text-ink-faint">posts coletados</dt>
          <dd className="mt-0.5">{metricas.length}</dd>
        </div>
        <div>
          <dt className="text-[11px] text-ink-faint">categoria</dt>
          <dd className="mt-0.5">{perfil.category ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-[11px] text-ink-faint">última análise</dt>
          <dd className="mt-0.5">{relativeTime(perfil.last_analyzed_at)}</dd>
        </div>
        {perfil.external_url && (
          <div>
            <dt className="text-[11px] text-ink-faint">link</dt>
            <dd className="mt-0.5">
              <a
                href={perfil.external_url}
                target="_blank"
                rel="noreferrer"
                className="text-signal hover:underline"
              >
                {perfil.external_url.replace(/^https?:\/\//, '').slice(0, 32)}
              </a>
            </dd>
          </div>
        )}
      </dl>

      {analise ? (
        <Dossie
          analise={analise}
          metricas={metricas}
          destaques={destaques}
          semelhantes={semelhantes}
          snapshots={snapshots}
        />
      ) : (
        <p className="rounded-2xl border border-dashed border-line p-10 text-center text-[13px] text-ink-faint">
          O perfil foi coletado, mas a síntese ainda não rodou. Ligue o worker e dispare a análise
          de novo.
        </p>
      )}
    </Shell>
  );
}
