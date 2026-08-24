import { listJobs, remainingToday } from '@molde/db';
import type { JobRow } from '@molde/shared';
import { Dashboard, type LimitsSnapshot } from '@/components/Dashboard';
import { Shell } from '@/components/Shell';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  // Busca direto no servidor: sem round-trip HTTP no primeiro render.
  // Se o banco ainda nao estiver configurado, a tela abre com um aviso em vez
  // de estourar uma pagina de erro.
  let jobs: JobRow[] = [];
  let limits: LimitsSnapshot | null = null;
  let setupError: string | null = null;

  try {
    [jobs, limits] = await Promise.all([listJobs(50), remainingToday()]);
  } catch (error) {
    setupError = error instanceof Error ? error.message : 'erro desconhecido';
  }

  if (setupError) {
    return (
      <main className="mx-auto max-w-2xl p-10">
        <h1 className="text-2xl font-semibold tracking-tight">Molde</h1>
        <div className="mt-6 rounded-xl border border-signal-dim bg-signal-wash p-4">
          <p className="text-sm text-signal">Nao consegui falar com o Supabase.</p>
          <pre className="mt-3 overflow-x-auto font-mono text-[11px] text-signal">
            {setupError}
          </pre>
          <p className="mt-3 text-xs text-ink-faint">
            Confira SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no .env e se as migrations de
            supabase/migrations ja foram aplicadas.
          </p>
        </div>
      </main>
    );
  }

  return (
    <Shell>
      <Dashboard initialJobs={jobs} initialLimits={limits} />
    </Shell>
  );
}
