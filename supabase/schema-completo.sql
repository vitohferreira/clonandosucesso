-- Molde — schema completo, gerado por `npm run db:bundle`.
--
-- Cole ESTE ARQUIVO INTEIRO no SQL Editor do Supabase e clique em Run.
-- Sao 5 migrations na ordem correta. Nao rode em pedacos.
--
-- Gerado em 2026-08-25T15:53:57.661Z

-- ==========================================================================
-- 0001_init.sql
-- ==========================================================================

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


-- ==========================================================================
-- 0002_functions.sql
-- ==========================================================================

-- ============================================================================
-- Molde — funcoes da fila, dos tetos diarios e da gravacao incremental.
--
-- A logica que precisa ser atomica mora aqui, e nao no worker. Assim ela nao
-- depende de o worker acertar a ordem das operacoes.
-- ============================================================================

-- ------------------------------------------------------------- updated_at

create or replace function touch_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger jobs_touch     before update on jobs     for each row execute function touch_updated_at();
create trigger profiles_touch before update on profiles for each row execute function touch_updated_at();
create trigger posts_touch    before update on posts    for each row execute function touch_updated_at();
create trigger settings_touch before update on settings for each row execute function touch_updated_at();

-- ------------------------------------------------------------------- fila

-- NOTA sobre `returns setof` nas funcoes abaixo:
-- Elas devolvem no maximo UMA linha, entao `returns jobs` seria o natural. Mas
-- funcao que retorna tipo composto tem traducao ambigua para JSON: quando o
-- retorno e NULL — o caso do claim_job com a fila vazia — pode vir `null` ou um
-- objeto com todos os campos nulos, e a segunda forma faria o worker achar que
-- pegou um job inexistente. Com `setof`, fila vazia e sempre `[]`. Por isso os
-- helpers do packages/db pegam o primeiro elemento do array.

-- Pega UM job e o marca como running, de forma atomica.
-- `for update skip locked` garante que dois workers nunca pegam o mesmo job,
-- mesmo que voce rode um segundo worker por engano.
create or replace function claim_job(p_worker text)
returns setof jobs
language sql
set search_path = public, pg_temp
as $$
  update jobs
  set status     = 'running',
      locked_at  = now(),
      locked_by  = p_worker,
      attempts   = jobs.attempts + 1,
      started_at = coalesce(jobs.started_at, now()),
      error      = null
  where id = (
    select id
    from jobs
    where status = 'queued'
      and scheduled_for <= now()
    order by scheduled_for asc, created_at asc
    for update skip locked
    limit 1
  )
  returning *;
$$;

-- Sinal de vida do worker durante um job longo, para o reaper nao matar
-- um job que ainda esta andando.
create or replace function heartbeat_job(p_id uuid, p_progress jsonb default null)
returns void
language sql
set search_path = public, pg_temp
as $$
  update jobs
  set locked_at = now(),
      progress  = coalesce(p_progress, jobs.progress)
  where id = p_id and status = 'running';
$$;

create or replace function complete_job(p_id uuid, p_result jsonb, p_cost numeric default null)
returns setof jobs
language sql
set search_path = public, pg_temp
as $$
  update jobs
  set status       = 'done',
      result       = p_result,
      error        = null,
      defer_reason = null,
      cost_usd     = coalesce(p_cost, jobs.cost_usd),
      progress     = null,
      locked_at    = null,
      locked_by    = null,
      finished_at  = now()
  where id = p_id
  returning *;
$$;

create or replace function fail_job(p_id uuid, p_error text, p_cost numeric default null)
returns setof jobs
language sql
set search_path = public, pg_temp
as $$
  update jobs
  set status      = 'failed',
      error       = p_error,
      cost_usd    = coalesce(p_cost, jobs.cost_usd),
      locked_at   = null,
      locked_by   = null,
      finished_at = now()
  where id = p_id
  returning *;
$$;

-- Sinal do Instagram. Terminal por decisao de projeto: nada aqui volta para a
-- fila sozinho. Retry cego em scraping e o que queima conta.
create or replace function block_job(p_id uuid, p_reason text, p_detail jsonb default null)
returns setof jobs
language sql
set search_path = public, pg_temp
as $$
  update jobs
  set status         = 'blocked',
      blocked_reason = p_reason,
      error          = coalesce(p_detail ->> 'message', jobs.error),
      locked_at      = null,
      locked_by      = null,
      finished_at    = now()
  where id = p_id
  returning *;
$$;

-- Teto diario NOSSO. Nao e falha e nao e bloqueio: o job volta para a fila
-- agendado para depois da virada do dia, e `p_partial_result` guarda o que ja
-- foi feito para a proxima rodada nao recomecar do zero.
create or replace function defer_job(
  p_id uuid,
  p_until timestamptz,
  p_reason text,
  p_partial_result jsonb default null
)
returns setof jobs
language sql
set search_path = public, pg_temp
as $$
  update jobs
  set status        = 'queued',
      scheduled_for = p_until,
      defer_reason  = p_reason,
      defer_count   = jobs.defer_count + 1,
      result        = coalesce(p_partial_result, jobs.result),
      locked_at     = null,
      locked_by     = null,
      started_at    = null,
      finished_at   = null
  where id = p_id
  returning *;
