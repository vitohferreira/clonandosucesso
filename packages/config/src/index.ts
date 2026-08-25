/**
 * Molde — arquivo de configuracao unico.
 *
 * Todo numero que governa comportamento vive aqui. Se voce precisar mexer em
 * "quantos posts por dia" ou "qual multiplo conta como outlier", e neste arquivo,
 * em lugar nenhum mais.
 *
 * Os tetos diarios (dailyCaps) tambem podem ser sobrescritos pela tabela
 * `settings` do banco, chave `daily_caps`, para ajustar sem redeploy do worker.
 */

/**
 * Fuso usado em TODA agregacao por data e hora: cadencia de publicacao,
 * "dias e horarios que o perfil posta", e a virada do dia dos tetos diarios.
 * Calcular isso em UTC daria conclusao errada por 3 horas.
 */
export const TIMEZONE = 'America/Sao_Paulo';

/**
 * ESCOPO CONGELADO.
 *
 * Tudo aqui esta construido e continua no repositorio, mas fora do caminho de
 * execucao: nao roda, nao aparece na tela, nao quebra o build. Ligar de novo e
 * trocar `false` por `true` — nenhum codigo foi apagado.
 */
export const escopo = {
  /** Coleta pela API oficial do Meta (Business Discovery). */
  apiDoMeta: false,
  /** Navegador com a SUA sessao logada. Ver `seguranca` abaixo. */
  sessaoLogada: false,
  /** Biblioteca de ganchos como tela e busca proprias. */
  bibliotecaDeGanchos: false,
  /** Destaques, comentarios, perfis semelhantes, embeddings. */
  destaques: false,
  comentarios: false,
  perfisSemelhantes: false,
  embeddings: false,
  /** Quadros de video e leitura de tela pelo modelo de visao. */
  analiseVisual: false,
} as const;

/**
 * SEGURANCA DA SUA CONTA.
 *
 * A regra e uma so e nao tem excecao: nenhuma credencial sua chega ao
 * Instagram. Sem login, sem cookie, sem sessao, sem senha. O que nao e enviado
 * nao pode ser associado a voce, e o que nao pode ser associado a voce nao pode
 * ser punido.
 *
 * Isto NAO e so um comentario: `apps/worker/src/ingest/seguranca.ts` conferre
 * cada chamada antes de sair, e derruba o processo se alguma credencial
 * aparecer. Uma promessa em comentario se perde na proxima refatoracao; uma
 * verificacao em codigo, nao.
 */
export const seguranca = {
  /**
   * Proibido em qualquer requisicao ao Instagram. Se alguem, um dia, tentar
   * "melhorar a taxa de sucesso" ligando cookie, o worker para na hora em vez
   * de expor a sua conta em silencio.
   */
  jamaisEnviarCredencial: true,

  /**
   * Espera aleatoria entre duas requisicoes ao Instagram, mesmo deslogado.
   * Nao e para escapar de nada: e para nao parecer rajada de robo e nao
   * atrapalhar o servidor deles.
   */
  esperaEntreRequisicoesMs: { min: 3_000, max: 9_000 },

  /** Teto de requisicoes ao Instagram por job. Rede de seguranca. */
  maxRequisicoesPorJob: 40,

  /**
   * Identificacao enviada. Um navegador comum, sem nada que finja ser outra
   * coisa nem que se passe por app oficial.
   */
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
} as const;

/**
 * Comportamento do navegador. Existe para nao parecer robo.
 * Nenhum valor aqui e fixo de proposito: intervalo fixo e assinatura de automacao.
 */
export const scraping = {
  /** Espera aleatoria entre duas acoes quaisquer, em milissegundos. */
  actionDelayMs: { min: 2_000, max: 8_000 },

  /** Espera maior depois de abrir um post ou trocar de pagina. */
  navigationDelayMs: { min: 4_000, max: 12_000 },

  /** Scroll incremental: nunca scrollTo(0, document.body.scrollHeight). */
  scroll: {
    /** Fracao da altura da viewport por passo de scroll. */
    stepRatio: { min: 0.45, max: 0.9 },
    /** Pausa entre passos de scroll. */
    pauseMs: { min: 700, max: 2_400 },
    /** Quantas rodadas sem post novo antes de considerar que o grid acabou. */
    idleRoundsBeforeStop: 3,
    /** Trava de seguranca: nunca mais que isso de passos numa sessao de scroll. */
    maxSteps: 120,
  },

  /** Timeout de carregamento de pagina. Estourar isso e falha, nao bloqueio. */
  pageTimeoutMs: 45_000,

  /** Viewport do navegador. Desktop comum, nada exotico. */
  viewport: { width: 1440, height: 900 },

  /** Locale e fuso do contexto do navegador, coerentes com o usuario real. */
  locale: 'pt-BR',
} as const;

