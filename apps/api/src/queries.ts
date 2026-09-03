import { pool, LANCE_REF_SQL } from './db.js';
import type { ListaLotesQuery } from './schemas.js';

export interface OpcoesLista {
  /** exige score_oportunidade não nulo (usado por /api/oportunidades) */
  apenasComScore?: boolean;
}

/** Monta o WHERE parametrizado compartilhado entre a listagem e o count. */
function montarFiltros(q: ListaLotesQuery, opts: OpcoesLista = {}) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.apenasComScore) where.push('l.score_oportunidade IS NOT NULL');

  // Lote que saiu da listagem da fonte não aparece por padrão. Sem isto a
  // plataforma servia leilão já encerrado como se estivesse aberto — em
  // 03/09/2026 eram 1.823 de 5.598 lotes (33%). `incluir_encerrados=true`
  // traz de volta, para consulta de histórico.
  if (q.incluir_encerrados !== 'true') where.push('l.encerrado_em IS NULL');
  const add = (sql: string, valor: unknown) => {
    params.push(valor);
    where.push(sql.replace('?', `$${params.length}`));
  };

  if (q.preco_min !== undefined) add(`${LANCE_REF_SQL} >= ?`, q.preco_min);
  if (q.preco_max !== undefined) add(`${LANCE_REF_SQL} <= ?`, q.preco_max);
  if (q.ano_min !== undefined) add('l.ano_modelo >= ?', q.ano_min);
  if (q.ano_max !== undefined) add('l.ano_modelo <= ?', q.ano_max);
  if (q.score_min !== undefined) add('l.score_oportunidade >= ?', q.score_min);

  if (q.uf) add('l.uf = upper(?)', q.uf);
  if (q.tipo) add('lower(l.tipo) = lower(?)', q.tipo);
  if (q.condicao) add('lower(l.condicao) = lower(?)', q.condicao);
  if (q.origem) add('lower(l.origem) = lower(?)', q.origem);
  if (q.status) add('l.status::text = lower(?)', q.status);
  if (q.marca) add('lower(l.marca) = lower(?)', q.marca);
  if (q.leiloeiro) add('lo.slug = ?', q.leiloeiro);
  // parcelamento do art. 895 é propriedade do LEILÃO, não do lote
  if (q.parcelamento) add('le.permite_parcelamento IS NOT DISTINCT FROM ?', q.parcelamento === 'true');
  if (q.judicial) add('le.is_judicial IS NOT DISTINCT FROM ?', q.judicial === 'true');

  // Prazo para dar lance. `data_fim` guarda o PRÓXIMO encerramento ainda
  // futuro (praça ou ciclo), não o último — ver dataFimDoDoc no
  // normalizer. Leilão sem data fica de fora do filtro em vez de ser
  // tratado como "sem prazo": só 307 dos 812 tinham data antes desta
  // rodada, e assumir qualquer coisa daria resposta errada com cara de
  // certa.
  if (q.encerra_em !== undefined) {
    add(`le.data_fim IS NOT NULL AND le.data_fim <= now() + (? || ' days')::interval`, q.encerra_em);
    where.push('le.data_fim >= now()');
  }

  if (q.busca) {
    add(
      `(coalesce(l.marca,'') || ' ' || coalesce(l.modelo,'') || ' ' || coalesce(l.descricao,'')) ILIKE ?`,
      `%${q.busca}%`,
    );
  }

  if (q.financiavel) add('l.financiavel IS NOT DISTINCT FROM ?', q.financiavel === 'true');

  // 'todos' não filtra; ausência de score_tipo também não
  if (q.score_tipo && q.score_tipo !== 'todos') {
    add('l.score_tipo = ?', q.score_tipo);
  }

  return { clause: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

const ORDER_SQL: Record<string, string> = {
  score: 'l.score_oportunidade',
  preco: LANCE_REF_SQL,
  ano: 'l.ano_modelo',
};

const COLUNAS_ITEM = `
  l.id, l.external_id, l.marca, l.modelo, l.ano_fabricacao, l.ano_modelo,
  l.tipo, l.condicao, l.origem, l.cor, l.km, l.status::text AS status,
  l.cidade, l.uf, l.numero_lote,
  l.lance_inicial, l.lance_atual, ${LANCE_REF_SQL} AS lance_referencia,
  l.custo_estimado_total, l.score_oportunidade, l.score_tipo,
  l.fipe_match_score, l.codigo_fipe, fp.preco AS fipe_preco,
  l.financiavel,
  lo.slug AS leiloeiro_slug, lo.nome AS leiloeiro,
  le.permite_parcelamento, le.parcelamento_entrada_pct, le.parcelamento_parcelas_max,
  le.is_judicial,
  -- prazo para dar lance: e o proximo encerramento ainda futuro
  le.data_fim,
  l.pagina_url, img.urls AS imagens`;

export async function listarLotes(q: ListaLotesQuery, opts: OpcoesLista = {}) {
  const { clause, params } = montarFiltros(q, opts);
  const col = ORDER_SQL[q.order];
  const dir = q.dir === 'asc' ? 'ASC' : 'DESC';
  const offset = (q.page - 1) * q.per_page;

  const sql = `
    SELECT ${COLUNAS_ITEM}
    FROM lotes l
    JOIN leiloeiros lo ON lo.id = l.leiloeiro_id
    LEFT JOIN leiloes le ON le.id = l.leilao_id
    LEFT JOIN fipe_precos fp ON fp.id = l.fipe_preco_id
    LEFT JOIN LATERAL (
      -- ate 8 fotos por lote, na ordem, para o carrossel do card.
      -- O LIMIT fica na subconsulta interna: agregar tudo e cortar depois
      -- traria as 13+ fotos de cada lote so para descartar.
      SELECT array_agg(f.url ORDER BY f.ordem) AS urls
      FROM (
        SELECT li.url, li.ordem FROM lote_imagens li
        WHERE li.lote_id = l.id ORDER BY li.ordem LIMIT 8
      ) f
    ) img ON true
    ${clause}
    ORDER BY ${col} ${dir} NULLS LAST, l.id ASC
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;

  const countSql = `SELECT count(*)::int AS total FROM lotes l
    JOIN leiloeiros lo ON lo.id = l.leiloeiro_id
    LEFT JOIN leiloes le ON le.id = l.leilao_id ${clause}`;

  const [itens, total] = await Promise.all([
    pool.query(sql, [...params, q.per_page, offset]),
    pool.query(countSql, params),
  ]);

  return {
    itens: itens.rows,
    total: total.rows[0].total as number,
    page: q.page,
    per_page: q.per_page,
    total_pages: Math.max(1, Math.ceil(total.rows[0].total / q.per_page)),
  };
}

export async function buscarLote(id: number) {
  const lote = await pool.query(
    `SELECT ${COLUNAS_ITEM},
            l.descricao, l.combustivel, l.tem_chave, l.comitente,
            l.first_seen_at, l.last_seen_at,
            le.external_id AS leilao_external_id, le.titulo AS leilao_titulo,
            le.pagina_url AS leilao_url, le.data_inicio,
            le.modalidade, le.cidade AS leilao_cidade, le.status AS leilao_status,
            le.edital_pdf_url, le.condicoes_pagamento, le.leiloeiro_nome AS leilao_leiloeiro,
            le.jucesp, le.is_judicial,
            le.permite_parcelamento, le.parcelamento_entrada_pct,
            le.parcelamento_parcelas_max, le.parcelamento_trecho,
            lo.slug AS leiloeiro_slug, lo.nome AS leiloeiro_nome,
            lo.taxa_comissao,
            fp.marca AS fipe_marca, fp.modelo AS fipe_modelo,
            fp.mes_referencia AS fipe_mes_referencia
     FROM lotes l
     JOIN leiloeiros lo ON lo.id = l.leiloeiro_id
     LEFT JOIN fipe_precos fp ON fp.id = l.fipe_preco_id
     LEFT JOIN leiloes le ON le.id = l.leilao_id
     LEFT JOIN LATERAL (
       SELECT array_agg(f.url ORDER BY f.ordem) AS urls
       FROM (
         SELECT li.url, li.ordem FROM lote_imagens li
         WHERE li.lote_id = l.id ORDER BY li.ordem LIMIT 8
       ) f
     ) img ON true
     WHERE l.id = $1`,
    [id],
  );
  if (lote.rowCount === 0) return null;

  const [imagens, lances] = await Promise.all([
    pool.query(
      'SELECT url, ordem FROM lote_imagens WHERE lote_id = $1 ORDER BY ordem',
      [id],
    ),
    pool.query(
      'SELECT valor, observado_em FROM lote_lances_historico WHERE lote_id = $1 ORDER BY observado_em',
      [id],
    ),
  ]);

  return {
    ...lote.rows[0],
    // string[] igual a listagem: o carrossel consome os dois lugares.
    // Aqui vem a galeria COMPLETA (sem o LIMIT 8 do card).
    imagens: imagens.rows.map((r: { url: string }) => r.url),
    historico_lances: lances.rows,
  };
}

export async function estatisticas() {
  const geral = await pool.query(`
    SELECT count(*)::int AS total_lotes,
           count(codigo_fipe)::int AS com_fipe,
           count(score_oportunidade)::int AS com_score,
           count(*) FILTER (WHERE score_tipo = 'confirmado')::int AS confirmados,
           count(*) FILTER (WHERE score_tipo = 'especulativo')::int AS especulativos,
           count(*) FILTER (WHERE financiavel)::int AS financiaveis,
           (SELECT count(*)::int FROM lotes x JOIN leiloes y ON y.id = x.leilao_id
             WHERE y.permite_parcelamento AND x.encerrado_em IS NULL) AS parcelaveis,
           (SELECT count(*)::int FROM lotes x JOIN leiloes y ON y.id = x.leilao_id
             WHERE y.is_judicial AND x.encerrado_em IS NULL) AS judiciais,
           round(avg(score_oportunidade), 4) AS score_medio
    -- só acervo ativo: contar lote que saiu da fonte inflava tudo
    FROM lotes WHERE encerrado_em IS NULL`);

  const porGrupo = async (col: string) =>
    (
      await pool.query(
        `SELECT ${col} AS valor, count(*)::int AS total,
                count(score_oportunidade)::int AS com_score
         FROM lotes WHERE ${col} IS NOT NULL AND encerrado_em IS NULL
         GROUP BY ${col} ORDER BY total DESC`,
      )
    ).rows;

  const porLeiloeiro = (
    await pool.query(
      `SELECT lo.slug AS valor, lo.nome, count(*)::int AS total,
              count(l.score_oportunidade)::int AS com_score
       FROM lotes l JOIN leiloeiros lo ON lo.id = l.leiloeiro_id
       WHERE l.encerrado_em IS NULL
       GROUP BY lo.slug, lo.nome ORDER BY total DESC`,
    )
  ).rows;

  const [porTipo, porUf, porCondicao, porOrigem, marcas] = await Promise.all([
    porGrupo('tipo'),
    porGrupo('uf'),
    porGrupo('condicao'),
    porGrupo('origem'),
    porGrupo('marca'),
  ]);

  return {
    ...geral.rows[0],
    score_medio: geral.rows[0].score_medio === null ? null : Number(geral.rows[0].score_medio),
    por_tipo: porTipo,
    por_uf: porUf,
    por_condicao: porCondicao,
    por_origem: porOrigem,
    por_leiloeiro: porLeiloeiro,
    marcas,
  };
}
