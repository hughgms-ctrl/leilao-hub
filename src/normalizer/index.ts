import { Pool } from 'pg';
import { mapSodreDoc, mapSodreAuction, mapStatus, type DbLot } from './mappers/sodre';
import { matchFipe, cachedFipePrice } from '../fipe/matcher';
import { calcularScore } from '../score';
import { poolConfigDireto } from '../pg-config';

/**
 * NORMALIZER: lê raw_scrapes pendentes → upsert em leiloes/lotes →
 * histórico de lances → match FIPE → score de oportunidade.
 *
 * Idempotente: rodar duas vezes não duplica nada (upserts por chave
 * natural, histórico só quando o lance MUDA, FIPE com cache mensal).
 *
 * Registry de mappers: adicionar um leiloeiro novo = 1 mapper + 1 linha aqui.
 */

const MAPPERS: Record<string, (d: Record<string, any>) => DbLot | null> = {
  'sodre-santoro': mapSodreDoc,
};

const pool = new Pool(poolConfigDireto());

interface Leiloeiro { id: number; taxa_comissao: number }

async function ensureLeiloeiro(slug: string): Promise<Leiloeiro> {
  const r = await pool.query(
    `INSERT INTO leiloeiros (slug, nome, site_url)
     VALUES ($1, $1, null)
     ON CONFLICT (slug) DO UPDATE SET slug = EXCLUDED.slug
     RETURNING id, taxa_comissao`,
    [slug],
  );
  return { id: r.rows[0].id, taxa_comissao: Number(r.rows[0].taxa_comissao) };
}

/** auction_status do leiloeiro → enum status_leilao do banco */
function mapStatusLeilao(s?: string): string {
  const v = (s ?? '').toLowerCase();
  if (/encerrad/.test(v)) return 'encerrado';
  if (/online|aberto|andamento/.test(v)) return 'em_andamento';
  return 'agendado';
}

/**
 * Upsert do leilão a partir do PRÓPRIO documento de lote.
 *
 * O documento de lote já carrega auction_name, auction_date_init,
 * auction_date_end, auction_status e client_name — dá para ter título e
 * datas reais sem gastar request nenhum. O detalhe do leilão
 * (processarLeiloes) só acrescenta o que não vem aqui: condições de
 * venda, leiloeiro/JUCESP, modalidade.
 */
async function upsertLeilao(
  leiloeiroId: number,
  auctionExternalId: string,
  doc: Record<string, any>,
): Promise<number> {
  const r = await pool.query(
    `INSERT INTO leiloes (
       leiloeiro_id, external_id, titulo, pagina_url,
       data_inicio, data_fim, status, comitente
     ) VALUES ($1,$2,$3,$4,$5,$6,$7::status_leilao,$8)
     ON CONFLICT (leiloeiro_id, external_id) DO UPDATE SET
       titulo      = COALESCE(EXCLUDED.titulo, leiloes.titulo),
       data_inicio = COALESCE(EXCLUDED.data_inicio, leiloes.data_inicio),
       data_fim    = COALESCE(EXCLUDED.data_fim, leiloes.data_fim),
       status      = EXCLUDED.status,
       comitente   = COALESCE(EXCLUDED.comitente, leiloes.comitente),
       updated_at  = now()
     RETURNING id`,
    [
      leiloeiroId,
      auctionExternalId,
      doc.auction_name ? String(doc.auction_name) : `Leilão ${auctionExternalId}`,
      `https://www.sodresantoro.com.br/leilao/${auctionExternalId}`,
      doc.auction_date_init || null,
      doc.auction_date_end || null,
      mapStatusLeilao(doc.auction_status),
      doc.client_name ? String(doc.client_name) : null,
    ],
  );
  return r.rows[0].id;
}

