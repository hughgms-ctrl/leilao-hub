// Contrato comum entre qualquer adapter e o resto do sistema.
// Estes tipos futuramente migram para packages/shared no monorepo.

export interface RawAuction {
  externalId: string;
  titulo: string;
  descricao?: string;
  modalidade?: 'online' | 'presencial' | 'hibrido';
  dataInicio?: string; // ISO
  dataFim?: string;    // ISO
  cidade?: string;
  uf?: string;
  editalPdfUrl?: string;
  paginaUrl: string;
  comitente?: string;
}

export interface RawLot {
  externalId: string;
  auctionExternalId: string;
  numeroLote?: string;
  tipo?: string;        // texto cru do site; normalizer mapeia p/ enum
  marca?: string;
  modelo?: string;
  versao?: string;
  anoFabricacao?: number;
  anoModelo?: number;
  cor?: string;
  combustivel?: string;
  km?: number;
  condicao?: string;    // texto cru ('sinistrado', 'sucata'...)
  temChave?: boolean;
  documentacao?: string;
  descricao?: string;
  lanceInicial?: number;
  lanceAtual?: number;
  valorMercado?: number;
  imagens: string[];
  paginaUrl: string;
}

export interface ScraperAdapter {
  /** slug do leiloeiro, igual ao campo leiloeiros.slug no banco */
  slug: string;

  /** lista os leilões abertos/agendados visíveis no site */
  fetchAuctions(): Promise<RawAuction[]>;

  /** lista os lotes de um leilão específico */
  fetchLots(auction: RawAuction): Promise<RawLot[]>;
}

export interface ScrapeResult {
  tipo: 'auction_list' | 'lot_detail';
  url?: string;
  payload: unknown;
}
