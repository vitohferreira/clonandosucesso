'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import {
  JOB_STATUS_LABELS,
  JOB_TYPE_LABELS,
  type JobRow,
  type JobStatus,
  type RateLimitField,
} from '@molde/shared';
import { absoluteTime, duration, relativeTime, usd } from '@/lib/format';

export type LimitsSnapshot = Record<RateLimitField, { used: number; limit: number; left: number }>;

const STATUS_STYLES: Record<JobStatus, string> = {
  queued: 'bg-zinc-800 text-zinc-300 ring-zinc-700',
  running: 'bg-blue-500/10 text-blue-300 ring-blue-500/30',
  done: 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/30',
  failed: 'bg-red-500/10 text-red-300 ring-red-500/30',
  blocked: 'bg-amber-500/10 text-amber-300 ring-amber-500/30',
};

const LIMIT_LABELS: Record<RateLimitField, string> = {
  profiles_analyzed: 'Perfis analisados',
  posts_opened: 'Posts abertos',
  videos_downloaded: 'Videos baixados',
  requests: 'Navegacoes',
};

export function Dashboard({
  initialJobs,
  initialLimits,
}: {
  initialJobs: JobRow[];
  initialLimits: LimitsSnapshot | null;
}) {
  const router = useRouter();
  const [jobs, setJobs] = useState(initialJobs);
  const [limits, setLimits] = useState(initialLimits);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/jobs', { cache: 'no-store' });
      if (!response.ok) return;
      const data = (await response.json()) as { jobs: JobRow[]; limits: LimitsSnapshot };
      setJobs(data.jobs);
      setLimits(data.limits);
    } catch {
      // Falha de rede momentanea nao precisa aparecer na tela: o proximo tick resolve.
    }
  }, []);

  // Enquanto houver job andando, atualiza rapido; parado, devagar.
  useEffect(() => {
    const busy = jobs.some((job) => job.status === 'running' || job.status === 'queued');
    const interval = setInterval(refresh, busy ? 2_000 : 10_000);
    return () => clearInterval(interval);
  }, [jobs, refresh]);

  async function enqueuePing() {
    setCreating(true);
    setError(null);

    const response = await fetch('/api/jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'ping',
        payload: { message: 'espinha dorsal', sleepMs: 6_000 },
      }),
    });

    setCreating(false);

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? 'nao consegui enfileirar');
      return;
    }

    await refresh();
  }

  async function logout() {
    await fetch('/api/auth', { method: 'DELETE' });
    router.push('/login');
  }

  return (
    <main className="mx-auto max-w-5xl space-y-8 p-6 sm:p-10">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Molde</h1>
          <p className="mt-1 text-sm text-zinc-500">Engenharia reversa de conteudo do Instagram</p>
        </div>
        <button
          onClick={logout}
          className="rounded-lg border border-zinc-800 px-3 py-1.5 text-xs text-zinc-400 transition hover:border-zinc-700 hover:text-zinc-200"
        >
          sair
        </button>
      </header>

      {limits && (
        <section className="space-y-3">
          <h2 className="text-xs font-medium uppercase tracking-wider text-zinc-500">
            Tetos de hoje
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(Object.keys(LIMIT_LABELS) as RateLimitField[]).map((field) => {
              const value = limits[field];
              const pct = value.limit > 0 ? Math.min(100, (value.used / value.limit) * 100) : 0;
              return (
                <div key={field} className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3">
                  <p className="text-[11px] text-zinc-500">{LIMIT_LABELS[field]}</p>
                  <p className="mt-1 font-mono text-sm">
                    <span className={pct >= 100 ? 'text-amber-400' : 'text-zinc-200'}>
                      {value.used}
                    </span>
                    <span className="text-zinc-600"> / {value.limit}</span>
                  </p>
                  <div className="mt-2 h-1 overflow-hidden rounded-full bg-zinc-800">
                    <div
                      className={`h-full rounded-full ${pct >= 100 ? 'bg-amber-500' : 'bg-zinc-500'}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium">Fase 0 — teste da espinha dorsal</h2>
            <p className="mt-1 text-xs text-zinc-500">
              Enfileira um job que nao toca em Instagram, ffmpeg nem API paga. Se ele sair de{' '}
              <span className="text-zinc-400">na fila</span> para{' '}
              <span className="text-zinc-400">concluido</span> aqui na tela, web, banco, fila e
              worker estao conversando.
            </p>
          </div>
          <button
            onClick={enqueuePing}
            disabled={creating}
            className="rounded-lg bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-900 transition hover:bg-white disabled:opacity-40"
          >
            {creating ? 'enfileirando...' : 'enfileirar ping'}
          </button>
        </div>
        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      </section>

      <section className="space-y-3">
        <h2 className="text-xs font-medium uppercase tracking-wider text-zinc-500">Fila</h2>

        {jobs.length === 0 ? (
          <p className="rounded-xl border border-dashed border-zinc-800 p-8 text-center text-sm text-zinc-600">
            Nenhum job ainda.
          </p>
        ) : (
          <ul className="space-y-2">
            {jobs.map((job) => (
              <JobCard key={job.id} job={job} />
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function JobCard({ job }: { job: JobRow }) {
  const progress = job.progress;
  const pct =
    progress?.current != null && progress.total
      ? Math.round((progress.current / progress.total) * 100)
      : null;

  return (
    <li className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span
            className={`rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${STATUS_STYLES[job.status]}`}
          >
            {JOB_STATUS_LABELS[job.status]}
          </span>
          <span className="text-sm">{JOB_TYPE_LABELS[job.type]}</span>
          <span className="font-mono text-[11px] text-zinc-600">{job.id.slice(0, 8)}</span>
        </div>

        <div className="flex items-center gap-4 text-[11px] text-zinc-500">
          <span title={absoluteTime(job.created_at)}>{relativeTime(job.created_at)}</span>
          {job.finished_at && <span>levou {duration(job.started_at, job.finished_at)}</span>}
          {job.cost_usd ? <span>{usd(job.cost_usd)}</span> : null}
        </div>
      </div>

      {job.status === 'running' && progress && (
        <div className="mt-3">
          <div className="flex items-center justify-between text-[11px] text-zinc-500">
            <span>
              {progress.step}
              {progress.message ? ` — ${progress.message}` : ''}
            </span>
            {progress.current != null && progress.total ? (
              <span className="font-mono">
                {progress.current}/{progress.total}
              </span>
            ) : null}
          </div>
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-zinc-800">
            <div
              className="h-full rounded-full bg-blue-500 transition-all"
              style={{ width: pct != null ? `${pct}%` : '30%' }}
            />
          </div>
        </div>
      )}

      {/* Adiado por teto diario: nao e falha, so voltou para a fila. */}
      {job.status === 'queued' && job.defer_count > 0 && (
        <p className="mt-3 text-xs text-amber-400/80">
          Adiado {job.defer_count}x — {job.defer_reason}. Volta em {absoluteTime(job.scheduled_for)}
          .
        </p>
      )}

      {job.status === 'blocked' && (
        <p className="mt-3 text-xs text-amber-300">
          Bloqueado: <span className="font-mono">{job.blocked_reason}</span>. O worker parou de
          proposito e nao vai tentar de novo sozinho.
        </p>
      )}

      {job.error && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-red-400">erro</summary>
          <pre className="mt-2 overflow-x-auto rounded-lg bg-zinc-950 p-3 font-mono text-[11px] text-red-300">
            {job.error}
          </pre>
        </details>
      )}

      {job.result && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-zinc-500">resultado</summary>
          <pre className="mt-2 overflow-x-auto rounded-lg bg-zinc-950 p-3 font-mono text-[11px] text-zinc-400">
            {JSON.stringify(job.result, null, 2)}
          </pre>
        </details>
      )}
    </li>
  );
}