/** Upsert do lote. Devolve id + lance anterior (para histórico). */
async function upsertLote(
  leiloeiroId: number,
  leilaoId: number,
  rawScrapeId: number,
  l: DbLot,
): Promise<{ id: number; lanceAnterior: number | null }> {
  const status = mapStatus(l.statusTexto);
  const r = await pool.query(
    `INSERT INTO lotes (
       leilao_id, leiloeiro_id, external_id, numero_lote, tipo, marca, modelo,
       ano_fabricacao, ano_modelo, cor, combustivel, km, condicao, tem_chave,
       descricao, lance_inicial, lance_atual, status, pagina_url, raw_scrape_id,
       origem, comitente, cidade, uf, financiavel
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::status_lote,$19,$20,
       $21,$22,$23,$24,$25)
     ON CONFLICT (leiloeiro_id, external_id) DO UPDATE SET
       lance_atual = EXCLUDED.lance_atual,
       lance_inicial = COALESCE(EXCLUDED.lance_inicial, lotes.lance_inicial),
       status = EXCLUDED.status,
       km = COALESCE(EXCLUDED.km, lotes.km),
       descricao = COALESCE(EXCLUDED.descricao, lotes.descricao),
       tipo = EXCLUDED.tipo,
       condicao = EXCLUDED.condicao,
       origem = COALESCE(EXCLUDED.origem, lotes.origem),
       comitente = COALESCE(EXCLUDED.comitente, lotes.comitente),
       cidade = COALESCE(EXCLUDED.cidade, lotes.cidade),
       uf = COALESCE(EXCLUDED.uf, lotes.uf),
       financiavel = COALESCE(EXCLUDED.financiavel, lotes.financiavel),
       last_seen_at = now(),
       updated_at = now()
     RETURNING id,
       (SELECT lance_atual FROM lotes o WHERE o.leiloeiro_id = $2 AND o.external_id = $3) AS lance_anterior`,
    [
      leilaoId, leiloeiroId, l.externalId, l.numeroLote ?? null,
      // tipo/condicao são NOT NULL: default textual quando o leiloeiro não informa
      l.tipo ?? 'carro',
      l.marca ?? null, l.modelo ?? null, l.anoFabricacao ?? null, l.anoModelo ?? null,
      l.cor ?? null, l.combustivel ?? null, l.km ?? null,
      l.condicao ?? 'indefinida',
      l.temChave ?? null,
      l.descricao ?? null, l.lanceInicial ?? null, l.lanceAtual ?? null,
      status, l.paginaUrl, rawScrapeId,
      l.origem ?? null, l.comitente ?? null, l.cidade ?? null, l.uf ?? null,
      l.financiavel ?? null,
    ],
  );
  return {
    id: r.rows[0].id,
    lanceAnterior: r.rows[0].lance_anterior != null ? Number(r.rows[0].lance_anterior) : null,
  };
}

/**
 * NOTA sobre enums: o schema criava tipo_veiculo/condicao_lote como enum, mas
 * os valores do leiloeiro ("caminhões", "média monta") são mais ricos que
 * o enum. A migração 002 já trocou as duas colunas por TEXT, então gravamos
 * o valor CRU do leiloeiro (antes o código fixava 'carro'/'indefinida' e
 * jogava fora tipo/condição/origem/comitente/cidade/uf).
 * `status` continua enum (status_lote) — ali o vocabulário é fechado e
 * mapStatus() faz a tradução.
 */

async function registrarLance(loteId: number, novo: number | undefined, anterior: number | null) {
  if (novo == null) return;
  if (anterior != null && Math.abs(anterior - novo) < 0.01) return; // não mudou
  await pool.query(
    `INSERT INTO lote_lances_historico (lote_id, valor) VALUES ($1, $2)`,
    [loteId, novo],
  );
}

async function inserirImagens(loteId: number, urls: string[]) {
  for (let i = 0; i < urls.length; i++) {
    await pool.query(
      `INSERT INTO lote_imagens (lote_id, url, ordem)
       VALUES ($1, $2, $3)
       ON CONFLICT (lote_id, url) DO NOTHING`,
      [loteId, urls[i], i],
    );
  }
}

