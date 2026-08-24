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
