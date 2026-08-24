import { listJobs, remainingToday } from '@molde/db';
import type { JobRow } from '@molde/shared';
import { Dashboard, type LimitsSnapshot } from '@/components/Dashboard';

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
        <div className="mt-6 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
          <p className="text-sm text-amber-300">Nao consegui falar com o Supabase.</p>
          <pre className="mt-3 overflow-x-auto font-mono text-[11px] text-amber-200/70">
            {setupError}
          </pre>
          <p className="mt-3 text-xs text-zinc-400">
            Confira SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no .env e se as migrations de
            supabase/migrations ja foram aplicadas.
          </p>
        </div>
      </main>
    );
  }

  return <Dashboard initialJobs={jobs} initialLimits={limits} />;
}
