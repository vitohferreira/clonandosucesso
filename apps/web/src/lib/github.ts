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

/**
 * O tempo aqui e TETO, nao consumo: o worker encerra sozinho assim que a fila
 * esvazia. Ele so precisa ser grande o bastante para caber o job mais longo —
 * uma analise de perfil com varios videos passa dos 10 minutos com folga.
 */
export async function ligarWorker(minutos = '30'): Promise<ResultadoDisparo> {
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
 * Se ja existe um worker rodando O CODIGO ATUAL, nao adianta disparar outro:
 * ele pegaria a fila vazia.
 *
 * A parte "o codigo atual" nao e detalhe. Um worker carrega o codigo UMA vez, ao
 * iniciar. Um worker de pe desde antes do ultimo deploy processa trabalhos novos
 * com o codigo antigo — entao suprimir o disparo por causa dele faria a correcao
 * recem-publicada parecer que nao funcionou. Por isso comparamos o commit: se o
 * que esta rodando e outro, vale a pena subir um worker novo, mesmo custando
 * alguns minutos de Action.
 *
 * O worker anuncia o commit que carregou na primeira linha do log, para esse
 * descompasso continuar visivel quando acontecer.
 */
export async function jaTemWorkerRodando(): Promise<boolean> {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;
  if (!token || !repo) return false;

  try {
    const r = await fetch(
      `https://api.github.com/repos/${repo}/actions/workflows/${WORKFLOW}/runs?per_page=20`,
      {
        headers: {
          authorization: `Bearer ${token}`,
          accept: 'application/vnd.github+json',
        },
        cache: 'no-store',
      },
    );

    if (!r.ok) return false;

    const dados = (await r.json()) as {
      workflow_runs?: Array<{ status?: string; head_sha?: string; run_started_at?: string }>;
    };

    const emAndamento = (dados.workflow_runs ?? []).filter(
      (run) => run.status === 'queued' || run.status === 'in_progress' || run.status === 'waiting',
    );

    if (emAndamento.length === 0) return false;

    // O commit que a Vercel publicou e o que o worker DEVERIA estar rodando.
    const commitAtual = process.env.VERCEL_GIT_COMMIT_SHA?.trim();
    if (!commitAtual) return true; // sem como comparar, mantem o cuidado antigo

    return emAndamento.some((run) => run.head_sha === commitAtual);
  } catch {
    return false;
  }
}
