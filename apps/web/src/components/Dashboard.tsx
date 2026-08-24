'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  JOB_STATUS_LABELS,
  JOB_TYPE_LABELS,
  type JobRow,
  type JobStatus,
  type RateLimitField,
} from '@molde/shared';
import { absoluteTime, duration, relativeTime, usd } from '@/lib/format';
import { PageHead } from './Shell';

export type LimitsSnapshot = Record<RateLimitField, { used: number; limit: number; left: number }>;

const ESTILO_STATUS: Record<JobStatus, string> = {
  queued: 'bg-raised text-ink-dim',
  running: 'bg-live/15 text-live',
  done: 'bg-good/15 text-good',
  failed: 'bg-bad/15 text-bad',
  blocked: 'bg-signal/15 text-signal',
};

const ROTULO_TETO: Record<RateLimitField, string> = {
  profiles_analyzed: 'Perfis',
  posts_opened: 'Posts abertos',
  videos_downloaded: 'Vídeos baixados',
  requests: 'Navegações',
};

export function Dashboard({
  initialJobs,
  initialLimits,
}: {
  initialJobs: JobRow[];
  initialLimits: LimitsSnapshot | null;
}) {
  const [jobs, setJobs] = useState(initialJobs);
  const [limits, setLimits] = useState(initialLimits);
  const [criando, setCriando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const atualizar = useCallback(async () => {
    try {
      const r = await fetch('/api/jobs', { cache: 'no-store' });
      if (!r.ok) return;
      const data = (await r.json()) as { jobs: JobRow[]; limits: LimitsSnapshot };
      setJobs(data.jobs);
      setLimits(data.limits);
    } catch {
      // Falha de rede momentânea não precisa aparecer: o próximo tick resolve.
    }
  }, []);

  // Com job andando, atualiza rápido; parado, devagar.
  useEffect(() => {
    const ocupado = jobs.some((j) => j.status === 'running' || j.status === 'queued');
    const t = setInterval(atualizar, ocupado ? 2_000 : 10_000);
    return () => clearInterval(t);
  }, [jobs, atualizar]);

  async function enfileirarPing() {
    setCriando(true);
    setErro(null);

    const r = await fetch('/api/jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'ping', payload: { message: 'teste', sleepMs: 6_000 } }),
    });

    setCriando(false);

    if (!r.ok) {
      const b = (await r.json().catch(() => ({}))) as { error?: string };
      setErro(b.error ?? 'não consegui enfileirar');
      return;
    }
    await atualizar();
  }

  return (
    <>
      <PageHead
        titulo="Fila"
        descricao="Todo trabalho pesado passa por aqui. O worker pega um de cada vez e grava o resultado."
        acao={
          <button
            onClick={enfileirarPing}
            disabled={criando}
            className="rounded-xl border border-line px-3 py-2 text-[13px] text-ink-dim transition-colors hover:border-line-bright hover:text-ink disabled:opacity-40"
          >
            {criando ? 'enfileirando…' : 'testar a fila'}
          </button>
        }
      />

      {erro && <p className="mb-6 text-[13px] text-bad">{erro}</p>}

      {limits && (
        <section className="mb-10 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(Object.keys(ROTULO_TETO) as RateLimitField[]).map((campo) => {
            const v = limits[campo];
            const pct = v.limit > 0 ? Math.min(100, (v.used / v.limit) * 100) : 0;
            const estourou = pct >= 100;
            return (
              <div key={campo} className="rounded-xl border border-line bg-surface p-3.5">
                <p className="text-[11px] text-ink-faint">{ROTULO_TETO[campo]}</p>
                <p className="tabular mt-1.5 text-[15px]">
                  <span className={estourou ? 'text-signal' : 'text-ink'}>{v.used}</span>
                  <span className="text-ink-faint"> / {v.limit}</span>
                </p>
                <div className="mt-2.5 h-[3px] overflow-hidden rounded-full bg-line">
                  <div
                    className={`h-full rounded-full ${estourou ? 'bg-signal' : 'bg-line-bright'}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </section>
      )}

      <h2 className="mb-3 text-[11px] font-medium uppercase tracking-[0.12em] text-ink-faint">
        Trabalhos recentes
      </h2>

      {jobs.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line p-10 text-center text-[13px] text-ink-faint">
          Nada na fila.
        </p>
      ) : (
        <ul className="space-y-2">
          {jobs.map((job) => (
            <CardJob key={job.id} job={job} />
          ))}
        </ul>
      )}
    </>
  );
}

function CardJob({ job }: { job: JobRow }) {
  const p = job.progress;
  const pct = p?.current != null && p.total ? Math.round((p.current / p.total) * 100) : null;

  return (
    <li className="rounded-xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span
            className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${ESTILO_STATUS[job.status]}`}
          >
            {JOB_STATUS_LABELS[job.status]}
          </span>
          <span className="text-[13px]">{JOB_TYPE_LABELS[job.type]}</span>
          <span className="tabular text-[11px] text-ink-faint">{job.id.slice(0, 8)}</span>
        </div>

        <div className="tabular flex items-center gap-4 text-[11px] text-ink-faint">
          <span title={absoluteTime(job.created_at)}>{relativeTime(job.created_at)}</span>
          {job.finished_at && <span>{duration(job.started_at, job.finished_at)}</span>}
          {job.cost_usd ? <span className="text-ink-dim">{usd(job.cost_usd)}</span> : null}
        </div>
      </div>

      {job.status === 'running' && p && (
        <div className="mt-3">
          <div className="flex items-center justify-between text-[11px] text-ink-faint">
            <span>
              {p.step}
              {p.message ? ` — ${p.message}` : ''}
            </span>
            {p.current != null && p.total ? (
              <span className="tabular">
                {p.current}/{p.total}
              </span>
            ) : null}
          </div>
          <div className="mt-2 h-[3px] overflow-hidden rounded-full bg-line">
            <div
              className="h-full rounded-full bg-live transition-all"
              style={{ width: pct != null ? `${pct}%` : '30%' }}
            />
          </div>
        </div>
      )}

      {/* Adiado por teto diário: não é falha, só voltou para a fila. */}
      {job.status === 'queued' && job.defer_count > 0 && (
        <p className="mt-3 text-[12px] text-signal">
          Adiado {job.defer_count}× — {job.defer_reason}. Volta em{' '}
          {absoluteTime(job.scheduled_for)}.
        </p>
      )}

      {job.status === 'blocked' && (
        <p className="mt-3 text-[12px] text-signal">
          Bloqueado: <span className="font-mono">{job.blocked_reason}</span>. O worker parou de
          propósito e não vai tentar de novo sozinho.
        </p>
      )}

      {job.error && (
        <details className="mt-3">
          <summary className="cursor-pointer text-[12px] text-bad">erro</summary>
          <pre className="mt-2 overflow-x-auto rounded-lg bg-void p-3 font-mono text-[11px] text-bad">
            {job.error}
          </pre>
        </details>
      )}

      {job.result && (
        <details className="mt-3">
          <summary className="cursor-pointer text-[12px] text-ink-faint">resultado</summary>
          <pre className="mt-2 overflow-x-auto rounded-lg bg-void p-3 font-mono text-[11px] text-ink-dim">
            {JSON.stringify(job.result, null, 2)}
          </pre>
        </details>
      )}
    </li>
  );
}
