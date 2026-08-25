-- Sondagem de link: descobrir, no runner de verdade, o que o Instagram entrega
-- para quem chega DESLOGADO.
--
-- Nao cria tabela nenhuma. O relatorio da sondagem cabe em `jobs.result`, e o
-- rastro por camada cabe em `scrape_events`, que ja existe e cujo `kind` e
-- texto livre. Menos schema para manter.

alter type job_type add value if not exists 'link_probe';
