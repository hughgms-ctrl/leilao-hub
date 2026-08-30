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
  imagem: string | null;
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
  score_medio: number | null;
  por_tipo: GrupoStat[];
  por_uf: GrupoStat[];
  por_condicao: GrupoStat[];
  por_origem: GrupoStat[];
  marcas: GrupoStat[];
}
