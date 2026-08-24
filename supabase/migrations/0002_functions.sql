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

-- Pega UM job e o marca como running, de forma atomica.
-- `for update skip locked` garante que dois workers nunca pegam o mesmo job,
-- mesmo que voce rode um segundo worker por engano.
create or replace function claim_job(p_worker text)
returns jobs
language plpgsql
set search_path = public, pg_temp
as $$
declare
  claimed jobs;
begin
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
  returning * into claimed;

  return claimed;
end;
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
returns jobs
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
returns jobs
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
returns jobs
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
returns jobs
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
returns rate_limit_counters
language plpgsql
set search_path = public, pg_temp
as $$
declare
  updated rate_limit_counters;
begin
  if p_field not in ('profiles_analyzed', 'posts_opened', 'videos_downloaded', 'requests') then
    raise exception 'Campo de rate limit desconhecido: %', p_field;
  end if;

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
  returning * into updated;

  return updated;
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
returns posts
language plpgsql
set search_path = public, pg_temp
as $$
declare
  saved posts;
begin
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
  returning * into saved;

  return saved;
end;
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
