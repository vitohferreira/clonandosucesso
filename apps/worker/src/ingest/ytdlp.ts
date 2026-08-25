import { spawn } from 'node:child_process';
import { ingest, seguranca } from '@molde/config';
import type { Logger } from '../logger';
import { conferirArgumentos } from './seguranca';

/**
 * Camada 1: yt-dlp, deslogado.
 *
 * Nao escrevemos extrator proprio de Instagram de proposito. O yt-dlp e mantido
 * por muita gente, acompanha as mudancas da plataforma e se atualiza com um
 * comando. Um extrator nosso seria uma divida que vence toda vez que o
 * Instagram mexe no HTML.
 *
 * O que ele NUNCA recebe daqui: cookie, sessao, usuario, senha. A lista de
 * argumentos passa pela trava de `seguranca.ts` antes de virar processo.
 */

export interface FormatoDisponivel {
  formatId: string;
  ext: string;
  width: number | null;
  height: number | null;
  filesize: number | null;
  hasAudio: boolean;
}

export interface ItemDoYtdlp {
  id: string;
  shortcode: string | null;
  url: string | null;
  tituloOuLegenda: string | null;
  uploader: string | null;
  duracaoS: number | null;
  publicadoEm: string | null;
  thumbnail: string | null;
  /** Metricas so vem se o Instagram devolver — muitas vezes nao vem. */
  curtidas: number | null;
  comentarios: number | null;
  visualizacoes: number | null;
  ehVideo: boolean;
  formatos: FormatoDisponivel[];
}

export type ResultadoYtdlp =
  | { ok: true; itens: ItemDoYtdlp[]; segundos: number }
  | { ok: false; motivo: MotivoDeFalha; mensagem: string; segundos: number };

/**
 * Por que falhou. Isto vira estatistica na tela — sem separar os motivos, um
 * contador de "falhou" nao diz se o problema e o Instagram exigindo login, o
 * link estar errado, ou o yt-dlp nem estar instalado.
 */
export type MotivoDeFalha =
  | 'exige_login'
  | 'privado'
  | 'nao_existe'
  | 'sem_video'
  | 'ytdlp_ausente'
  | 'tempo_esgotado'
  | 'outro';

const PADROES: Array<[RegExp, MotivoDeFalha]> = [
  [/login required|requested content is not available|rate.?limit|429|checkpoint|please wait a few minutes/i, 'exige_login'],
  [/private|this account is private/i, 'privado'],
  [/not found|does not exist|unavailable|removed|410|404/i, 'nao_existe'],
  [/no video|there.s no video/i, 'sem_video'],
];

function classificar(saida: string): MotivoDeFalha {
  for (const [padrao, motivo] of PADROES) {
    if (padrao.test(saida)) return motivo;
  }
  return 'outro';
}

/** Converte uma linha de json do yt-dlp no nosso formato. */
function traduzir(bruto: Record<string, unknown>): ItemDoYtdlp {
  const n = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const s = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

  const formatos = Array.isArray(bruto.formats)
    ? (bruto.formats as Array<Record<string, unknown>>).map((f) => ({
        formatId: String(f.format_id ?? ''),
        ext: String(f.ext ?? ''),
        width: n(f.width),
        height: n(f.height),
        filesize: n(f.filesize) ?? n(f.filesize_approx),
        hasAudio: f.acodec !== 'none' && f.acodec !== undefined,
      }))
    : [];

  const timestamp = n(bruto.timestamp);

  return {
    id: String(bruto.id ?? ''),
    shortcode: s(bruto.display_id) ?? s(bruto.id),
    url: s(bruto.webpage_url),
    tituloOuLegenda: s(bruto.description) ?? s(bruto.title),
    uploader: s(bruto.uploader_id) ?? s(bruto.uploader) ?? s(bruto.channel),
    duracaoS: n(bruto.duration),
    publicadoEm: timestamp ? new Date(timestamp * 1000).toISOString() : null,
    thumbnail: s(bruto.thumbnail),
    curtidas: n(bruto.like_count),
    comentarios: n(bruto.comment_count),
    visualizacoes: n(bruto.view_count),
    ehVideo: formatos.some((f) => f.ext === 'mp4') || n(bruto.duration) !== null,
    formatos,
  };
}

