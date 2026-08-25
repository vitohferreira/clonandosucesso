/**
 * Liga o worker sozinho quando um trabalho entra na fila.
 *
 * Sem isso, todo job fica parado ate voce lembrar de abrir o GitHub e apertar
 * "Run workflow" — o que e uma fricção que ninguém aguenta no uso diario.
 *
 * E melhor-esforço de propósito: se o disparo falhar (token ausente, expirado,
 * sem permissão), o job continua na fila e o botão manual segue funcionando.
 * Enfileirar nunca pode falhar por causa disto.
 */
const WORKFLOW = 'worker.yml';

/** Descobre a branch padrão do repositório, para nao precisar configurar. */
let branchPadrao: string | null = null;

async function acharBranch(repo: string, token: string): Promise<string> {
  if (branchPadrao) return branchPadrao;

  const r = await fetch(`https://api.github.com/repos/${repo}`, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
    },
  });

  if (!r.ok) throw new Error(`GitHub recusou a consulta do repositório (HTTP ${r.status})`);

  const dados = (await r.json()) as { default_branch?: string };
  branchPadrao = dados.default_branch ?? 'main';
  return branchPadrao;
}

export interface ResultadoDisparo {
  disparado: boolean;
  motivo?: string;
}

export async function ligarWorker(minutos = '10'): Promise<ResultadoDisparo> {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;

  if (!token || !repo) {
    return { disparado: false, motivo: 'auto-start não configurado' };
  }

  try {
    const ref = await acharBranch(repo, token);

    const r = await fetch(
      `https://api.github.com/repos/${repo}/actions/workflows/${WORKFLOW}/dispatches`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/vnd.github+json',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ ref, inputs: { minutos } }),
      },
    );

    // 204 e a resposta de sucesso deste endpoint.
    if (r.status === 204) return { disparado: true };

    const detalhe = await r.text().catch(() => '');
    return {
      disparado: false,
      motivo: `GitHub respondeu ${r.status}${detalhe ? `: ${detalhe.slice(0, 160)}` : ''}`,
    };
  } catch (erro) {
    return {
      disparado: false,
      motivo: erro instanceof Error ? erro.message : 'falha ao falar com o GitHub',
    };
  }
}

/**
 * Se ja existe um worker rodando, nao adianta disparar outro: ele pegaria a fila
 * vazia. Consultamos as execucoes em andamento antes.
 */
export async function jaTemWorkerRodando(): Promise<boolean> {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;
  if (!token || !repo) return false;

  try {
    const r = await fetch(
      `https://api.github.com/repos/${repo}/actions/workflows/${WORKFLOW}/runs?status=in_progress&per_page=1`,
      {
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/vnd.github+json',
        },
        cache: 'no-store',
      },
    );

    if (!r.ok) return false;
    const dados = (await r.json()) as { total_count?: number };
    return (dados.total_count ?? 0) > 0;
  } catch {
    return false;
  }
}
