import type { ScriptBlock, StructuredScript } from '@molde/shared';

/**
 * A tela de resultado do Modulo B.
 *
 * O que a diferencia de uma transcricao: cada bloco mostra ao mesmo tempo o que
 * se fala, o que esta escrito na tela, o que esta em quadro e quantos cortes
 * caem ali — que e o conjunto que um editor precisa para recriar a estrutura.
 */

const ROTULO_ROLE: Record<ScriptBlock['role'], string> = {
  gancho: 'gancho',
  contexto: 'contexto',
  desenvolvimento: 'desenvolvimento',
  virada: 'virada',
  prova: 'prova',
  cta: 'CTA',
  outro: 'outro',
};

function tempo(segundos: number): string {
  const m = Math.floor(segundos / 60);
  const s = segundos % 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

export interface FrameRef {
  seconds: number;
  url: string;
}

export function ScriptView({
  script,
  frames,
}: {
  script: StructuredScript;
  frames: FrameRef[];
}) {
  return (
    <div className="space-y-8">
      {/* O gancho ganha destaque proprio: e o ativo que a ferramenta existe para colecionar. */}
      <section className="rounded-2xl border border-signal-dim bg-signal-wash/40 p-6">
        <div className="flex items-center gap-2.5">
          <span className="rounded-md bg-signal px-2 py-0.5 text-[11px] font-semibold text-void">
            gancho
          </span>
          <span className="tabular text-[11px] text-signal">
            {script.hook.spanSeconds.toFixed(1)}s
          </span>
          <span className="rounded-md border border-signal-dim px-2 py-0.5 text-[11px] text-signal">
            {script.hook.kind}
          </span>
        </div>

        <p className="mt-4 font-display text-xl leading-snug font-medium text-ink">
          “{script.hook.text}”
        </p>

        {script.hook.onScreenText && (
          <p className="mt-3 text-[13px] text-ink-dim">
            <span className="text-ink-faint">na tela: </span>
            <span className="font-mono">{script.hook.onScreenText}</span>
          </p>
        )}

        <p className="mt-4 border-t border-signal-dim/40 pt-4 text-[13px] leading-relaxed text-ink-dim">
          {script.hook.rationale}
        </p>
      </section>

      <section>
        <p className="text-[13px] leading-relaxed text-ink-dim">{script.summary}</p>
        {script.cta && (
          <p className="mt-2 text-[13px] text-ink-dim">
            <span className="text-ink-faint">CTA: </span>
            {script.cta}
          </p>
        )}
      </section>

      <section>
        <h2 className="mb-4 text-[11px] font-medium uppercase tracking-[0.12em] text-ink-faint">
          Roteiro, bloco a bloco
        </h2>

        <ol className="space-y-px overflow-hidden rounded-2xl border border-line">
          {script.blocks.map((bloco, i) => (
            <Bloco
              key={`${bloco.tIn}-${i}`}
              bloco={bloco}
              frames={frames.filter((f) => f.seconds >= bloco.tIn && f.seconds < bloco.tOut)}
            />
          ))}
        </ol>
      </section>
    </div>
  );
}

function Bloco({ bloco, frames }: { bloco: ScriptBlock; frames: FrameRef[] }) {
  return (
    <li className="grid grid-cols-1 gap-5 bg-surface p-5 sm:grid-cols-[7rem_1fr_auto]">
      <div>
        <p className="tabular text-[12px] text-ink">
          {tempo(bloco.tIn)}
          <span className="text-ink-faint"> → </span>
          {tempo(bloco.tOut)}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
              bloco.role === 'gancho'
                ? 'bg-signal text-void'
                : bloco.role === 'cta'
                  ? 'bg-live/15 text-live'
                  : 'bg-raised text-ink-faint'
            }`}
          >
            {ROTULO_ROLE[bloco.role]}
          </span>
          {bloco.isBRoll && (
            <span className="rounded border border-line-bright px-1.5 py-0.5 text-[10px] text-ink-faint">
              b-roll
            </span>
          )}
        </div>
        {bloco.cutCount > 0 && (
          <p className="tabular mt-2 text-[11px] text-ink-faint">
            {bloco.cutCount} corte{bloco.cutCount > 1 ? 's' : ''}
          </p>
        )}
      </div>

      <div className="min-w-0 space-y-3">
        {bloco.speech ? (
          <p className="text-[14px] leading-relaxed text-ink">{bloco.speech}</p>
        ) : (
          <p className="text-[13px] italic text-ink-faint">sem fala neste trecho</p>
        )}

        {bloco.onScreenText && (
          <p className="rounded-lg border border-line bg-void px-3 py-2 font-mono text-[12px] text-signal">
            {bloco.onScreenText}
          </p>
        )}

        <p className="text-[13px] leading-relaxed text-ink-faint">{bloco.scene}</p>
      </div>

      {frames.length > 0 && (
        <div className="flex gap-1.5">
          {frames.slice(0, 3).map((frame) => (
            <img
              key={frame.seconds}
              src={frame.url}
              alt={`quadro aos ${frame.seconds.toFixed(1)}s`}
              className="h-24 w-auto rounded-lg border border-line object-cover"
            />
          ))}
        </div>
      )}
    </li>
  );
}