/** Devolve true só quando houve preço FIPE de fato (match novo ou cache). */
async function aplicarFipeEScore(
  loteId: number,
  l: DbLot,
  taxaComissao: number,
): Promise<boolean> {
  // Já tem código FIPE de execução anterior? Tenta o cache mensal primeiro.
  const existente = await pool.query(
    `SELECT codigo_fipe FROM lotes WHERE id = $1 AND codigo_fipe IS NOT NULL`,
    [loteId],
  );

  let fipePrecoId: number | null = null;
  let codigoFipe: string | null = null;
  let preco: number | null = null;
  let matchScore: number | null = null;

  if (existente.rowCount && l.anoModelo) {
    codigoFipe = existente.rows[0].codigo_fipe;
    const cached = await cachedFipePrice(pool, codigoFipe!, l.anoModelo, l.combustivel);
    if (cached) {
      fipePrecoId = cached.fipePrecoId;
      preco = cached.preco;
      matchScore = null; // mantém o score de match já gravado
    }
  }

  if (!preco) {
    const match = await matchFipe(pool, {
      marca: l.marca, modelo: l.modelo, anoModelo: l.anoModelo,
      combustivel: l.combustivel, tipo: l.tipo,
    });
    if (!match) return false;
    fipePrecoId = match.fipePrecoId;
    codigoFipe = match.codigoFipe;
    preco = match.preco;
    matchScore = match.matchScore;
  }

  const score = calcularScore({
    fipe: preco,
    lanceInicial: l.lanceInicial,
    lanceAtual: l.lanceAtual,
    condicao: l.condicao,
    origem: l.origem,
    comissao: taxaComissao,
    status: mapStatus(l.statusTexto),
  });

  // 'confirmado' = o leiloeiro publicou lance inicial, então existe um piso
  // real de preço. 'especulativo' = só há lance corrente de pregão aberto.
  const scoreTipo = score
    ? (l.lanceInicial != null && l.lanceInicial > 0 ? 'confirmado' : 'especulativo')
    : null;

  await pool.query(
    `UPDATE lotes SET
       codigo_fipe = $2,
       fipe_preco_id = $3,
       fipe_match_score = COALESCE($4, fipe_match_score),
       score_oportunidade = $5,
       custo_estimado_total = $6,
       score_tipo = $7,
       updated_at = now()
     WHERE id = $1`,
    [
      loteId, codigoFipe, fipePrecoId, matchScore,
      score?.score ?? null, score?.custoEstimadoTotal ?? null, scoreTipo,
    ],
  );
  return true;
}

/**
 * Enriquece `leiloes` com o detalhe vindo de /api/auctions/{id}.
 *
 * Atualiza o registro que o processamento de lotes já criou — o upsert é
 * por (leiloeiro_id, external_id), então stub existente é ATUALIZADO,
 * nunca duplicado. Campos vazios no detalhe não sobrescrevem o que já
 * está preenchido (COALESCE em tudo que é opcional).
 */
async function processarLeiloes(
  leiloeiroId: number,
  docs: Record<string, any>[],
): Promise<number> {
  let ok = 0;
  for (const doc of docs) {
    const a = mapSodreAuction(doc);
    if (!a) continue;
    await pool.query(
      `INSERT INTO leiloes (
         leiloeiro_id, external_id, titulo, pagina_url, modalidade,
         data_inicio, cidade, comitente, edital_pdf_url,
         condicoes_venda, condicoes_pagamento, leiloeiro_nome, jucesp, is_judicial
       ) VALUES ($1,$2,$3,$4,$5::modalidade_leilao,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (leiloeiro_id, external_id) DO UPDATE SET
         titulo              = COALESCE(EXCLUDED.titulo, leiloes.titulo),
         modalidade          = EXCLUDED.modalidade,
         data_inicio         = COALESCE(EXCLUDED.data_inicio, leiloes.data_inicio),
         cidade              = COALESCE(EXCLUDED.cidade, leiloes.cidade),
         comitente           = COALESCE(EXCLUDED.comitente, leiloes.comitente),
         edital_pdf_url      = COALESCE(EXCLUDED.edital_pdf_url, leiloes.edital_pdf_url),
         condicoes_venda     = COALESCE(EXCLUDED.condicoes_venda, leiloes.condicoes_venda),
         condicoes_pagamento = COALESCE(EXCLUDED.condicoes_pagamento, leiloes.condicoes_pagamento),
         leiloeiro_nome      = COALESCE(EXCLUDED.leiloeiro_nome, leiloes.leiloeiro_nome),
         jucesp              = COALESCE(EXCLUDED.jucesp, leiloes.jucesp),
         is_judicial         = COALESCE(EXCLUDED.is_judicial, leiloes.is_judicial),
         updated_at          = now()`,
      [
        leiloeiroId, a.externalId, a.titulo ?? null,
        `https://www.sodresantoro.com.br/leilao/${a.externalId}`,
        a.modalidade ?? 'online',
        a.dataInicio ?? null, a.cidade ?? null, a.comitente ?? null,
        a.editalPdfUrl ?? null, a.condicoesVenda ?? null, a.condicoesPagamento ?? null,
        a.leiloeiroNome ?? null, a.jucesp ?? null, a.isJudicial ?? null,
      ],
    );
    ok++;
  }
  return ok;
}