/**
 * Tetos diarios. O dia vira a meia-noite no TIMEZONE acima, nao em UTC.
 *
 * Bater um teto NAO e falha e NAO e bloqueio: o job volta para a fila agendado
 * para o dia seguinte, e tudo que ja foi coletado continua salvo.
 */
// As chaves sao, de proposito, os nomes das colunas de `rate_limit_counters`:
// teto e consumo tem que falar a mesma lingua para nunca desalinharem.
export const dailyCaps = {
  /** Perfis novos analisados por dia. */
  profiles_analyzed: 10,
  /** Posts abertos individualmente por dia (o grid nao conta, so a abertura). */
  posts_opened: 150,
  /** Videos baixados para transcricao por dia. */
  videos_downloaded: 40,
  /** Teto duro de navegacoes, como rede de seguranca acima de tudo. */
  requests: 600,
} as const;

export type DailyCaps = typeof dailyCaps;

/**
 * Fila. O worker faz polling da tabela `jobs`, sem Redis e sem broker.
 */
export const queue = {
  /** Intervalo entre consultas quando nao ha job na fila. */
  pollIntervalMs: 5_000,
  /** Job `running` parado mais que isso = worker morreu. Vira `failed`, nunca `queued`. */
  staleJobTimeoutMs: 30 * 60_000,
  /** De quanto em quanto tempo o worker atualiza locked_at do job em andamento. */
  heartbeatMs: 60_000,
  /** Com que frequencia o worker procura jobs orfaos. */
  reaperIntervalMs: 5 * 60_000,
  /**
   * Tempo de fila vazia antes de o worker encerrar sozinho.
   *
   * Existe por causa de onde ele roda: no GitHub Actions, minuto ligado e minuto
   * gasto. Sem isto o worker fica de pe ate o fim do orcamento mesmo sem ter o
   * que fazer. Quando um trabalho novo aparece, o site sobe outro worker.
   */
  idleExitMs: 90_000,
} as const;

/**
 * Deteccao de outlier. E a peca central da ferramenta.
 *
 * A mediana NAO e global: e a mediana movel dos posts vizinhos no tempo. Um post
 * de 2 anos atras com 3x a mediana global pode ser so um perfil que era menor.
 */
export const outliers = {
  /** Quantos posts vizinhos no tempo formam a janela da mediana movel. */
  rollingWindow: 15,
  /** Minimo de posts na janela para o calculo valer alguma coisa. */
  minWindowSize: 5,
  /**
   * Post com menos dias que isso ainda esta acumulando engajamento.
   * Ele e marcado como `provisional` e fica FORA do calculo da mediana.
   */
  provisionalAfterDays: 14,
  /** Multiplos da mediana que marcam outlier de alta. */
  tiers: [2, 3, 5] as const,
  /** Abaixo desta fracao da mediana o post e marcado como underperformer (tier -1). */
  underperformerRatio: 0.4,
  /**
   * Posts fixados no topo do perfil acumulam visualizacao por estarem fixados,
   * nao por serem bons. Ficam fora da mediana.
   */
  excludePinnedFromBaseline: true,
} as const;

/**
 * Faixas de duracao de video, em segundos. O limite superior e exclusivo.
 * Cada faixa e cruzada com performance no dossie.
 */
export const durationBuckets = [
  { label: '0-15s', min: 0, max: 15 },
  { label: '15-30s', min: 15, max: 30 },
  { label: '30-60s', min: 30, max: 60 },
  { label: '60-90s', min: 60, max: 90 },
  { label: '90s+', min: 90, max: Number.POSITIVE_INFINITY },
] as const;

/**
 * Processamento de midia (ffmpeg).
 */
