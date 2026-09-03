import { Pool } from 'pg';
import { mapSodreDoc, mapSodreAuction, mapStatus, type DbLot } from './mappers/sodre';
import { mapFreitasDoc } from './mappers/freitas';
import { mapMegaDoc } from './mappers/mega';
import { mapZukDoc } from './mappers/zuk';
import { mapSuperbidDoc } from './mappers/superbid';
import { mapLeiloesJudiciaisDoc } from './mappers/leiloes-judiciais';
import { mapSfrazaoDoc } from './mappers/sfrazao';
import { detectarParcelamento } from './parcelamento';
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
  'freitas-leiloeiro': mapFreitasDoc,
  'mega-leiloes': mapMegaDoc,
  'portal-zuk': mapZukDoc,
  'superbid-judicial': mapSuperbidDoc,
  'leiloes-judiciais': mapLeiloesJudiciaisDoc,
  'sfrazao': mapSfrazaoDoc,
};

/** URL da página do leilão, por leiloeiro. */
function leilaoUrl(slug: string, externalId: string): string {
  if (slug === 'freitas-leiloeiro') {
    return `https://www.freitasleiloeiro.com.br/Leiloes/Lotes?leilaoId=${externalId}`;
  }
  if (slug === 'mega-leiloes') {
    return `https://www.megaleiloes.com.br/auditorio/${externalId}`;
  }
  if (slug === 'sfrazao') {
    return `https://www.sfrazao.com.br/leilao.php?idLeilao=${externalId}`;
  }
  if (slug === 'leiloes-judiciais') {
    // verificado: /leilao/98172 abre "JUSTICA FEDERAL DE PORTO ALEGRE - 7a VARA"
    return `https://www.leiloesjudiciais.com.br/leilao/${externalId}`;
  }
  if (slug === 'superbid-judicial') {
    // slug ignorado pelo roteador — verificado: /evento/leilao-785151
    // abre "1ª VARA CÍVEL DE PIRAPOZINHO/SP (2182-2008)"
    return `https://www.canaljudicial.com.br/evento/leilao-${externalId}`;
  }
  if (slug === 'portal-zuk') {
    // O caminho diz "imoveis" e traz um slug descritivo, mas o roteador
    // usa só o id — verificado: /v/x/36488 abre o mesmo leilão que
    // /v/leilao-judicial-sao-paulo-tjsp/36488. Como o slug real não sai
    // dos dados do lote, mandamos um neutro.
    return `https://www.portalzuk.com.br/leilao-de-imoveis/v/leilao/${externalId}`;
  }
  return `https://www.sodresantoro.com.br/leilao/${externalId}`;
}