export async function processarPendentes(): Promise<void> {
  const pendentes = await pool.query(
    `SELECT rs.id, rs.tipo, rs.payload, rs.leiloeiro_id, le.slug
     FROM raw_scrapes rs
     JOIN leiloeiros le ON le.id = rs.leiloeiro_id
     WHERE rs.processado = false AND rs.tipo IN ('lot_detail','auction_list')
     ORDER BY rs.tipo DESC, rs.scraped_at
     LIMIT 20`,
  );

  console.log(`[normalizer] ${pendentes.rowCount} raw_scrapes pendentes`);

  for (const row of pendentes.rows) {
    // auction_list é enriquecimento de leilão: não passa pelo mapper de lote
    if (row.tipo === 'auction_list') {
      try {
        const leiloeiro = await ensureLeiloeiro(row.slug);
        const n = await processarLeiloes(leiloeiro.id, row.payload?.results ?? []);
        await pool.query(
          `UPDATE raw_scrapes SET processado = true, erro = null WHERE id = $1`,
          [row.id],
        );
        console.log(`[normalizer] raw ${row.id}: ${n} leilões enriquecidos`);
      } catch (e) {
        await pool.query(`UPDATE raw_scrapes SET erro = $2 WHERE id = $1`, [
          row.id, (e as Error).message,
        ]);
        console.error(`[normalizer] raw ${row.id} (leilões) falhou:`, e);
      }
      continue;
    }

    const mapper = MAPPERS[row.slug];
    if (!mapper) {
      await pool.query(
        `UPDATE raw_scrapes SET processado = true, erro = $2 WHERE id = $1`,
        [row.id, `sem mapper para slug ${row.slug}`],
      );
      continue;
    }

    try {
      const leiloeiro = await ensureLeiloeiro(row.slug);
      const docs: Record<string, any>[] = row.payload?.results ?? [];
      let ok = 0;
      let comFipe = 0;

      for (const doc of docs) {
        const l = mapper(doc);
        if (!l) continue;

        const leilaoId = await upsertLeilao(leiloeiro.id, l.auctionExternalId, doc);
        const { id: loteId, lanceAnterior } = await upsertLote(
          leiloeiro.id, leilaoId, row.id, l,
        );
        await registrarLance(loteId, l.lanceAtual, lanceAnterior);
        await inserirImagens(loteId, l.imagens);

        // FIPE só para lote com dado mínimo — e sucata nem tenta
        if (l.marca && l.modelo && l.anoModelo) {
          try {
            // conta só quando houve preço FIPE de fato, não toda tentativa
            if (await aplicarFipeEScore(loteId, l, leiloeiro.taxa_comissao)) comFipe++;
          } catch (e) {
            console.warn(`[normalizer] FIPE falhou p/ lote ${l.externalId}:`, (e as Error).message);
          }
        }
        ok++;
      }

      await pool.query(
        `UPDATE raw_scrapes SET processado = true, erro = null WHERE id = $1`,
        [row.id],
      );
      console.log(`[normalizer] raw ${row.id}: ${ok} lotes processados, ${comFipe} com FIPE`);
    } catch (e) {
      await pool.query(
        `UPDATE raw_scrapes SET erro = $2 WHERE id = $1`,
        [row.id, (e as Error).message],
      );
      console.error(`[normalizer] raw ${row.id} falhou:`, e);
    }
  }
}

export async function fechar() {
  await pool.end();
}
