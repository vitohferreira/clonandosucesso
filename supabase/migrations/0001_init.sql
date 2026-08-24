-- ============================================================================
-- Molde — schema inicial
--
-- Nota sobre embeddings: a tabela `profile_embeddings` e a extensao `vector`
-- NAO estao aqui de proposito. Elas so entram na Fase 4, numa migration propria,
-- para a dimensao do vetor ser escolhida junto com o modelo de embedding, e nao
-- meses antes.
-- ============================================================================

create extension if not exists pgcrypto;

-- ------------------------------------------------------------------- enums

create type job_type as enum ('ping', 'profile_analysis', 'video_extraction');

-- `blocked` e terminal e reservado a sinal do Instagram (checkpoint, captcha,
-- sessao expirada). Teto diario NOSSO nao vira `blocked`: vira `queued` de novo,
-- agendado para depois da virada do dia.
create type job_status as enum ('queued', 'running', 'done', 'failed', 'blocked');

create type post_type as enum ('reel', 'carousel', 'image', 'video', 'unknown');

create type media_source as enum ('instagram', 'upload');

-- Em qual base o engajamento foi medido. Post so pode ser comparado com post da
-- mesma base: perfil que esconde curtidas nao entra na mesma mediana de quem mostra.
create type metric_basis as enum ('likes_comments', 'views', 'comments_only');

-- -------------------------------------------------------------------- jobs

create table jobs (
  id             uuid primary key default gen_random_uuid(),
  type           job_type not null,
  status         job_status not null default 'queued',
  payload        jsonb not null default '{}'::jsonb,
  result         jsonb,
  error          text,
  -- Motivo do bloqueio, quando status = 'blocked'. Terminal: nunca reprocessa sozinho.
  blocked_reason text,
  -- Motivo do adiamento, quando o job voltou para a fila por teto diario.
  defer_reason   text,
  defer_count    integer not null default 0,
  -- {step, current, total, message, updatedAt} — o que a UI mostra enquanto roda.
  progress       jsonb,
  attempts       integer not null default 0,
  -- Custo acumulado de API deste job, em USD.
  cost_usd       numeric(10, 6),
  locked_at      timestamptz,
  locked_by      text,
  -- O worker so pega jobs com scheduled_for <= now(). E assim que o adiamento funciona.
  scheduled_for  timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  started_at     timestamptz,
  finished_at    timestamptz
);

create index jobs_pending_idx on jobs (scheduled_for, created_at) where status = 'queued';
create index jobs_running_idx on jobs (locked_at) where status = 'running';
create index jobs_recent_idx on jobs (created_at desc);

-- ---------------------------------------------------------------- profiles

