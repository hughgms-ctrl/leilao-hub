export interface Lote {
  id: number;
  external_id: string;
  marca: string | null;
  modelo: string | null;
  ano_fabricacao: number | null;
  ano_modelo: number | null;
  tipo: string | null;
  condicao: string | null;
  origem: string | null;
  cor: string | null;
  km: number | null;
  status: string;
  cidade: string | null;
  uf: string | null;
  numero_lote: string | null;
  lance_inicial: string | null;
  lance_atual: string | null;
  lance_referencia: string | null;
  custo_estimado_total: string | null;
  score_oportunidade: string | null;
  score_tipo: 'confirmado' | 'especulativo' | null;
  fipe_match_score: string | null;
  codigo_fipe: string | null;
  fipe_preco: string | null;
  pagina_url: string | null;
  imagens: string[] | null;
  financiavel: boolean | null;
  leiloeiro: string | null;
  leiloeiro_slug: string | null;
  permite_parcelamento: boolean | null;
  parcelamento_entrada_pct: string | null;
  parcelamento_parcelas_max: number | null;
  is_judicial: boolean | null;
  data_fim: string | null;
}

export interface ListaResposta {
  itens: Lote[];
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
}

export interface GrupoStat {
  valor: string;
  total: number;
  com_score: number;
}

export interface Stats {
  total_lotes: number;
  com_fipe: number;
  com_score: number;
  confirmados: number;
  especulativos: number;
  financiaveis: number;
  parcelaveis: number;
  judiciais: number;
  score_medio: number | null;
  por_tipo: GrupoStat[];
  por_uf: GrupoStat[];
  por_condicao: GrupoStat[];
  por_origem: GrupoStat[];
  por_leiloeiro: (GrupoStat & { nome: string })[];
  marcas: GrupoStat[];
}

export interface LanceHistorico {
  valor: string;
  observado_em: string;
}

/** Resposta de GET /api/lotes/:id — o lote mais o contexto do leilão. */
export interface LoteDetalhe extends Lote {
  descricao: string | null;
  combustivel: string | null;
  tem_chave: boolean | null;
  comitente: string | null;
  first_seen_at: string | null;
  last_seen_at: string | null;

  leilao_external_id: string | null;
  leilao_titulo: string | null;
  leilao_url: string | null;
  data_inicio: string | null;
  data_fim: string | null;
  modalidade: string | null;
  leilao_cidade: string | null;
  leilao_status: string | null;
  edital_pdf_url: string | null;
  condicoes_pagamento: string | null;
  leilao_leiloeiro: string | null;
  jucesp: string | null;
  is_judicial: boolean | null;

  leiloeiro_slug: string | null;
  leiloeiro_nome: string | null;
  taxa_comissao: string | null;

  fipe_marca: string | null;
  fipe_modelo: string | null;
  fipe_mes_referencia: string | null;

  parcelamento_trecho: string | null;
  historico_lances: LanceHistorico[];
}
