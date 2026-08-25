import { analysisProviders, media, models, type AnalysisProvider } from '@molde/config';
import { logger, type Logger } from '../logger';
import {
  estruturarRoteiro as roteiroAnthropic,
  sintetizarPerfil as perfilAnthropic,
} from './anthropic';
import {
  estruturarRoteiro as roteiroDeepseek,
  sintetizarPerfil as perfilDeepseek,
} from './deepseek';
import {
  estruturarRoteiro as roteiroGemini,
  sintetizarPerfil as perfilGemini,
} from './gemini';
import {
  estruturarRoteiro as roteiroGroq,
  sintetizarPerfil as perfilGroq,
} from './groq-vision';
import type {
  ContextoPerfil,
  ContextoVideo,
  EstruturaResultado,
  SinteseResultado,
} from './prompt';

export type {
  ContextoPerfil,
  ContextoVideo,
  EstruturaResultado,
  PostDestacado,
  SinteseResultado,
} from './prompt';

/**
 * Ponto unico de entrada da analise, com provedor reserva.
 *
 * Quem escolhe o provedor preferido e `models.analysis` no packages/config. Mas
 * provedor de IA gratuito cai: fica sobrecarregado ("high demand"), estoura cota
 * do dia, derruba a conexao. Quando isso acontece no meio de um job, perder o
 * trabalho todo — audio ja transcrito, quadros ja extraidos — por causa de um
 * pico de trafego do outro lado seria absurdo.
 *
 * Entao aqui a analise tenta o provedor escolhido e, se ele falhar por qualquer
 * motivo, segue para o proximo que tenha chave configurada. So no fim, se
 * nenhum funcionar, o job falha — e a mensagem diz o que CADA um respondeu, em
 * vez de esconder tudo atras do erro do ultimo.
 *
 * Regra de dinheiro: a queda automatica so acontece para provedor GRATUITO. Se
 * o provedor escolhido ja e pago, ai sim qualquer outro entra na fila — porque
 * nesse caso gastar ja era a decisao de quem configurou.
 */

interface Entrada {
  perfil: AnalysisProvider;
  /** Variavel de ambiente sem a qual nem vale a pena tentar este provedor. */
  chaveEnv: string;
  roteiro: (ctx: ContextoVideo, log?: Logger) => Promise<EstruturaResultado>;
  sintese: (ctx: ContextoPerfil, log?: Logger) => Promise<SinteseResultado>;
}

const PROVEDORES: Record<AnalysisProvider['provider'], Entrada> = {
  gemini: {
    perfil: analysisProviders.gemini,
    chaveEnv: 'GEMINI_API_KEY',
    roteiro: roteiroGemini,
    sintese: perfilGemini,
  },
  groq: {
    perfil: analysisProviders.groq,
    chaveEnv: 'GROQ_API_KEY',
    roteiro: roteiroGroq,
    sintese: perfilGroq,
  },
  deepseek: {
    perfil: analysisProviders.deepseek,
    chaveEnv: 'DEEPSEEK_API_KEY',
    roteiro: roteiroDeepseek,
    sintese: perfilDeepseek,
  },
  anthropic: {
    perfil: analysisProviders.anthropic,
    chaveEnv: 'ANTHROPIC_API_KEY',
    roteiro: roteiroAnthropic,
    sintese: perfilAnthropic,
  },
};

/** Ordem de preferencia da reserva: melhor resultado primeiro. */
const ORDEM_DE_RESERVA: Array<AnalysisProvider['provider']> = [
  'gemini',
  'groq',
  'deepseek',
  'anthropic',
];

function ehGratuito(p: AnalysisProvider): boolean {
  return p.usdPerMillionInput === 0 && p.usdPerMillionOutput === 0;
}

function temChave(e: Entrada): boolean {
  return Boolean(process.env[e.chaveEnv]?.trim());
}

/**
 * O escolhido sempre vem primeiro, mesmo sem chave: assim, quando o problema e
 * chave faltando, a mensagem dele aparece no relatorio em vez de sumir atras de
 * uma troca silenciosa de provedor.
 */
