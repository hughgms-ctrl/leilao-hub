-- Migração 003 — natureza do score de oportunidade
-- Rodar DEPOIS de 002_ajustes.sql. Idempotente.
--
-- Distingue score calculado sobre lance inicial PUBLICADO pelo leiloeiro
-- ('confirmado') de score calculado só sobre o lance corrente de um pregão
-- que acabou de abrir ('especulativo'). Sem essa distinção os dois se
-- misturam no ranking e o especulativo domina, porque lance de abertura é
-- artificialmente baixo.
ALTER TABLE lotes ADD COLUMN IF NOT EXISTS score_tipo TEXT;

CREATE INDEX IF NOT EXISTS idx_lotes_score_tipo
  ON lotes (score_tipo, score_oportunidade DESC NULLS LAST);
