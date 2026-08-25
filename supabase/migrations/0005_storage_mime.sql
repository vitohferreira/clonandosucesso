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
