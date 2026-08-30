-- Migração 006 — Row Level Security
-- Idempotente.
--
-- Defesa em profundidade. Hoje o banco não está exposto: a chave anon não
-- vazou e a REST do Supabase devolve 401. Mas com RLS DESLIGADO, no dia em
-- que essa chave aparecer em qualquer lugar (um teste, o SDK no front, o
-- dashboard), quem a tiver lê E ESCREVE tudo, inclusive TRUNCATE.
--
-- Ligamos RLS SEM criar policy nenhuma. Efeito:
--   - acesso via chave anon/authenticated (PostgREST): bloqueado por completo
--   - nossa API: continua funcionando, porque conecta como `postgres`, que
--     é dono das tabelas e tem BYPASSRLS
--
-- Não perdemos nada porque o frontend nunca fala com o Supabase direto —
-- ele fala com a nossa API, que é quem guarda a credencial.
--
-- Se um dia o front for falar direto com o Supabase, aí sim cria-se uma
-- policy de SELECT para anon nas tabelas de catálogo. Escrita nunca.
ALTER TABLE leiloeiros            ENABLE ROW LEVEL SECURITY;
ALTER TABLE leiloes               ENABLE ROW LEVEL SECURITY;
ALTER TABLE lotes                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE lote_imagens          ENABLE ROW LEVEL SECURITY;
ALTER TABLE lote_lances_historico ENABLE ROW LEVEL SECURITY;
ALTER TABLE fipe_precos           ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw_scrapes           ENABLE ROW LEVEL SECURITY;
ALTER TABLE usuarios              ENABLE ROW LEVEL SECURITY;
ALTER TABLE alertas               ENABLE ROW LEVEL SECURITY;
