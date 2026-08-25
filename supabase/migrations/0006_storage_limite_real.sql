-- ============================================================================
-- Molde — o bucket passa a declarar o limite que realmente vale.
--
-- A migration 0004 pedia 500 MB, mas o Supabase limita o bucket ao teto do
-- PROJETO, que no plano gratuito e de 50 MB por arquivo. O numero antigo dava a
-- impressao de que arquivo grande passaria, e ele nunca passou.
--
-- Se voce migrar para um plano pago, aumente aqui, no painel
-- (Storage > Settings > Global file size limit) e em packages/config
-- (media.maxUploadBytes) — os tres precisam concordar.
-- ============================================================================

update storage.buckets
set file_size_limit = 52428800  -- 50 MB, o teto do plano gratuito
where id = 'media';