$$;

-- Job 'running' parado ha tempo demais = o worker morreu no meio.
-- Vira 'failed', NUNCA 'queued': reprocessar scraping sozinho e exatamente o
-- comportamento que dispara checkpoint. Quem decide refazer e voce.
create or replace function reap_stale_jobs(p_timeout interval)
returns setof jobs
language sql
set search_path = public, pg_temp
as $$
  update jobs
  set status      = 'failed',
      error       = format(
        'Worker perdeu o job (sem heartbeat desde %s). Reenfileire manualmente se quiser refazer.',
        to_char(locked_at, 'YYYY-MM-DD HH24:MI:SS')
      ),
      locked_at   = null,
      locked_by   = null,
      finished_at = now()
  where status = 'running'
    and locked_at < now() - p_timeout
  returning *;
$$;

-- --------------------------------------------------------- tetos diarios

-- Incremento atomico do consumo do dia. Retorna a linha do dia ja atualizada,
-- entao o worker sempre decide com o numero real, nao com um cache.
create or replace function bump_rate_limit(p_day date, p_field text, p_amount integer default 1)
returns setof rate_limit_counters
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if p_field not in ('profiles_analyzed', 'posts_opened', 'videos_downloaded', 'requests') then
    raise exception 'Campo de rate limit desconhecido: %', p_field;
  end if;

  return query
  with bumped as (
  insert into rate_limit_counters as c (day, profiles_analyzed, posts_opened, videos_downloaded, requests)
  values (
    p_day,
    case when p_field = 'profiles_analyzed' then p_amount else 0 end,
    case when p_field = 'posts_opened'      then p_amount else 0 end,
    case when p_field = 'videos_downloaded' then p_amount else 0 end,
    case when p_field = 'requests'          then p_amount else 0 end
  )
  on conflict (day) do update
    set profiles_analyzed = c.profiles_analyzed + excluded.profiles_analyzed,
        posts_opened      = c.posts_opened      + excluded.posts_opened,
        videos_downloaded = c.videos_downloaded + excluded.videos_downloaded,
        requests          = c.requests          + excluded.requests,
        updated_at        = now()
  returning *
  )
  select * from bumped;
end;
$$;

-- --------------------------------------------- gravacao incremental de post

-- Grava um post assim que ele e coletado, sem perder o que ja sabiamos.
--
-- REGRA: so sobrescreve o que veio de fato nesta coleta. Uma passada pelo grid
-- (que nao ve curtidas) nunca apaga as curtidas que uma passada anterior, com o
-- post aberto, ja tinha gravado.
--
-- Por isso a checagem e `p ? 'campo'` (a chave veio?) e nao coalesce: quem chama
-- deve OMITIR as chaves que nao observou, e nao mandar null. O helper upsertPost
-- do packages/db ja remove chaves nulas antes de chamar.
create or replace function upsert_post(p jsonb)
returns setof posts
language sql
set search_path = public, pg_temp
as $$
  insert into posts as t (
    profile_id, shortcode, type, url, thumbnail_path, caption,
    like_count, comment_count, view_count, video_duration_s, carousel_count,
    is_pinned, posted_at, detail_fetched, detail_fetched_at, raw
  )
  values (
    (p ->> 'profile_id')::uuid,
    p ->> 'shortcode',
    coalesce((p ->> 'type')::post_type, 'unknown'),
    p ->> 'url',
    p ->> 'thumbnail_path',
    p ->> 'caption',
    (p ->> 'like_count')::bigint,
    (p ->> 'comment_count')::bigint,
    (p ->> 'view_count')::bigint,
    (p ->> 'video_duration_s')::numeric,
    (p ->> 'carousel_count')::integer,
    coalesce((p ->> 'is_pinned')::boolean, false),
    (p ->> 'posted_at')::timestamptz,
    coalesce((p ->> 'detail_fetched')::boolean, false),
    case when coalesce((p ->> 'detail_fetched')::boolean, false) then now() end,
    p -> 'raw'
  )
  on conflict (shortcode) do update
    set type             = case when p ? 'type' and p ->> 'type' <> 'unknown'
                                then (p ->> 'type')::post_type else t.type end,
        url              = case when p ? 'url'              then p ->> 'url' else t.url end,
        thumbnail_path   = case when p ? 'thumbnail_path'   then p ->> 'thumbnail_path' else t.thumbnail_path end,
        caption          = case when p ? 'caption'          then p ->> 'caption' else t.caption end,
        like_count       = case when p ? 'like_count'       then (p ->> 'like_count')::bigint else t.like_count end,
        comment_count    = case when p ? 'comment_count'    then (p ->> 'comment_count')::bigint else t.comment_count end,
        view_count       = case when p ? 'view_count'       then (p ->> 'view_count')::bigint else t.view_count end,
        video_duration_s = case when p ? 'video_duration_s' then (p ->> 'video_duration_s')::numeric else t.video_duration_s end,
        carousel_count   = case when p ? 'carousel_count'   then (p ->> 'carousel_count')::integer else t.carousel_count end,
        is_pinned        = case when p ? 'is_pinned'        then (p ->> 'is_pinned')::boolean else t.is_pinned end,
        posted_at        = case when p ? 'posted_at'        then (p ->> 'posted_at')::timestamptz else t.posted_at end,
        -- Uma vez coletado o detalhe, nunca volta a false.
        detail_fetched   = t.detail_fetched or coalesce((p ->> 'detail_fetched')::boolean, false),
        detail_fetched_at = case
                              when coalesce((p ->> 'detail_fetched')::boolean, false) then now()
                              else t.detail_fetched_at
                            end,
        -- O bruto acumula em vez de substituir.
        raw              = coalesce(t.raw, '{}'::jsonb) || coalesce(p -> 'raw', '{}'::jsonb)
  returning *;
