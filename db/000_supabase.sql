-- ============================================================
-- LEILÃO HUB — schema consolidado para Supabase
-- ============================================================
-- Consolida: pg_trgm + schema.sql + 002_ajustes.sql + 003_score_tipo.sql
--
-- Idempotente: pode rodar mais de uma vez sem erro. Já nasce com
-- tipo/condicao como TEXT (a 002 convertia depois) e sem os enums
-- tipo_veiculo/condicao_lote, que o vocabulário real dos leiloeiros
-- ("média monta", "utilitarios leves") não comportava.
--
-- Rodar no SQL Editor da Supabase, de uma vez só.
-- ============================================================

-- ---------- EXTENSÕES ----------
-- Precisa vir ANTES das tabelas: o índice gin_trgm_ops depende dela.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------- ENUMS ----------
-- CREATE TYPE não aceita IF NOT EXISTS; o bloco torna a coisa re-executável.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'status_leilao') THEN
    CREATE TYPE status_leilao AS ENUM
      ('agendado', 'em_andamento', 'encerrado', 'cancelado', 'suspenso');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'status_lote') THEN
    CREATE TYPE status_lote AS ENUM
      ('disponivel', 'em_pregao', 'vendido', 'nao_vendido', 'retirado', 'condicional');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'modalidade_leilao') THEN
    CREATE TYPE modalidade_leilao AS ENUM ('online', 'presencial', 'hibrido');
  END IF;
END $$;

