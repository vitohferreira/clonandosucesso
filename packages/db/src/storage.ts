import { serviceClient } from './client';

/**
 * Supabase Storage — bucket `media`.
 *
 * Guarda o video enviado (que e apagado assim que processado), o audio extraido
 * e os frames. O bucket e privado: todo acesso passa por URL assinada gerada no
 * servidor.
 */
export const MEDIA_BUCKET = 'media';

/**
 * URL para o browser enviar o arquivo DIRETO ao Storage.
 *
 * O upload nao passa pela API do Next de proposito: o corpo de uma route
 * handler na Vercel morre por volta de 4,5 MB, e um reel de 90s passa disso
 * facil. A API so devolve esta URL e registra o job.
 */
export async function createUploadUrl(
  path: string,
): Promise<{ path: string; token: string; uploadUrl: string }> {
  const res = await serviceClient().storage.from(MEDIA_BUCKET).createSignedUploadUrl(path);
  if (res.error) throw new Error(`createUploadUrl(${path}): ${res.error.message}`);

  // Dependendo da versao, o supabase-js devolve a URL absoluta ou so o caminho.
  // Normalizamos aqui para o browser nunca precisar montar isso.
  const bruto = res.data.signedUrl;
  const uploadUrl = bruto.startsWith('http')
    ? bruto
    : `${process.env.SUPABASE_URL}/storage/v1${bruto.startsWith('/') ? '' : '/'}${bruto}`;

  return { path: res.data.path, token: res.data.token, uploadUrl };
}

/** URL temporaria de leitura, para mostrar thumbnail ou tocar o video na tela. */
export async function createReadUrl(path: string, expiresInSeconds = 3600): Promise<string> {
  const res = await serviceClient()
    .storage.from(MEDIA_BUCKET)
    .createSignedUrl(path, expiresInSeconds);
  if (res.error) throw new Error(`createReadUrl(${path}): ${res.error.message}`);
  return res.data.signedUrl;
}

/** Baixa um arquivo do Storage para memoria. Usado pelo worker. */
export async function downloadFile(path: string): Promise<Buffer> {
  const res = await serviceClient().storage.from(MEDIA_BUCKET).download(path);
  if (res.error) throw new Error(`downloadFile(${path}): ${res.error.message}`);
  return Buffer.from(await res.data.arrayBuffer());
}

export async function uploadFile(
  path: string,
  body: Buffer,
  contentType: string,
): Promise<string> {
  const res = await serviceClient()
    .storage.from(MEDIA_BUCKET)
    .upload(path, body, { contentType, upsert: true });
  if (res.error) throw new Error(`uploadFile(${path}): ${res.error.message}`);
  return res.data.path;
}

/**
 * Apaga arquivos. O mp4 original e removido assim que o roteiro fica pronto:
 * ele nao serve para mais nada, ocupa o storage inteiro do plano gratuito, e
 * guardar video dos outros indefinidamente nao e uma boa ideia.
 */
export async function removeFiles(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const res = await serviceClient().storage.from(MEDIA_BUCKET).remove(paths);
  if (res.error) throw new Error(`removeFiles: ${res.error.message}`);
}
