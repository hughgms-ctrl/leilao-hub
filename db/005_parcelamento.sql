-- Migração 005 — parcelamento judicial (art. 895 do CPC)
-- Idempotente.
--
-- Em leilão judicial o arrematante pode propor pagamento parcelado: no
-- mínimo 25% à vista a título de sinal e o saldo em até 30 parcelas
-- mensais, garantidas pelo próprio bem. Não é financiamento bancário —
-- não passa por análise de crédito, é proposta dentro do processo.
--
-- Isso NÃO vale para todo leilão judicial: o juízo pode determinar
-- pagamento só à vista, e vários editais fazem exatamente isso. Por isso
-- a informação é por LEILÃO, lida do texto das condições de venda.
ALTER TABLE leiloes ADD COLUMN IF NOT EXISTS permite_parcelamento BOOLEAN;
ALTER TABLE leiloes ADD COLUMN IF NOT EXISTS parcelamento_entrada_pct NUMERIC(5,2);
ALTER TABLE leiloes ADD COLUMN IF NOT EXISTS parcelamento_parcelas_max SMALLINT;
-- trecho literal do edital que fundamenta o acima, para o usuário conferir
ALTER TABLE leiloes ADD COLUMN IF NOT EXISTS parcelamento_trecho TEXT;

CREATE INDEX IF NOT EXISTS idx_leiloes_parcelamento
  ON leiloes (permite_parcelamento) WHERE permite_parcelamento = true;