create table profiles (
  id                uuid primary key default gen_random_uuid(),
  -- Sempre minusculo, normalizado pela aplicacao (normalizeHandle).
  handle            text not null unique,
  full_name         text,
  bio               text,
  external_url      text,
  category          text,
  is_verified       boolean,
  -- Perfil privado nunca e coletado. A flag existe para lembrar por que paramos.
  is_private        boolean,
  avatar_path       text,
  -- Campos meus, nao do Instagram.
  niche             text,
  notes             text,
  first_analyzed_at timestamptz,
  last_analyzed_at  timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Historico de seguidores. Permite ver evolucao e normalizar engajamento pelo
-- tamanho que o perfil tinha na epoca do post.
create table profile_snapshots (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references profiles (id) on delete cascade,
  followers   bigint,
  following   bigint,
  posts_count integer,
  captured_at timestamptz not null default now()
);

create index profile_snapshots_profile_idx on profile_snapshots (profile_id, captured_at desc);

-- ------------------------------------------------------------------- posts

create table posts (
  id               uuid primary key default gen_random_uuid(),
  profile_id       uuid not null references profiles (id) on delete cascade,
  shortcode        text not null unique,
  type             post_type not null default 'unknown',
  url              text,
  thumbnail_path   text,
  caption          text,
  -- Nulo quando o perfil esconde a contagem. Nulo != zero, e a diferenca importa.
  like_count       bigint,
  comment_count    bigint,
  view_count       bigint,
  video_duration_s numeric(7, 2),
  carousel_count   integer,
  is_pinned        boolean not null default false,
  posted_at        timestamptz,
  -- O grid entrega shortcode, tipo e thumbnail. Curtidas, comentarios e duracao
  -- so existem abrindo o post — e cada abertura consome teto diario.
  detail_fetched     boolean not null default false,
  detail_fetched_at  timestamptz,
  -- Payload bruto do que foi raspado, para reprocessar sem voltar ao Instagram.
  raw              jsonb,
  collected_at     timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index posts_profile_idx on posts (profile_id, posted_at desc nulls last);
create index posts_needs_detail_idx on posts (profile_id) where detail_fetched = false;

-- ------------------------------------------------------------ post_metrics

-- Tudo aqui e derivado de `posts` e pode ser recalculado a qualquer momento,
-- sem tocar no Instagram.
create table post_metrics (
  id              uuid primary key default gen_random_uuid(),
  post_id         uuid not null unique references posts (id) on delete cascade,
  basis           metric_basis not null,
  engagement_raw  numeric not null,
  -- Engajamento sobre seguidores no snapshot mais proximo do post.
  engagement_rate numeric,
  -- Mediana da JANELA usada, nao do perfil inteiro.
  baseline_median numeric not null,
  window_kind     text not null default 'rolling',
  window_size     integer,
  multiple        numeric not null,
  is_outlier      boolean not null default false,
  -- 2, 3 ou 5 para outlier de alta; -1 para post muito abaixo da mediana.
  outlier_tier    smallint,
  -- Post novo demais para ter estabilizado. Fica fora do calculo da mediana.
  provisional     boolean not null default false,
  computed_at     timestamptz not null default now()
);

create index post_metrics_outlier_idx on post_metrics (is_outlier, multiple desc);

-- --------------------------------------------------------- video_analyses

create table video_analyses (
  id              uuid primary key default gen_random_uuid(),
  -- Nulo para upload avulso: o Modulo B funciona sem o Modulo A.
  post_id         uuid references posts (id) on delete cascade,
  job_id          uuid references jobs (id) on delete set null,
  source          media_source not null,
  source_url      text,
  audio_path      text,
  frames_path     text,
  duration_s      numeric(7, 2),
  -- Resposta crua do Whisper, com segments e timestamps.
  transcript_raw  jsonb,
  transcript_text text,
  -- Roteiro estruturado: blocos com {tIn, tOut, role, speech, onScreenText, scene, isBRoll}.
  script          jsonb,
  hook_text       text,
  cut_count       integer,
  avg_shot_s      numeric(6, 2),
  shot_boundaries jsonb,
  model_used      text,
  -- Tokens e segundos de audio consumidos, mais o custo estimado em USD.
  usage           jsonb,
  cost_usd        numeric(10, 6),
  created_at      timestamptz not null default now()
);

create index video_analyses_post_idx on video_analyses (post_id);

-- ------------------------------------------------------------------- hooks

-- A biblioteca de ganchos e o ativo mais valioso da ferramenta: pesquisavel,
-- filtravel por tipo e ordenavel por performance.
create table hooks (
  id                   uuid primary key default gen_random_uuid(),
  video_analysis_id    uuid references video_analyses (id) on delete cascade,
  post_id              uuid references posts (id) on delete set null,
  profile_id           uuid references profiles (id) on delete set null,
  text                 text not null,
  kind                 text,
  on_screen_text       text,
  span_seconds         numeric(5, 2),
  -- Desnormalizado de post_metrics para ordenar a biblioteca sem join.
  performance_multiple numeric,
  engagement_raw       numeric,
  created_at           timestamptz not null default now()
);

create index hooks_search_idx on hooks using gin (to_tsvector('portuguese', text));
create index hooks_kind_idx on hooks (kind, performance_multiple desc nulls last);

-- -------------------------------------------------------------- highlights

create table highlights (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid not null references profiles (id) on delete cascade,
  title         text not null,
  position      integer,
  item_count    integer,
  theme_summary text,
  collected_at  timestamptz not null default now(),
  unique (profile_id, title)
);

-- ----------------------------------------------------------- post_comments

-- Sem handle do autor de proposito: a dor da audiencia esta no texto, e guardar
-- nome de terceiro nao serve a nada aqui.
create table post_comments (
  id           uuid primary key default gen_random_uuid(),
  post_id      uuid not null references posts (id) on delete cascade,
  text         text not null,
  like_count   integer,
  collected_at timestamptz not null default now()
);

create index post_comments_post_idx on post_comments (post_id);

-- -------------------------------------------------------- profile_analyses

-- A sintese do dossie. Uma linha por rodada de analise, entao da para comparar
-- o que mudou no perfil entre duas analises.
create table profile_analyses (
  id                  uuid primary key default gen_random_uuid(),
  profile_id          uuid not null references profiles (id) on delete cascade,
  job_id              uuid references jobs (id) on delete set null,
  format_distribution jsonb,
  cadence             jsonb,
  duration_buckets    jsonb,
  narrative_patterns  jsonb,
  cta_patterns        jsonb,
  what_fails          jsonb,
  audience_pain       jsonb,
  synthesis_md        text,
  model_used          text,
  usage               jsonb,
  cost_usd            numeric(10, 6),
  created_at          timestamptz not null default now()
);

create index profile_analyses_profile_idx on profile_analyses (profile_id, created_at desc);

-- --------------------------------------------------------- similar_profiles

-- Fonte 'instagram_suggested' funciona desde a Fase 4 sem embedding nenhum.
-- Fonte 'embedding' entra quando a tabela de vetores existir.
create table similar_profiles (
  profile_id    uuid not null references profiles (id) on delete cascade,
  handle        text not null,
  source        text not null,
  score         numeric,
  discovered_at timestamptz not null default now(),
  primary key (profile_id, handle, source)
);

-- -------------------------------------------------------- limites e auditoria

-- `day` e a data no fuso da config (America/Sao_Paulo), nao em UTC.
create table rate_limit_counters (
  day               date primary key,
  profiles_analyzed integer not null default 0,
  posts_opened      integer not null default 0,
  videos_downloaded integer not null default 0,
  requests          integer not null default 0,
  updated_at        timestamptz not null default now()
);

-- Trilha de auditoria do scraper. O log completo vai para arquivo; aqui ficam
-- so os eventos que voce vai querer consultar depois.
create table scrape_events (
  id         bigserial primary key,
  job_id     uuid references jobs (id) on delete cascade,
  kind       text not null,
  target     text,
  detail     jsonb,
  created_at timestamptz not null default now()
);

create index scrape_events_recent_idx on scrape_events (created_at desc);
create index scrape_events_job_idx on scrape_events (job_id, created_at);

-- Override de configuracao sem redeploy do worker. A fonte da verdade continua
-- sendo packages/config; isto so sobrescreve.
create table settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);