/**
 * Monta a linha de comando. Separado da execucao para poder ser conferido —
 * e testado — sem disparar processo nenhum.
 */
export function montarArgumentos(
  url: string,
  opcoes: { maxItens?: number; listagem?: boolean } = {},
): string[] {
  const argv = [
    '--dump-single-json',
    '--no-warnings',
    '--no-progress',
    // As duas linhas que garantem que nenhum cookie seu vai junto. Nao existe
    // `--no-netrc`: o `--netrc` e opt-in, entao basta nunca pedir — e a trava
    // abaixo impede que alguem peca.
    '--no-cookies',
    '--no-cookies-from-browser',
    // Educacao com o servidor dos outros, mesmo deslogado.
    '--sleep-requests', '2',
    '--user-agent', seguranca.userAgent,
    '--socket-timeout', '30',
    // Nada e baixado nesta etapa: so metadado.
    '--skip-download',
  ];

  // Listar um perfil pede o modo raso: uma requisicao para a lista inteira, em
  // vez de uma por video. Para UM post o modo raso seria contraproducente —
  // devolveria um esqueleto justamente sem os campos que queremos medir.
  if (opcoes.listagem) argv.push('--flat-playlist');

  if (opcoes.maxItens) argv.push('--playlist-end', String(opcoes.maxItens));
  argv.push(url);

  // A trava, aplicada no ponto exato em que a linha vira comando.
  conferirArgumentos(argv);
  return argv;
}

/** Roda o yt-dlp e devolve o que veio, sem interpretar demais. */
export async function consultar(
  url: string,
  log: Logger,
  opcoes: { maxItens?: number; listagem?: boolean } = {},
): Promise<ResultadoYtdlp> {
  const comecou = Date.now();
  const argv = montarArgumentos(url, opcoes);

  log.info('camada 1 (yt-dlp): consultando', {
    url,
    modo: opcoes.listagem ? 'listagem rasa' : 'post completo',
    maxItens: opcoes.maxItens ?? null,
  });

  return new Promise<ResultadoYtdlp>((resolve) => {
    const proc = spawn('yt-dlp', argv, { stdio: ['ignore', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';
    let encerrado = false;

    const relogio = setTimeout(() => {
      encerrado = true;
      proc.kill('SIGKILL');
      resolve({
        ok: false,
        motivo: 'tempo_esgotado',
        mensagem: `O yt-dlp passou de ${ingest.timeoutMs / 1000}s sem responder.`,
        segundos: (Date.now() - comecou) / 1000,
      });
    }, ingest.timeoutMs);

    proc.stdout.on('data', (d) => { stdout += String(d); });
    proc.stderr.on('data', (d) => { stderr += String(d); });

    proc.on('error', (erro) => {
      clearTimeout(relogio);
      if (encerrado) return;
      const ausente = (erro as NodeJS.ErrnoException).code === 'ENOENT';
      resolve({
        ok: false,
        motivo: ausente ? 'ytdlp_ausente' : 'outro',
        mensagem: ausente
          ? 'O yt-dlp nao esta instalado neste worker. Confira o passo de instalacao no workflow.'
          : erro.message,
        segundos: (Date.now() - comecou) / 1000,
      });
    });

    proc.on('close', (codigo) => {
      clearTimeout(relogio);
      if (encerrado) return;
      const segundos = Number(((Date.now() - comecou) / 1000).toFixed(1));

      if (codigo !== 0 || !stdout.trim()) {
        const mensagem = (stderr || stdout).trim().slice(0, 600) || `yt-dlp saiu com codigo ${codigo}`;
        return resolve({ ok: false, motivo: classificar(mensagem), mensagem, segundos });
      }

      try {
        const dados = JSON.parse(stdout) as Record<string, unknown>;
        // Perfil vem como playlist; post vem como item unico.
        const bruto = Array.isArray(dados.entries)
          ? (dados.entries as Array<Record<string, unknown>>)
          : [dados];
        resolve({ ok: true, itens: bruto.map(traduzir), segundos });
      } catch (erro) {
        resolve({
          ok: false,
          motivo: 'outro',
          mensagem: `Nao consegui ler a resposta do yt-dlp: ${(erro as Error).message}`,
          segundos,
        });
      }
    });
  });
}