/** "31/08/2026" + "10:00" -> ISO, para as fontes que só dão data BR. */
function dataBrParaIso(data?: string, hora?: string): string | null {
  const m = (data ?? '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}T${(hora ?? '00:00').padStart(5, '0')}:00`;
}

const pool = new Pool(poolConfigDireto());

interface Leiloeiro { id: number; taxa_comissao: number }

/**
 * Nome de exibição por leiloeiro. Sem isto o `nome` nascia igual ao slug
 * e o card do site mostrava "leiloes-judiciais" para o usuário.
 */
const NOME_EXIBICAO: Record<string, string> = {
  'sodre-santoro': 'Sodré Santoro',
  'freitas-leiloeiro': 'Freitas Leiloeiro',
  'mega-leiloes': 'Mega Leilões',
  'portal-zuk': 'Portal Zuk',
  'superbid-judicial': 'Canal Judicial',
  'leiloes-judiciais': 'Leilões Judiciais',
  'sfrazao': 'S. Frazão',
};

async function ensureLeiloeiro(slug: string): Promise<Leiloeiro> {
  const r = await pool.query(
    `INSERT INTO leiloeiros (slug, nome, site_url)
     VALUES ($1, $2, null)
     ON CONFLICT (slug) DO UPDATE SET nome = EXCLUDED.nome
     RETURNING id, taxa_comissao`,
    [slug, NOME_EXIBICAO[slug] ?? slug],
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
 *
 * Cacheado por execução: o upsert era chamado uma vez POR LOTE — 1.305
 * queries para ~70 leilões distintos. Os campos do leilão são iguais em
 * todos os lotes dele, então a primeira chamada resolve e as demais
 * reaproveitam o id.
 */
const cacheLeiloes = new Map<string, number>();

async function upsertLeilao(
  leiloeiroId: number,
  auctionExternalId: string,
  doc: Record<string, any>,
  slug: string,
): Promise<number> {
  const chave = `${leiloeiroId}:${auctionExternalId}`;
  const emCache = cacheLeiloes.get(chave);
  if (emCache !== undefined) return emCache;

  // Sodré traz os campos do leilão no próprio documento do lote; Freitas
  // só publica data e hora no card. Lemos os dois vocabulários.
  const dataInicio = doc.auction_date_init || dataBrParaIso(doc.dataLeilao, doc.horaLeilao);

  // O Mega publica as condições de venda na PÁGINA DO LOTE, não num
  // endpoint de leilão. Quando o documento do lote trouxer esse texto,
  // ele alimenta o leilão — inclusive a detecção do art. 895.
  const condicoes: string | undefined = doc.condicoes ? String(doc.condicoes) : undefined;
  const parc = detectarParcelamento(condicoes);

  // O Superbid publica a condição comercial ESTRUTURADA (maxInstallments,
  // minAdvanceRate) em vez de texto de edital. Quando ela vem, vale mais
  // que o detector — é o número da fonte, não inferência nossa.
  //
  // `parcelamento_trecho` fica nulo de propósito: ele guarda citação
  // LITERAL do leiloeiro, e aqui não existe texto para citar. Escrever
  // uma frase nossa ali faria dado sintetizado passar por fonte.
  const parcEstruturado =
    doc.parcelamento && Number(doc.parcelamento.parcelas) > 0
      ? {
          parcelas: Number(doc.parcelamento.parcelas),
          entradaPct: Number(doc.parcelamento.entradaPct) || null,
        }
      : null;
  // O Mega diz o tipo do leilão em texto. O Zuk não diz, mas publica o
  // nº do processo em 100% dos lotes — e processo só existe em leilão
  // judicial, então a presença dele é prova, não palpite.
  const ehJudicial =
    /judicial/i.test(String(doc.tipoLeilao ?? '')) ||
    Boolean(doc.processo) ||
    undefined;

  const r = await pool.query(
    `INSERT INTO leiloes (
       leiloeiro_id, external_id, titulo, pagina_url,
       data_inicio, data_fim, status, comitente,
       condicoes_venda, is_judicial,
       permite_parcelamento, parcelamento_entrada_pct,
       parcelamento_parcelas_max, parcelamento_trecho
     ) VALUES ($1,$2,$3,$4,$5,$6,$7::status_leilao,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (leiloeiro_id, external_id) DO UPDATE SET
       titulo      = COALESCE(EXCLUDED.titulo, leiloes.titulo),
       data_inicio = COALESCE(EXCLUDED.data_inicio, leiloes.data_inicio),
       data_fim    = COALESCE(EXCLUDED.data_fim, leiloes.data_fim),
       status      = EXCLUDED.status,
       comitente   = COALESCE(EXCLUDED.comitente, leiloes.comitente),
       condicoes_venda = COALESCE(EXCLUDED.condicoes_venda, leiloes.condicoes_venda),
       is_judicial     = COALESCE(EXCLUDED.is_judicial, leiloes.is_judicial),
       permite_parcelamento      = COALESCE(EXCLUDED.permite_parcelamento, leiloes.permite_parcelamento),
       parcelamento_entrada_pct  = COALESCE(EXCLUDED.parcelamento_entrada_pct, leiloes.parcelamento_entrada_pct),
       parcelamento_parcelas_max = COALESCE(EXCLUDED.parcelamento_parcelas_max, leiloes.parcelamento_parcelas_max),
       parcelamento_trecho       = COALESCE(EXCLUDED.parcelamento_trecho, leiloes.parcelamento_trecho),
       updated_at  = now()
     RETURNING id`,
    [
      leiloeiroId,
      auctionExternalId,
      doc.auction_name ? String(doc.auction_name) : `Leilão ${auctionExternalId}`,
      leilaoUrl(slug, auctionExternalId),
      dataInicio || null,
      doc.auction_date_end || null,
      mapStatusLeilao(doc.auction_status ?? doc.status),
      doc.client_name ? String(doc.client_name) : null,
      condicoes ?? null,
      ehJudicial ?? null,
      parcEstruturado ? true : condicoes ? parc.permite : null,
      parcEstruturado ? parcEstruturado.entradaPct : parc.entradaPct ?? null,
      parcEstruturado ? parcEstruturado.parcelas : parc.parcelasMax ?? null,
      parcEstruturado ? null : parc.trecho ?? null,
    ],
  );
  cacheLeiloes.set(chave, r.rows[0].id);
  return r.rows[0].id;
}

/** Upsert do lote. Devolve id + lance anterior (para histórico). */
async function upsertLote(
  leiloeiroId: number,
  leilaoId: number,
  rawScrapeId: number,
  l: DbLot,
): Promise<{ id: number; lanceAnterior: number | null; codigoFipeAnterior: string | null }> {
  const status = mapStatus(l.statusTexto);
  const r = await pool.query(
    `INSERT INTO lotes (
       leilao_id, leiloeiro_id, external_id, numero_lote, tipo, marca, modelo,
       ano_fabricacao, ano_modelo, cor, combustivel, km, condicao, tem_chave,
       descricao, lance_inicial, lance_atual, status, pagina_url, raw_scrape_id,
       origem, comitente, cidade, uf, financiavel, valor_mercado
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::status_lote,$19,$20,
       $21,$22,$23,$24,$25,$26)
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
       valor_mercado = COALESCE(EXCLUDED.valor_mercado, lotes.valor_mercado),
       last_seen_at = now(),
       -- lote que reaparece volta a ser ativo: fonte que oscila (ou
       -- coleta que falhou uma vez) não deixa acervo morto para trás
       encerrado_em = NULL,
       updated_at = now()
     RETURNING id,
       (SELECT lance_atual FROM lotes o WHERE o.leiloeiro_id = $2 AND o.external_id = $3) AS lance_anterior,
       (SELECT codigo_fipe FROM lotes o WHERE o.leiloeiro_id = $2 AND o.external_id = $3) AS codigo_fipe_anterior`,
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
      l.financiavel ?? null, l.valorMercado ?? null,
    ],
  );
  return {
    id: r.rows[0].id,
    lanceAnterior: r.rows[0].lance_anterior != null ? Number(r.rows[0].lance_anterior) : null,
    codigoFipeAnterior: r.rows[0].codigo_fipe_anterior ?? null,
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

/**
 * Insere TODAS as fotos do lote numa query só.
 *
 * Antes era um INSERT por imagem: com ~8.300 imagens na base, eram 8.300
 * round-trips até a Supabase em sa-east-1 — de longe o maior custo do
 * normalize. `unnest` transforma os dois arrays em linhas, e o
 * ON CONFLICT DO NOTHING mantém a idempotência.
 */
async function inserirImagens(loteId: number, urls: string[]) {
  // dedup: URL repetida no mesmo array conflitaria contra si mesma
  const unicas = [...new Set(urls.filter(Boolean))];
  if (!unicas.length) return;

  await pool.query(
    `INSERT INTO lote_imagens (lote_id, url, ordem)
     SELECT $1, u.url, u.ordem
     FROM unnest($2::text[], $3::int[]) AS u(url, ordem)
     ON CONFLICT (lote_id, url) DO NOTHING`,
    [loteId, unicas, unicas.map((_, i) => i)],
  );
}

/** Devolve true só quando houve preço FIPE de fato (match novo ou cache). */
async function aplicarFipeEScore(
  loteId: number,
  l: DbLot,
  taxaComissao: number,
  codigoFipeAnterior: string | null,
): Promise<boolean> {
  // O código FIPE de execução anterior vem do RETURNING do upsert — antes
  // isto era um SELECT extra por lote, só para descobrir o que o próprio
  // upsert já sabia.
  let fipePrecoId: number | null = null;
  let codigoFipe: string | null = null;
  let preco: number | null = null;
  let matchScore: number | null = null;

  if (codigoFipeAnterior && l.anoModelo) {
    codigoFipe = codigoFipeAnterior;
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
    // art. 895 do CPC: 25% de sinal + saldo em até 30 parcelas. Vale por
    // leilão, não por leiloeiro — o juízo pode exigir pagamento à vista.
    const parc = detectarParcelamento(a.condicoesVenda);
    await pool.query(
      `INSERT INTO leiloes (
         leiloeiro_id, external_id, titulo, pagina_url, modalidade,
         data_inicio, cidade, comitente, edital_pdf_url,
         condicoes_venda, condicoes_pagamento, leiloeiro_nome, jucesp, is_judicial,
         permite_parcelamento, parcelamento_entrada_pct, parcelamento_parcelas_max,
         parcelamento_trecho
       ) VALUES ($1,$2,$3,$4,$5::modalidade_leilao,$6,$7,$8,$9,$10,$11,$12,$13,$14,
         $15,$16,$17,$18)
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
         permite_parcelamento      = EXCLUDED.permite_parcelamento,
         parcelamento_entrada_pct  = EXCLUDED.parcelamento_entrada_pct,
         parcelamento_parcelas_max = EXCLUDED.parcelamento_parcelas_max,
         parcelamento_trecho       = EXCLUDED.parcelamento_trecho,
         updated_at          = now()`,
      [
        leiloeiroId, a.externalId, a.titulo ?? null,
        `https://www.sodresantoro.com.br/leilao/${a.externalId}`,
        a.modalidade ?? 'online',
        a.dataInicio ?? null, a.cidade ?? null, a.comitente ?? null,
        a.editalPdfUrl ?? null, a.condicoesVenda ?? null, a.condicoesPagamento ?? null,
        a.leiloeiroNome ?? null, a.jucesp ?? null, a.isJudicial ?? null,
        parc.permite, parc.entradaPct ?? null, parc.parcelasMax ?? null,
        parc.trecho ?? null,
      ],
    );
    ok++;
  }
  return ok;
}

/**
 * Fração mínima do acervo ativo que a coleta precisa ter revisto para que
 * a expiração seja aplicada.
 *
 * Sem isso, uma coleta parcial (fonte fora do ar no meio da paginação,
 * mudança de layout que quebra o parser, categoria que falhou) encerraria
 * o acervo inteiro de uma vez — e a recuperação exigiria recoletar tudo.
 * 0.5 é conservador: mesmo que a fonte tire metade dos lotes de uma
 * semana para a outra, ainda expira.
 */
const FRACAO_MINIMA_PARA_EXPIRAR = 0.5;

/**
 * Marca como encerrado o lote que a fonte não mostra mais.
 *
 * O critério é ausência na coleta, não data: só o Superbid publica
 * data_fim de forma confiável (os outros vêm nulos), então esperar a data
 * passar deixaria lote morto no ar por tempo indeterminado.
 *
 * `inicio` é o instante anterior ao processamento deste scrape. Lote com
 * last_seen_at >= inicio foi revisto agora; o resto sumiu.
 *
 * Reversível de propósito: se o lote reaparecer numa coleta seguinte, o
 * upsert limpa encerrado_em. Fonte que oscila não perde acervo.
 */
async function marcarEncerrados(
  leiloeiroId: number,
  slug: string,
  inicio: string,
): Promise<void> {
  const contagem = await pool.query(
    `SELECT count(*) FILTER (WHERE last_seen_at >= $2) AS revistos,
            count(*) AS ativos
     FROM lotes
     WHERE leiloeiro_id = $1 AND encerrado_em IS NULL`,
    [leiloeiroId, inicio],
  );
  const revistos = Number(contagem.rows[0].revistos);
  const ativos = Number(contagem.rows[0].ativos);

  if (ativos > 0 && revistos / ativos < FRACAO_MINIMA_PARA_EXPIRAR) {
    console.warn(
      `[normalizer] ${slug}: coleta reviu só ${revistos}/${ativos} lotes ativos ` +
        `(< ${FRACAO_MINIMA_PARA_EXPIRAR * 100}%) — expiração NÃO aplicada, ` +
        `provável coleta parcial`,
    );
    return;
  }

  const r = await pool.query(
    `UPDATE lotes SET encerrado_em = now(), updated_at = now()
     WHERE leiloeiro_id = $1 AND encerrado_em IS NULL AND last_seen_at < $2`,
    [leiloeiroId, inicio],
  );
  if (r.rowCount) console.log(`[normalizer] ${slug}: ${r.rowCount} lotes encerrados (sumiram da fonte)`);
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
      // instante de referência para a expiração: quem não for revisto
      // daqui para frente é lote que saiu da fonte
      const inicio = (await pool.query('SELECT now() AS t')).rows[0].t;
      let ok = 0;
      let comFipe = 0;

      for (const doc of docs) {
        const l = mapper(doc);
        if (!l) continue;

        const leilaoId = await upsertLeilao(leiloeiro.id, l.auctionExternalId, doc, row.slug);
        const { id: loteId, lanceAnterior, codigoFipeAnterior } = await upsertLote(
          leiloeiro.id, leilaoId, row.id, l,
        );
        await registrarLance(loteId, l.lanceAtual, lanceAnterior);
        await inserirImagens(loteId, l.imagens);

        // FIPE só para lote com dado mínimo — e sucata nem tenta
        if (l.marca && l.modelo && l.anoModelo) {
          try {
            // conta só quando houve preço FIPE de fato, não toda tentativa
            if (await aplicarFipeEScore(loteId, l, leiloeiro.taxa_comissao, codigoFipeAnterior)) comFipe++;
          } catch (e) {
            console.warn(`[normalizer] FIPE falhou p/ lote ${l.externalId}:`, (e as Error).message);
          }
        }
        ok++;
      }

      // só depois de processar TODOS os lotes deste scrape: senão
      // encerraríamos lote que ainda estava na fila para ser revisto
      await marcarEncerrados(leiloeiro.id, row.slug, inicio);

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