-- ---------- LEILOEIROS ----------
CREATE TABLE IF NOT EXISTS leiloeiros (
  id            SERIAL PRIMARY KEY,
  slug          TEXT UNIQUE NOT NULL,
  nome          TEXT NOT NULL,
  site_url      TEXT,
  cnpj          TEXT,
  jucesp_num    TEXT,
  taxa_comissao NUMERIC(5,4) DEFAULT 0.05,
  ativo         BOOLEAN NOT NULL DEFAULT true,
  scraper_config JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- LEILÕES ----------
CREATE TABLE IF NOT EXISTS leiloes (
  id             BIGSERIAL PRIMARY KEY,
  leiloeiro_id   INT NOT NULL REFERENCES leiloeiros(id),
  external_id    TEXT NOT NULL,
  titulo         TEXT NOT NULL,
  descricao      TEXT,
  modalidade     modalidade_leilao NOT NULL DEFAULT 'online',
  status         status_leilao NOT NULL DEFAULT 'agendado',
  data_inicio    TIMESTAMPTZ,
  data_fim       TIMESTAMPTZ,
  cidade         TEXT,
  uf             CHAR(2),
  endereco       TEXT,
  edital_pdf_url TEXT,
  pagina_url     TEXT,
  comitente      TEXT,
  -- enriquecimento vindo de /api/auctions/{id} (migração 004).
  -- condicoes_venda é o texto integral; condicoes_pagamento é o recorte
  -- que fala de pagamento. Não há URL de edital em PDF em nenhum payload.
  condicoes_venda     TEXT,
  condicoes_pagamento TEXT,
  -- parcelamento do art. 895 do CPC (migração 005): sinal + parcelas
  -- mensais garantidas pelo bem. Vale por LEILÃO — o juízo pode exigir
  -- pagamento à vista, e vários editais exigem.
  permite_parcelamento      BOOLEAN,
  parcelamento_entrada_pct  NUMERIC(5,2),
  parcelamento_parcelas_max SMALLINT,
  parcelamento_trecho       TEXT,
  leiloeiro_nome      TEXT,
  jucesp              TEXT,
  is_judicial         BOOLEAN,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (leiloeiro_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_leiloes_uf_data ON leiloes (uf, data_inicio);
CREATE INDEX IF NOT EXISTS idx_leiloes_status  ON leiloes (status)
  WHERE status IN ('agendado','em_andamento');

-- ---------- LOTES ----------
CREATE TABLE IF NOT EXISTS lotes (
  id               BIGSERIAL PRIMARY KEY,
  leilao_id        BIGINT NOT NULL REFERENCES leiloes(id) ON DELETE CASCADE,
  leiloeiro_id     INT NOT NULL REFERENCES leiloeiros(id),
  external_id      TEXT NOT NULL,
  numero_lote      TEXT,

  -- tipo/condicao são TEXT de propósito: vocabulário aberto por leiloeiro
  tipo             TEXT NOT NULL DEFAULT 'carro',
  marca            TEXT,
  modelo           TEXT,
  versao           TEXT,
  ano_fabricacao   SMALLINT,
  ano_modelo       SMALLINT,
  cor              TEXT,
  combustivel      TEXT,
  km               INT,
  placa_parcial    TEXT,
  chassi_parcial   TEXT,
  condicao         TEXT NOT NULL DEFAULT 'indefinida',
  tem_chave        BOOLEAN,
  documentacao     TEXT,
  descricao        TEXT,

  -- campos que a API real do Sodré revelou (vinham da migração 002)
  origem           TEXT,
  comitente        TEXT,
  cidade           TEXT,
  uf               CHAR(2),

  lance_inicial    NUMERIC(12,2),
  lance_atual      NUMERIC(12,2),
  valor_mercado    NUMERIC(12,2),
  status           status_lote NOT NULL DEFAULT 'disponivel',

  codigo_fipe      TEXT,
  fipe_preco_id    BIGINT,
  fipe_match_score NUMERIC(4,3),

  score_oportunidade   NUMERIC(6,4),
  custo_estimado_total NUMERIC(12,2),
  score_tipo           TEXT,   -- 'confirmado' | 'especulativo' (migração 003)
  financiavel          BOOLEAN,-- lot_status_financeable (migração 004)

  pagina_url       TEXT,
  raw_scrape_id    BIGINT,
  first_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (leiloeiro_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_lotes_filtros ON lotes (tipo, ano_modelo, lance_atual);
CREATE INDEX IF NOT EXISTS idx_lotes_score   ON lotes (score_oportunidade DESC NULLS LAST)
  WHERE status IN ('disponivel','em_pregao');
CREATE INDEX IF NOT EXISTS idx_lotes_marca_modelo ON lotes (marca, modelo);
CREATE INDEX IF NOT EXISTS idx_lotes_leilao  ON lotes (leilao_id);
CREATE INDEX IF NOT EXISTS idx_lotes_descricao_trgm ON lotes USING gin (descricao gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_lotes_uf ON lotes (uf);
CREATE INDEX IF NOT EXISTS idx_lotes_origem ON lotes (origem);
CREATE INDEX IF NOT EXISTS idx_lotes_score_tipo
  ON lotes (score_tipo, score_oportunidade DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_lotes_financiavel
  ON lotes (financiavel) WHERE financiavel = true;
CREATE INDEX IF NOT EXISTS idx_leiloes_parcelamento
  ON leiloes (permite_parcelamento) WHERE permite_parcelamento = true;

-- ---------- IMAGENS ----------
CREATE TABLE IF NOT EXISTS lote_imagens (
  id          BIGSERIAL PRIMARY KEY,
  lote_id     BIGINT NOT NULL REFERENCES lotes(id) ON DELETE CASCADE,
  url         TEXT NOT NULL,
  ordem       SMALLINT NOT NULL DEFAULT 0,
  espelho_url TEXT,
  UNIQUE (lote_id, url)
);

-- ---------- CACHE FIPE ----------
CREATE TABLE IF NOT EXISTS fipe_precos (
  id              BIGSERIAL PRIMARY KEY,
  codigo_fipe     TEXT NOT NULL,
  ano_modelo      SMALLINT NOT NULL,
  combustivel_cod SMALLINT NOT NULL DEFAULT 1,  -- 1=gasolina/flex, 3=diesel
  mes_referencia  DATE NOT NULL,
  marca           TEXT,
  modelo          TEXT,
  preco           NUMERIC(12,2) NOT NULL,
  fonte           TEXT NOT NULL DEFAULT 'parallelum',
  fetched_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (codigo_fipe, ano_modelo, combustivel_cod, mes_referencia)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_lotes_fipe') THEN
    ALTER TABLE lotes
      ADD CONSTRAINT fk_lotes_fipe
      FOREIGN KEY (fipe_preco_id) REFERENCES fipe_precos(id);
  END IF;
END $$;

-- ---------- HISTÓRICO DE LANCES ----------
CREATE TABLE IF NOT EXISTS lote_lances_historico (
  id           BIGSERIAL PRIMARY KEY,
  lote_id      BIGINT NOT NULL REFERENCES lotes(id) ON DELETE CASCADE,
  valor        NUMERIC(12,2) NOT NULL,
  observado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lances_hist_lote
  ON lote_lances_historico (lote_id, observado_em);

-- ---------- STAGING BRUTO DOS SCRAPERS ----------
CREATE TABLE IF NOT EXISTS raw_scrapes (
  id           BIGSERIAL PRIMARY KEY,
  leiloeiro_id INT NOT NULL REFERENCES leiloeiros(id),
  tipo         TEXT NOT NULL,               -- 'auction_list' | 'lot_detail'
  url          TEXT,
  payload      JSONB NOT NULL,
  processado   BOOLEAN NOT NULL DEFAULT false,
  erro         TEXT,
  scraped_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_raw_pendentes ON raw_scrapes (leiloeiro_id, scraped_at)
  WHERE processado = false;

-- ---------- FUTURO: alertas ----------
CREATE TABLE IF NOT EXISTS usuarios (
  id         BIGSERIAL PRIMARY KEY,
  email      TEXT UNIQUE NOT NULL,
  nome       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS alertas (
  id         BIGSERIAL PRIMARY KEY,
  usuario_id BIGINT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  filtros    JSONB NOT NULL,
  canal      TEXT NOT NULL DEFAULT 'email',
  ativo      BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- SEED OBRIGATÓRIO ----------
-- Sem esta linha o scraper grava ZERO em raw_scrapes e NÃO acusa erro:
-- saveRawScrape faz "INSERT ... SELECT id FROM leiloeiros WHERE slug = $1",
-- que simplesmente não insere nada quando o leiloeiro não existe.
INSERT INTO leiloeiros (slug, nome, site_url, taxa_comissao)
VALUES
  ('sodre-santoro',     'Sodré Santoro',     'https://www.sodresantoro.com.br',     0.05),
  ('freitas-leiloeiro', 'Freitas Leiloeiro', 'https://www.freitasleiloeiro.com.br', 0.05),
  ('mega-leiloes',      'Mega Leilões',      'https://www.megaleiloes.com.br',       0.05)
ON CONFLICT (slug) DO NOTHING;

-- ---------- ROW LEVEL SECURITY (migração 006) ----------
-- Ligado SEM policy: bloqueia por completo o acesso via chave anon
-- (PostgREST) e não afeta a nossa API, que conecta como `postgres` e tem
-- BYPASSRLS. O frontend nunca fala com o Supabase direto.
ALTER TABLE leiloeiros            ENABLE ROW LEVEL SECURITY;
ALTER TABLE leiloes               ENABLE ROW LEVEL SECURITY;
ALTER TABLE lotes                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE lote_imagens          ENABLE ROW LEVEL SECURITY;
ALTER TABLE lote_lances_historico ENABLE ROW LEVEL SECURITY;
ALTER TABLE fipe_precos           ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw_scrapes           ENABLE ROW LEVEL SECURITY;
ALTER TABLE usuarios              ENABLE ROW LEVEL SECURITY;
ALTER TABLE alertas               ENABLE ROW LEVEL SECURITY;
