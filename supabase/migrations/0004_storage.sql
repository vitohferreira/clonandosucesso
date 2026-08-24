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