export const media = {
  audio: {
    /** Whisper nao ganha nada acima de 16kHz mono. Reduz o arquivo em ~10x. */
    sampleRate: 16_000,
    channels: 1,
    format: 'mp3' as const,
    bitrate: '64k',
    /** Acima disso o audio e fatiado antes de subir para o Groq. */
    maxUploadBytes: 24 * 1024 * 1024,
    /** Duracao de cada fatia quando precisa fatiar. */
    chunkSeconds: 600,
  },

  frames: {
    /**
     * Limiar de mudanca de cena do ffmpeg (`select='gt(scene,N)'`).
     * Menor = mais sensivel = mais cortes detectados.
     */
    sceneThreshold: 0.4,
    /** Teto de frames extraidos e guardados em disco. */
    maxExtracted: 200,
    /**
     * Teto de frames enviados ao modelo, quando o provedor nao impoe um menor.
     * Um reel de 90s pode gerar 100+ frames; mandar todos e caro e nao melhora a
     * analise. O limite efetivo e o MENOR entre este e `maxImages` do provedor.
     */
    maxSentToModel: 24,
    /**
     * Fracao desses frames reservada aos primeiros segundos, onde mora o gancho.
     * 0.4 = 40% dos frames vem da janela de gancho abaixo.
     */
    hookFrameShare: 0.4,
    /** Redimensionamento antes de mandar ao modelo (lado maior, em px). */
    maxEdgePx: 768,
  },

  /** Janela considerada "gancho" para isolar e classificar. */
  hookWindowSeconds: 3,

  /**
   * Teto de tamanho do arquivo enviado pelo navegador.
   *
   * NAO e escolha nossa: e o limite do plano do Supabase, e o bucket nao pode
   * passar dele. No plano gratuito sao 50 MB por arquivo; no Pro, muito mais.
   * Se voce migrar de plano, aumente aqui E no painel (Storage > Settings >
   * Global file size limit).
   *
   * Video vindo de LINK nao passa por aqui: o worker baixa direto do CDN, entao
   * esse caminho nao tem esse teto.
   */
  maxUploadBytes: 50 * 1024 * 1024,

  /**
   * O mp4 original NAO fica guardado depois do processamento: so audio, frames
   * e a analise. Storage e direitos autorais.
   */
  keepSourceVideo: false,
} as const;

/**
 * Modelos e precos. O preco esta aqui so para estimar custo por job —
 * confira em https://claude.com/pricing e https://groq.com/pricing quando mudar.
 */
/**
 * Provedores de analise disponiveis. Para trocar, mude UMA palavra em
 * `models.analysis` la embaixo — o resto do pipeline nao percebe a diferenca.
 *
 * Os precos existem so para estimar custo por job; confira na fonte quando mudar.
 */
export const analysisProviders = {
  /**
   * Gemini (Google AI Studio). A melhor opcao GRATUITA para esta tarefa: visao
   * nativa, sem teto baixo de imagens por requisicao, e saida obrigatoriamente
   * json. Le texto na tela bem melhor que o modelo gratuito do Groq.
   *
   * A cota gratuita vale enquanto o faturamento estiver DESLIGADO no projeto do
   * Google — ligar cobranca faz a camada gratuita desaparecer.
   *
   * O nome abaixo e so a PREFERENCIA: o Google renomeia modelo com frequencia,
   * e se este nao existir mais o codigo pergunta a propria API qual existe e usa
   * o melhor equivalente, sem precisar de ninguem editar nada.
   */
  gemini: {
    provider: 'gemini' as const,
    model: 'gemini-3-flash',
    maxTokens: 16_000,
    maxImages: 24,
    usdPerMillionInput: 0,
    usdPerMillionOutput: 0,
  },

  /**
   * Groq com modelo de visao. GRATUITO: usa a MESMA chave que ja transcreve o
   * audio, entao nao exige conta nova nem cartao.
   *
   * Em troca: le texto pequeno na tela com menos precisao que o Claude, e aceita
   * poucas imagens por requisicao — por isso `maxImages` e baixo aqui, e a
   * amostragem de quadros se ajusta sozinha.
   */
  groq: {
    provider: 'groq' as const,
    model: 'meta-llama/llama-4-scout-17b-16e-instruct',
    maxTokens: 8_000,
    maxImages: 5,
    usdPerMillionInput: 0,
    usdPerMillionOutput: 0,
  },

  /**
   * DeepSeek V4 Flash Vision (experimental). Bem mais barato.
   * Ressalvas que valem lembrar: nao aceita json_schema (a validacao do formato
   * e feita na aplicacao) e comprime cada imagem para no maximo 384 tokens, o
   * que dificulta ler texto pequeno na tela.
   * Precos de horario de pico, para nao subestimar o custo.
   */
  deepseek: {
    provider: 'deepseek' as const,
    model: 'deepseek-v4-flash-vision-exp',
    maxTokens: 16_000,
    maxImages: 24,
    usdPerMillionInput: 0.44,
    usdPerMillionOutput: 1.32,
  },

  /** Claude Sonnet 5. Mais caro, melhor leitura de imagem, formato garantido. */
  anthropic: {
    provider: 'anthropic' as const,
    model: 'claude-sonnet-5',
    maxTokens: 16_000,
    maxImages: 24,
    usdPerMillionInput: 3,
    usdPerMillionOutput: 15,
  },
} as const;

