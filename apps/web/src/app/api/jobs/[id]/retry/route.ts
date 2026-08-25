import { NextResponse } from 'next/server';
import { createJob, getJob } from '@molde/db';
import { createJobSchema } from '@molde/shared';
import { jaTemWorkerRodando, ligarWorker } from '@/lib/github';

export const runtime = 'nodejs';

/**
 * Reenfileira um trabalho que falhou.
 *
 * Existe porque a alternativa era reenviar o vídeo inteiro por causa de um erro
 * que já foi corrigido — e o arquivo continua no Storage, então não há motivo.
 *
 * Cria um job NOVO em vez de reviver o antigo: o histórico de falha é registro,
 * e apagá-lo esconderia o que aconteceu.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    const anterior = await getJob(id);
    if (!anterior) return NextResponse.json({ error: 'job não encontrado' }, { status: 404 });

    if (anterior.status === 'running' || anterior.status === 'queued') {
      return NextResponse.json(
        { error: 'esse trabalho ainda está em andamento' },
        { status: 409 },
      );
    }

    const parsed = createJobSchema.safeParse({
      type: anterior.type,
      payload: anterior.payload,
    });

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'o formato desse trabalho mudou desde então; refaça o envio' },
        { status: 422 },
      );
    }

    const job = await createJob(parsed.data);

    const disparo = (await jaTemWorkerRodando())
      ? { disparado: true, motivo: 'worker já estava rodando' }
      : await ligarWorker();

    return NextResponse.json({ job, worker: disparo }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'erro ao repetir' },
      { status: 500 },
    );
  }
}
