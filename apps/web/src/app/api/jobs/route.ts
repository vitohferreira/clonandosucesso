import { NextResponse } from 'next/server';
import { createJob, listJobs, remainingToday } from '@molde/db';
import { createJobSchema } from '@molde/shared';
import { jaTemWorkerRodando, ligarWorker } from '@/lib/github';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Fila + consumo dos tetos de hoje, que e o que o dashboard mostra. */
export async function GET() {
  try {
    const [jobs, limits] = await Promise.all([listJobs(50), remainingToday()]);
    return NextResponse.json({ jobs, limits });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'erro ao listar jobs' },
      { status: 500 },
    );
  }
}

/**
 * Enfileira um job. Valida com o mesmo schema que o worker usa para ler o
 * payload — payload errado morre aqui, e nao 40 minutos depois no worker.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'corpo invalido' }, { status: 400 });
  }

  const parsed = createJobSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'payload invalido', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const job = await createJob(parsed.data);

    // Liga o worker sozinho. Melhor-esforço: se falhar, o job continua na fila e
    // o botão manual no GitHub segue funcionando — enfileirar nunca pode falhar
    // por causa disto.
    const disparo = (await jaTemWorkerRodando())
      ? { disparado: true, motivo: 'worker já estava rodando' }
      : await ligarWorker();

    return NextResponse.json({ job, worker: disparo }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'erro ao criar job' },
      { status: 500 },
    );
  }
}
