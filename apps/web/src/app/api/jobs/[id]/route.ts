import { NextResponse } from 'next/server';
import { getJob } from '@molde/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    const job = await getJob(id);
    if (!job) return NextResponse.json({ error: 'job nao encontrado' }, { status: 404 });
    return NextResponse.json({ job });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'erro ao buscar job' },
      { status: 500 },
    );
  }
}