function fila(): Entrada[] {
  const escolhido = PROVEDORES[models.analysis.provider];
  const jaEPago = !ehGratuito(escolhido.perfil);

  const reservas = ORDEM_DE_RESERVA.filter((nome) => nome !== models.analysis.provider)
    .map((nome) => PROVEDORES[nome])
    .filter((e) => temChave(e))
    .filter((e) => jaEPago || ehGratuito(e.perfil));

  return [escolhido, ...reservas];
}

/**
 * Cada provedor aceita um numero diferente de imagens por requisicao — o Groq
 * gratuito aceita 5, o Gemini 24. Os quadros foram amostrados para o provedor
 * escolhido, entao ao cair para outro e preciso reduzir; o corte preserva a
 * fatia do gancho, que e a parte que mais importa no roteiro.
 */
function limitarFrames(ctx: ContextoVideo, teto: number): ContextoVideo {
  if (ctx.frames.length <= teto) return ctx;

  const janela = Math.min(media.hookWindowSeconds, ctx.durationSeconds);
  const gancho = ctx.frames.filter((f) => f.seconds <= janela);
  const corpo = ctx.frames.filter((f) => f.seconds > janela);

  const vagasGancho = Math.min(
    gancho.length,
    Math.max(1, Math.round(teto * media.frames.hookFrameShare)),
  );
  const vagasCorpo = teto - vagasGancho;

  function espalhar<T>(lista: T[], quantas: number): T[] {
    if (quantas <= 0) return [];
    if (lista.length <= quantas) return lista;
    const passo = lista.length / quantas;
    const saida: T[] = [];
    for (let i = 0; i < quantas; i++) {
      const item = lista[Math.floor(i * passo)];
      if (item !== undefined) saida.push(item);
    }
    return saida;
  }

  return {
    ...ctx,
    frames: [...espalhar(gancho, vagasGancho), ...espalhar(corpo, vagasCorpo)].sort(
      (a, b) => a.seconds - b.seconds,
    ),
  };
}

function motivoDe(erro: unknown): string {
  return erro instanceof Error ? erro.message : String(erro);
}

async function comReserva<T>(
  etapa: string,
  executar: (e: Entrada) => Promise<T>,
  log: Logger,
): Promise<T> {
  const candidatos = fila();
  const falhas: string[] = [];

  for (const [i, e] of candidatos.entries()) {
    if (i > 0) {
      log.warn('tentando pelo provedor reserva', {
        etapa,
        provedor: e.perfil.provider,
        modelo: e.perfil.model,
        jaFalharam: falhas.length,
      });
    }

    try {
      return await executar(e);
    } catch (erro) {
      const motivo = motivoDe(erro);
      falhas.push(`${e.perfil.provider} → ${motivo}`);

      if (i === candidatos.length - 1) break;

      log.warn('provedor de IA nao concluiu; caindo para o proximo', {
        etapa,
        provedor: e.perfil.provider,
        motivo,
      });
    }
  }

  // A mensagem carrega o que CADA provedor respondeu: com um so motivo, o
  // diagnostico costuma apontar para o lugar errado.
  throw new Error(
    `Nenhum provedor de IA conseguiu ${etapa}. ${falhas.length === 1 ? 'O provedor respondeu' : 'Cada um respondeu'}: ${falhas.join(' | ')}`,
  );
}

/** Roteiro anotado do video, pelo provedor ativo — ou pelo reserva, se precisar. */
export async function estruturarRoteiro(
  ctx: ContextoVideo,
  log: Logger = logger,
): Promise<EstruturaResultado> {
  return comReserva(
    'montar o roteiro',
    (e) => e.roteiro(limitarFrames(ctx, e.perfil.maxImages), log),
    log,
  );
}

/** Sintese do perfil, pelo mesmo caminho de reserva. */
export async function sintetizarPerfil(
  ctx: ContextoPerfil,
  log: Logger = logger,
): Promise<SinteseResultado> {
  return comReserva('sintetizar o perfil', (e) => e.sintese(ctx, log), log);
}