$$;

-- Posts do perfil que ainda valem uma abertura individual: nunca abertos, ou
-- abertos ha mais tempo que a janela de refetch.
create or replace function posts_needing_detail(
  p_profile_id uuid,
  p_refetch_after_days integer default 30,
  p_limit integer default 100
)
returns setof posts
language sql
stable
set search_path = public, pg_temp
as $$
  select *
  from posts
  where profile_id = p_profile_id
    and (
      detail_fetched = false
      or detail_fetched_at is null
      or detail_fetched_at < now() - make_interval(days => p_refetch_after_days)
    )
  order by posted_at desc nulls last
  limit p_limit;
$$;


-- ==========================================================================
-- 0003_rls.sql
-- ==========================================================================

-- ============================================================================
-- Molde — trancar tudo.
--
-- Nenhum browser fala com o Supabase direto: quem acessa o banco e o servidor
-- do Next e o worker, os dois com a service role key, que ignora RLS.
--
-- Entao a postura aqui e a mais simples e a mais segura: RLS ligada em todas as
-- tabelas e ZERO policies. Se a anon key vazar, ela nao le nada.
-- ============================================================================

alter table jobs                enable row level security;
alter table profiles            enable row level security;
alter table profile_snapshots   enable row level security;
alter table posts               enable row level security;
alter table post_metrics        enable row level security;
alter table video_analyses      enable row level security;
alter table hooks               enable row level security;
alter table highlights          enable row level security;
alter table post_comments       enable row level security;
alter table profile_analyses    enable row level security;
alter table similar_profiles    enable row level security;
alter table rate_limit_counters enable row level security;
alter table scrape_events       enable row level security;
alter table settings            enable row level security;

-- RLS nao protege function com security definer nem RPC exposta.
-- As funcoes da fila sao infraestrutura do worker: ninguem mais chama.
revoke execute on function claim_job(text)                              from anon, authenticated;
revoke execute on function heartbeat_job(uuid, jsonb)                   from anon, authenticated;
revoke execute on function complete_job(uuid, jsonb, numeric)           from anon, authenticated;
revoke execute on function fail_job(uuid, text, numeric)                from anon, authenticated;
revoke execute on function block_job(uuid, text, jsonb)                 from anon, authenticated;
revoke execute on function defer_job(uuid, timestamptz, text, jsonb)    from anon, authenticated;
revoke execute on function reap_stale_jobs(interval)                    from anon, authenticated;
revoke execute on function bump_rate_limit(date, text, integer)         from anon, authenticated;
revoke execute on function upsert_post(jsonb)                           from anon, authenticated;
revoke execute on function posts_needing_detail(uuid, integer, integer) from anon, authenticated;


-- ==========================================================================
-- 0004_storage.sql
-- ==========================================================================

-- ============================================================================
-- Molde — bucket de midia.
--
-- Guarda: video enviado por upload (apagado depois de processado), audio
-- extraido, frames e thumbnails. Privado: o acesso e sempre por signed URL
-- gerada pelo servidor.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'media',
  'media',
  false,
  524288000, -- 500 MB: um reel longo em alta qualidade cabe com folga
  array[
    'video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska',
    'audio/mpeg', 'audio/mp4', 'audio/webm',
    'image/jpeg', 'image/png', 'image/webp'
  ]
)
on conflict (id) do update
  set file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Sem policies de storage: so a service role acessa, igual as tabelas.


-- ==========================================================================
-- 0005_storage_mime.sql
-- ==========================================================================

-- ============================================================================
-- Molde — o bucket para de validar MIME.
--
-- A lista de tipos permitidos no bucket parecia uma boa ideia e nao era: o
-- navegador reporta o MIME de forma inconsistente (um .mp4 chega ora como
-- video/mp4, ora como application/octet-stream, ora vazio), e o upload era
-- recusado com um 400 seco, sem explicar o motivo.
--
-- A validacao continua existindo — mas na API route, onde da para devolver uma
-- mensagem que diz o que aconteceu. O bucket segue privado e de usuario unico.
-- ============================================================================

update storage.buckets
set allowed_mime_types = null
where id = 'media';