export type AnalysisProvider =
  (typeof analysisProviders)[keyof typeof analysisProviders];

export const models = {
  transcription: {
    provider: 'groq' as const,
    /**
     * PREFERENCIA, nao nome fixo: se o Groq aposentar este modelo, o worker
     * pergunta a propria API qual Whisper existe e usa o equivalente.
     */
    model: 'whisper-large-v3-turbo',
    /**
     * Idioma da fala. `null` = o Whisper detecta sozinho.
     *
     * Detectar e o certo aqui: a ferramenta serve para engenharia reversa de
     * perfil, e boa parte das referencias que valem a pena estudar e de perfil
     * gringo. Forcar 'pt' num video em ingles nao da erro — da uma transcricao
     * errada, que e pior, porque parece que funcionou.
     */
    language: null as string | null,
    /** USD por hora de audio. O plano gratuito do Groq cobre 8h por dia. */
    usdPerAudioHour: 0.04,
    /** Teto de tamanho por requisicao. Acima disso o audio precisa ser fatiado. */
    maxUploadBytes: 24 * 1024 * 1024,
  },

  /**
   * <<< TROQUE AQUI para mudar de provedor de analise.
   *
   * Padrao: gemini, a melhor opcao gratuita. Alternativas: `groq` (tambem
   * gratuito, reaproveita a chave da transcricao, mas so 5 imagens por
   * requisicao), `anthropic` (pago, melhor leitura de imagem) ou `deepseek`
   * (barato).
   */
  analysis: analysisProviders.gemini as AnalysisProvider,
} as const;

/**
 * Ingestao por link, sem login e sem API do Meta.
 *
 * Tres camadas, tentadas em ordem, e a UI mostra qual resolveu. Se a camada 1
 * estiver falhando na maioria das vezes, isso aparece no contador antes de
 * virar frustracao — que e exatamente o ponto de medir.
 */
export const ingest = {
  /**
   * Versao travada do yt-dlp. Nao escrevemos extrator proprio de Instagram:
   * o yt-dlp ja mantem isso e sobrevive as mudancas da plataforma. Travar a
   * versao evita que um `pip install` mude o comportamento sem aviso; para
   * atualizar, troque aqui e no workflow.
   */
  ytdlpVersion: '2026.8.19',

  /** Tempo maximo que o yt-dlp pode gastar num link. */
  timeoutMs: 120_000,

  /**
   * Camada 2: pagina publica de embed. Nao traz o arquivo de video, traz
   * metadado e thumbnail — serve para o job falhar dizendo O QUE e o post, em
   * vez de falhar dizendo nada.
   */
  usarEmbed: true,

  /** Quantos videos, no maximo, listar de um perfil. */
  maxVideosPorPerfil: 24,
} as const;

/**
 * Coleta incremental. O scraping nao e transacional: cada post e gravado assim
 * que coletado. Isso define quando vale a pena reabrir um post ja coletado.
 */
export const collection = {
  /**
   * De onde vem o dado do perfil. <<< TROQUE AQUI para mudar de fonte.
   *
   *   'graph'   API oficial do Instagram (Business Discovery). Risco ZERO para
   *             a sua conta e roda em qualquer lugar, inclusive no GitHub
   *             Actions. Alcanca so perfil profissional e publico, e nao traz
   *             texto de comentario, destaques nem perfis sugeridos.
   *
   *   'scraper' Navegador com a sua sessao. Alcanca tudo, mas exige rodar numa
   *             maquina sua (a sessao e do seu IP residencial) e carrega risco
   *             de bloqueio da conta.
   */
  source: 'graph' as 'graph' | 'scraper',

  /** Post com detalhe coletado ha menos dias que isso nao e reaberto. */
  refetchDetailAfterDays: 30,
  /** Quantos posts do grid, no maximo, por analise de perfil. */
  maxPostsPerProfile: 100,
  /** Quantos outliers de video recebem o pipeline completo de roteiro. */
  maxOutlierVideosPerProfile: 10,
  /** Quantos comentarios ler por post outlier. */
  maxCommentsPerPost: 50,
} as const;

/** Config completa em um objeto so, para logar ou serializar de uma vez. */
export const config = {
  TIMEZONE,
  escopo,
  seguranca,
  ingest,
  scraping,
  dailyCaps,
  queue,
  outliers,
  durationBuckets,
  media,
  models,
  collection,
} as const;

export type Config = typeof config;
