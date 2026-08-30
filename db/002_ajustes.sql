-- Migração 002 — ajustes pós-descobertas do scraper real
-- Rodar DEPOIS do schema.sql inicial. Idempotente: pode rodar de novo.

-- 1. Enums eram otimistas demais para multi-leiloeiro: cada site tem seu
--    vocabulário ("média monta", "utilit. pesados"). TEXT + valor cru
--    preserva informação; normalização vira responsabilidade de consulta.
--
--    ATENÇÃO: o DEFAULT das colunas ('carro'::tipo_veiculo) também depende
--    do enum. Sem remover o default antes, o DROP TYPE falha com
--    "cannot drop type ... because other objects depend on it".
ALTER TABLE lotes ALTER COLUMN tipo     DROP DEFAULT;
ALTER TABLE lotes ALTER COLUMN condicao DROP DEFAULT;

ALTER TABLE lotes ALTER COLUMN tipo     TYPE TEXT;
ALTER TABLE lotes ALTER COLUMN condicao TYPE TEXT;

-- colunas são NOT NULL: recoloca os defaults, agora como TEXT
ALTER TABLE lotes ALTER COLUMN tipo     SET DEFAULT 'carro';
ALTER TABLE lotes ALTER COLUMN condicao SET DEFAULT 'indefinida';

DROP TYPE IF EXISTS tipo_veiculo;
DROP TYPE IF EXISTS condicao_lote;

-- 2. Campos que a API real do Sodré revelou e que valem coluna própria
--    (origem e comitente alimentam o score; status texto para auditoria):
ALTER TABLE lotes ADD COLUMN IF NOT EXISTS origem TEXT;
ALTER TABLE lotes ADD COLUMN IF NOT EXISTS comitente TEXT;
ALTER TABLE lotes ADD COLUMN IF NOT EXISTS cidade TEXT;
ALTER TABLE lotes ADD COLUMN IF NOT EXISTS uf CHAR(2);

CREATE INDEX IF NOT EXISTS idx_lotes_uf ON lotes (uf);
CREATE INDEX IF NOT EXISTS idx_lotes_origem ON lotes (origem);
