/**
 * Mapper: documento BRUTO do Sodré Santoro (como está em raw_scrapes.payload)
 * → registro pronto para upsert em `lotes`.
 *
 * Baseado no formato real descoberto: documentos planos (sem _source),
 * lot_id como id verdadeiro, bid_initial/bid_actual como STRING,
 * lot_pictures como array de URLs absolutas, URL /leilao/{auction_id}/lote/{lot_id}.
 *
 * Campos validados contra sample-response.json (50 documentos reais):
 *   - numero_lote  -> lot_number           (50/50 preenchidos, ex: "0120")
 *   - ano fabric.  -> lot_year_manufacture (50/50; lot_year_fab NAO existe)
 *   - status texto -> lot_status           (50/50; lot_status_label NAO existe)
 *     valores vistos: retirado / repasse / vendido (lot_status_id 5/8/9)
 *   - tem_chave    -> lot_optionals inclui "chave-ignicao" (31/50) - confere
 */

export interface DbLot {
  externalId: string;
  auctionExternalId: string;
  numeroLote?: string;
  tipo?: string;
  marca?: string;
  modelo?: string;
  anoFabricacao?: number;
  anoModelo?: number;
  cor?: string;
  combustivel?: string;
  km?: number;
  condicao?: string;      // lot_sinister (texto cru)
  origem?: string;        // lot_origin
  comitente?: string;     // client_name
  statusTexto?: string;   // retirado/repasse/vendido/andamento...
  temChave?: boolean;
  descricao?: string;
  lanceInicial?: number;
  lanceAtual?: number;    // só quando bid_has_bid
  imagens: string[];
  cidade?: string;
  uf?: string;
  paginaUrl: string;
}

const BASE_URL = 'https://www.sodresantoro.com.br';

function toInt(v: unknown): number | undefined {
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? n : undefined;
}

function toNum(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function mapSodreDoc(d: Record<string, any>): DbLot | null {
  const lotId = d.lot_id ?? null;
  const auctionId = d.auction_id ?? null;
  if (!lotId || !auctionId) return null;

  const location: string = d.lot_location ?? '';
  const [cidade, uf] = location.split('/').map((s: string) => s?.trim());

  const hasBid = d.bid_has_bid === true;

  return {
    externalId: String(lotId),
    auctionExternalId: String(auctionId),
    numeroLote: d.lot_number != null ? String(d.lot_number) : undefined,
    tipo: d.lot_category ?? undefined,
    marca: d.lot_brand ?? undefined,
    modelo: d.lot_model ?? undefined,
    anoFabricacao: toInt(d.lot_year_manufacture),
    anoModelo: toInt(d.lot_year_model),
    cor: d.lot_color ?? undefined,
    combustivel: d.lot_fuel ?? undefined,
    km: toInt(d.lot_km),
    condicao: d.lot_sinister ?? undefined,
    origem: d.lot_origin ?? undefined,
    comitente: d.client_name ?? undefined,
    statusTexto: d.lot_status ?? undefined,
    temChave: Array.isArray(d.lot_optionals)
      ? d.lot_optionals.includes('chave-ignicao')
      : undefined,
    descricao: d.lot_description ?? d.lot_title ?? undefined,
    lanceInicial: toNum(d.bid_initial),
    lanceAtual: hasBid ? toNum(d.bid_actual) : undefined,
    imagens: Array.isArray(d.lot_pictures) ? d.lot_pictures.filter(Boolean) : [],
    cidade: cidade || undefined,
    uf: uf ? uf.toUpperCase().slice(0, 2) : undefined,
    paginaUrl: `${BASE_URL}/leilao/${auctionId}/lote/${lotId}`,
  };
}

/** lot_status texto → enum status_lote do banco */
export function mapStatus(statusTexto?: string, lotStatusId?: number): string {
  if (lotStatusId === 1) return 'em_pregao';
  const s = (statusTexto ?? '').toLowerCase();
  if (/vendid/.test(s)) return 'vendido';
  if (/retirad/.test(s)) return 'retirado';
  if (/repasse|condicional/.test(s)) return 'condicional';
  if (/nao vendido|não vendido/.test(s)) return 'nao_vendido';
  if (/andamento|pregao|pregão/.test(s)) return 'em_pregao';
  return 'disponivel';
}
