import { listJobs, placarDeCamadas, remainingToday } from '@molde/db';
import type { PlacarDeCamadas } from '@molde/db';
import type { JobRow } from '@molde/shared';
import { Dashboard, type LimitsSnapshot } from '@/components/Dashboard';
import { PlacarCamadas } from '@/components/PlacarCamadas';
import { SondarLink } from '@/components/SondarLink';
import { Shell } from '@/components/Shell';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  // Busca direto no servidor: sem round-trip HTTP no primeiro render.
  // Se o banco ainda nao estiver configurado, a tela abre com um aviso em vez
  // de estourar uma pagina de erro.
  let jobs: JobRow[] = [];
  let limits: LimitsSnapshot | null = null;
  let placar: PlacarDeCamadas | null = null;
  let setupError: string | null = null;

  try {
    [jobs, limits, placar] = await Promise.all([
      listJobs(50),
      remainingToday(),
      placarDeCamadas(),
    ]);
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
      <div className="space-y-5">
        <SondarLink />
        {placar && <PlacarCamadas placar={placar} />}
        <Dashboard initialJobs={jobs} initialLimits={limits} />
      </div>
    </Shell>
  );
}
