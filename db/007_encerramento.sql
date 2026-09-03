-- 007: marca lote que desapareceu da fonte.
--
-- PROBLEMA: o pipeline nunca expirava nada. Um lote que encerrou ficava
-- "em_pregao" para sempre. Medido em 03/09/2026: 1.823 de 5.598 lotes
-- (33%) não eram mais vistos na coleta da própria fonte — Sodré 51% e
-- Freitas 62% do acervo. A plataforma mostrava leilão que já passou, e
-- todo número que reportamos vinha inflado.
--
-- Por que coluna nova e não um valor no enum status_lote: a gente sabe
-- apenas que o lote SAIU da listagem da fonte. Não sabe se foi vendido,
-- retirado ou se o leilão só encerrou. Gravar 'nao_vendido' seria afirmar
-- desfecho que não observamos. `encerrado_em` diz o que de fato sabemos:
-- a data em que paramos de ver o lote.
--
-- Idempotente.

ALTER TABLE lotes
  ADD COLUMN IF NOT EXISTS encerrado_em TIMESTAMPTZ;

COMMENT ON COLUMN lotes.encerrado_em IS
  'Quando o lote deixou de aparecer na coleta da fonte. NULL = ativo. '
  'Não afirma desfecho (vendido/retirado) — só ausência na origem.';

-- a listagem padrão da API filtra por isto, então o índice importa
CREATE INDEX IF NOT EXISTS idx_lotes_ativos
  ON lotes (leiloeiro_id, encerrado_em)
  WHERE encerrado_em IS NULL;

-- consulta de "o que encerrou recentemente"
CREATE INDEX IF NOT EXISTS idx_lotes_encerrado_em
  ON lotes (encerrado_em DESC)
  WHERE encerrado_em IS NOT NULL;
