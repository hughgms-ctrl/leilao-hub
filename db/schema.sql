-- ============================================================
-- LEILÃO HUB — Schema inicial (PostgreSQL 15+)
-- ============================================================

-- ---------- ENUMS ----------

CREATE TYPE tipo_veiculo AS ENUM (
  'carro', 'moto', 'caminhao', 'onibus', 'van_utilitario',
  'maquina_agricola', 'nautico', 'outro'
);

CREATE TYPE condicao_lote AS ENUM (
  'conservado',        -- roda, documentável
  'sinistrado',        -- batido/recuperável
  'sucata',            -- baixa/peças, não volta a circular
  'financeira',        -- retomada de financiamento
  'judicial',
  'indefinida'
);

CREATE TYPE status_leilao AS ENUM (
  'agendado', 'em_andamento', 'encerrado', 'cancelado', 'suspenso'
);

CREATE TYPE status_lote AS ENUM (
  'disponivel', 'em_pregao', 'vendido', 'nao_vendido',
  'retirado', 'condicional'
);

CREATE TYPE modalidade_leilao AS ENUM ('online', 'presencial', 'hibrido');

-- ---------- LEILOEIROS ----------

CREATE TABLE leiloeiros (
  id            SERIAL PRIMARY KEY,
  slug          TEXT UNIQUE NOT NULL,        -- 'sodre-santoro', 'copart'
  nome          TEXT NOT NULL,
  site_url      TEXT,
  cnpj          TEXT,
  jucesp_num    TEXT,                        -- matrícula do leiloeiro oficial
  taxa_comissao NUMERIC(5,4) DEFAULT 0.05,   -- 5% padrão, usado no score
  ativo         BOOLEAN NOT NULL DEFAULT true,
  scraper_config JSONB,                      -- rate limit, seletores, etc.
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- LEILÕES (evento/praça) ----------

CREATE TABLE leiloes (
  id             BIGSERIAL PRIMARY KEY,
  leiloeiro_id   INT NOT NULL REFERENCES leiloeiros(id),
  external_id    TEXT NOT NULL,              -- id no site do leiloeiro
  titulo         TEXT NOT NULL,
  descricao      TEXT,
  modalidade     modalidade_leilao NOT NULL DEFAULT 'online',
  status         status_leilao NOT NULL DEFAULT 'agendado',
  data_inicio    TIMESTAMPTZ,
  data_fim       TIMESTAMPTZ,
  -- localização da praça
  cidade         TEXT,
  uf             CHAR(2),
  endereco       TEXT,
  edital_pdf_url TEXT,
  pagina_url     TEXT,
  comitente      TEXT,                       -- banco, seguradora, órgão público
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (leiloeiro_id, external_id)
);

CREATE INDEX idx_leiloes_uf_data ON leiloes (uf, data_inicio);
CREATE INDEX idx_leiloes_status  ON leiloes (status) WHERE status IN ('agendado','em_andamento');

-- ---------- LOTES / VEÍCULOS ----------

CREATE TABLE lotes (
  id               BIGSERIAL PRIMARY KEY,
  leilao_id        BIGINT NOT NULL REFERENCES leiloes(id) ON DELETE CASCADE,
  leiloeiro_id     INT NOT NULL REFERENCES leiloeiros(id),
  external_id      TEXT NOT NULL,            -- id do lote no site
  numero_lote      TEXT,

  -- veículo
  tipo             tipo_veiculo NOT NULL DEFAULT 'carro',
  marca            TEXT,
  modelo           TEXT,
  versao           TEXT,
  ano_fabricacao   SMALLINT,
  ano_modelo       SMALLINT,
  cor              TEXT,
  combustivel      TEXT,
  km               INT,
  placa_parcial    TEXT,                     -- muitos sites mascaram
  chassi_parcial   TEXT,
  condicao         condicao_lote NOT NULL DEFAULT 'indefinida',
  tem_chave        BOOLEAN,
  documentacao     TEXT,                     -- 'com doc', 'baixado', 'CRLV ok'...
  descricao        TEXT,

  -- valores
  lance_inicial    NUMERIC(12,2),
  lance_atual      NUMERIC(12,2),
  valor_mercado    NUMERIC(12,2),            -- avaliação do próprio leiloeiro, se houver
  status           status_lote NOT NULL DEFAULT 'disponivel',

  -- FIPE (preenchido pelo matcher)
  codigo_fipe      TEXT,
  fipe_preco_id    BIGINT,                   -- FK adicionada abaixo
  fipe_match_score NUMERIC(4,3),             -- confiança do fuzzy match (0-1)

  -- oportunidade (pré-calculado na ingestão)
  score_oportunidade NUMERIC(6,4),           -- ex.: 0.35 = 35% abaixo da FIPE ajustada
  custo_estimado_total NUMERIC(12,2),        -- lance + comissão + taxas estimadas

  pagina_url       TEXT,
  raw_scrape_id    BIGINT,                   -- rastreabilidade até o payload bruto
  first_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (leiloeiro_id, external_id)
);

CREATE INDEX idx_lotes_filtros ON lotes (tipo, ano_modelo, lance_atual);
CREATE INDEX idx_lotes_score   ON lotes (score_oportunidade DESC NULLS LAST)
  WHERE status IN ('disponivel','em_pregao');
CREATE INDEX idx_lotes_marca_modelo ON lotes (marca, modelo);
CREATE INDEX idx_lotes_leilao  ON lotes (leilao_id);
-- busca textual simples no MVP; evoluir p/ tsvector se precisar
CREATE INDEX idx_lotes_descricao_trgm ON lotes USING gin (descricao gin_trgm_ops);

-- ---------- IMAGENS ----------

CREATE TABLE lote_imagens (
  id        BIGSERIAL PRIMARY KEY,
  lote_id   BIGINT NOT NULL REFERENCES lotes(id) ON DELETE CASCADE,
  url       TEXT NOT NULL,
  ordem     SMALLINT NOT NULL DEFAULT 0,
  espelho_url TEXT,                          -- se um dia espelhar no MinIO/S3
  UNIQUE (lote_id, url)
);

-- ---------- CACHE FIPE ----------

CREATE TABLE fipe_precos (
  id              BIGSERIAL PRIMARY KEY,
  codigo_fipe     TEXT NOT NULL,
  ano_modelo      SMALLINT NOT NULL,
  combustivel_cod SMALLINT NOT NULL DEFAULT 1,  -- 1=gasolina/flex, 3=diesel
  mes_referencia  DATE NOT NULL,                -- primeiro dia do mês
  marca           TEXT,
  modelo          TEXT,
  preco           NUMERIC(12,2) NOT NULL,
  fonte           TEXT NOT NULL DEFAULT 'parallelum',
  fetched_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (codigo_fipe, ano_modelo, combustivel_cod, mes_referencia)
);

ALTER TABLE lotes
  ADD CONSTRAINT fk_lotes_fipe FOREIGN KEY (fipe_preco_id) REFERENCES fipe_precos(id);

-- ---------- HISTÓRICO DE LANCES (evolução do preço) ----------

CREATE TABLE lote_lances_historico (
  id          BIGSERIAL PRIMARY KEY,
  lote_id     BIGINT NOT NULL REFERENCES lotes(id) ON DELETE CASCADE,
  valor       NUMERIC(12,2) NOT NULL,
  observado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_lances_hist_lote ON lote_lances_historico (lote_id, observado_em);

-- ---------- STAGING BRUTO DOS SCRAPERS ----------

CREATE TABLE raw_scrapes (
  id           BIGSERIAL PRIMARY KEY,
  leiloeiro_id INT NOT NULL REFERENCES leiloeiros(id),
  tipo         TEXT NOT NULL,                -- 'auction_list', 'lot_detail'
  url          TEXT,
  payload      JSONB NOT NULL,
  processado   BOOLEAN NOT NULL DEFAULT false,
  erro         TEXT,
  scraped_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_raw_pendentes ON raw_scrapes (leiloeiro_id, scraped_at)
  WHERE processado = false;

-- ---------- FUTURO: alertas (só a casca, p/ não travar o MVP) ----------

CREATE TABLE usuarios (
  id         BIGSERIAL PRIMARY KEY,
  email      TEXT UNIQUE NOT NULL,
  nome       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE alertas (
  id         BIGSERIAL PRIMARY KEY,
  usuario_id BIGINT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  filtros    JSONB NOT NULL,   -- {marca, ano_min, uf, score_min, preco_max...}
  canal      TEXT NOT NULL DEFAULT 'email',  -- futuramente 'whatsapp'
  ativo      BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- EXTENSÕES NECESSÁRIAS ----------
-- rodar antes das tabelas num setup real:
-- CREATE EXTENSION IF NOT EXISTS pg_trgm;
