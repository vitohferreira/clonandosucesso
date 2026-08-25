import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { createUploadUrl } from '@molde/db';

export const runtime = 'nodejs';

/**
 * Devolve uma URL para o browser enviar o video DIRETO ao Supabase Storage.
 *
 * O arquivo nao passa por aqui de proposito: o corpo de uma route handler na
 * Vercel morre por volta de 4,5 MB, e um reel de 90s passa disso facil.
 */
const EXTENSOES_ACEITAS = ['mp4', 'mov', 'm4v', 'webm', 'mkv'];
const TAMANHO_MAXIMO = 500 * 1024 * 1024;

export async function POST(request: Request) {
  let body: { filename?: unknown; sizeBytes?: unknown; contentType?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'corpo invalido' }, { status: 400 });
  }

  const filename = typeof body.filename === 'string' ? body.filename : '';
  const sizeBytes = typeof body.sizeBytes === 'number' ? body.sizeBytes : 0;
  const contentType = typeof body.contentType === 'string' ? body.contentType : '';

  if (!filename || sizeBytes <= 0) {
    return NextResponse.json({ error: 'informe filename e sizeBytes' }, { status: 400 });
  }
  if (sizeBytes > TAMANHO_MAXIMO) {
    return NextResponse.json(
      { error: `Arquivo de ${(sizeBytes / 1024 / 1024).toFixed(0)} MB. O limite é 500 MB.` },
      { status: 413 },
    );
  }
  // Validamos pela EXTENSÃO, não pelo MIME: o navegador reporta o tipo de forma
  // inconsistente, e recusar por isso rejeita arquivo bom.
  const extensao = filename.split('.').pop()?.toLowerCase() ?? '';
  if (!EXTENSOES_ACEITAS.includes(extensao)) {
    return NextResponse.json(
      {
        error: `Arquivo .${extensao || '?'} não aceito. Use MP4, MOV, M4V, WebM ou MKV.`,
      },
      { status: 415 },
    );
  }
  void contentType;

  // Nome higienizado: o original vira metadado, nao caminho.
  const seguro = filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
  const path = `uploads/${randomUUID()}/${seguro}`;

  try {
    const assinado = await createUploadUrl(path);
    return NextResponse.json(assinado);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'erro ao assinar upload' },
      { status: 500 },
    );
  }
}
