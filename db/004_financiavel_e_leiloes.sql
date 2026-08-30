-- Migração 004 — financiável no lote + campos de leilão enriquecido
-- Idempotente.

-- lot_status_financeable (boolean) existe em 100% dos documentos da listagem;
-- lot_financeable é o mesmo dado em texto ("Financiável"/"Não Financiável").
ALTER TABLE lotes ADD COLUMN IF NOT EXISTS financiavel BOOLEAN;

CREATE INDEX IF NOT EXISTS idx_lotes_financiavel
  ON lotes (financiavel) WHERE financiavel = true;

-- Condições de venda do leilão, em texto puro. Vem do campo `condition`
-- do endpoint de detalhe do leilão (HTML), não de PDF: o site não expõe
-- URL de edital em nenhum payload que encontramos.
ALTER TABLE leiloes ADD COLUMN IF NOT EXISTS condicoes_venda TEXT;

-- Trecho já recortado das condições que fala de pagamento/parcelamento,
-- para o detalhe do lote não ter que carregar 15 kB de texto.
ALTER TABLE leiloes ADD COLUMN IF NOT EXISTS condicoes_pagamento TEXT;

ALTER TABLE leiloes ADD COLUMN IF NOT EXISTS leiloeiro_nome TEXT;
ALTER TABLE leiloes ADD COLUMN IF NOT EXISTS jucesp TEXT;
ALTER TABLE leiloes ADD COLUMN IF NOT EXISTS is_judicial BOOLEAN;
