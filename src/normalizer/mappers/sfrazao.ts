import type { DbLot } from './sodre';
import { parseShortDesc } from './superbid';

/**
 * Mapper: card de lote do S. Frazão -> registro para `lotes`.
 *
 * A descrição vem curta e regular — "HONDA/CG 160 FAN, 2019",
 * "GM CHEVROLET D40, 1985", "YAMAHA XTZ 250X, 2009" — que é o mesmo
 * formato do Superbid. Reuso parseShortDesc em vez de escrever um
 * terceiro parser de marca/modelo/ano.
 *
 * O card já traz avaliação, lance mínimo e 2ª praça com deságio. A
 * avaliação vira valor_mercado; o lance mínimo é o que se paga na praça
 * em curso.
 */

/**
 * Modelos e palavras que denunciam moto ou caminhão. A FIPE tem tabelas
 * separadas: mandar uma CG 160 para a tabela de carro não acha nada, e
 * mandar um Atego acha o carro errado.
 */
const RX_MOTO =
  /\b(cg|cb|cbx|xre|bros|titan|fan|biz|pop|xtz|factor|fazer|ybr|crosser|lander|tenere|hornet|twister|falcon|burgman|intruder|virago|shadow|harley|motocicleta|moto)\b/i;

const RX_PESADO =
  /\b(atego|axor|actros|accelo|constellation|worker|delivery|cargo|vw\s*\d{2}\.\d{3}|marcopolo|busscar|caio|neobus|comil|[ôo]nibus|caminh[ãa]o|micro[- ]?[ôo]nibus|volare|daily|iveco|scania|r\s*440|fh\s*\d{3})\b/i;

export function tipoDeDescricao(desc: string): string {
  const d = desc || '';
  if (RX_PESADO.test(d)) return 'caminhões';
  if (RX_MOTO.test(d)) return 'motos';
  return 'carros';
}

/** "... EM CANDEIAS DO JAMARI/RO" -> cidade + uf */
export function localDeDescricao(desc: string): { cidade?: string; uf?: string } {
  const m = (desc || '').match(/\bem\s+([A-Za-zÀ-ÿ'.\s]{3,40})\/([A-Z]{2})\b/i);
  if (!m) return {};
  return { cidade: m[1].trim().toLowerCase(), uf: m[2].toUpperCase() };
}

export function mapSfrazaoDoc(d: Record<string, any>): DbLot | null {
  if (!d.leilaoId || !d.loteId) return null;

  const bruta = String(d.descricao ?? '');
  const p = parseShortDesc(bruta);
  const local = localDeDescricao(bruta);

  // Lote com "diversos" no nome é pacote (vários bens num lote só) —
  // marca/modelo não descrevem um veículo e a FIPE não se aplica.
  const ehPacote = /\bdiversos\b/i.test(bruta);

  return {
    externalId: `${d.leilaoId}-${d.loteId}`,
    auctionExternalId: String(d.leilaoId),
    numeroLote: d.numeroLote ? String(d.numeroLote) : undefined,
    tipo: ehPacote ? 'outros' : tipoDeDescricao(bruta),
    marca: ehPacote ? undefined : p.marca,
    modelo: ehPacote ? undefined : p.modelo,
    anoFabricacao: p.anoFab,
    anoModelo: p.anoModelo,
    cor: p.cor,
    combustivel: undefined,
    km: undefined,
    condicao: /sucata/i.test(bruta) ? 'sucata' : undefined,
    origem: /judicial/i.test(String(d.tipoLeilao ?? '')) ? 'judicial' : undefined,
    comitente: undefined,
    statusTexto: 'disponivel',
    temChave: undefined,
    financiavel: undefined,
    descricao: bruta || undefined,
    // a praça em curso é a que vale; a 2ª só entra quando publicada, e aí
    // é ela o preço real de entrada (o site já mostra o deságio)
    lanceInicial:
      typeof d.segundaPraca === 'number' ? d.segundaPraca
      : typeof d.lanceMinimo === 'number' ? d.lanceMinimo
      : undefined,
    lanceAtual: typeof d.maiorLance === 'number' ? d.maiorLance : undefined,
    valorMercado: typeof d.avaliacao === 'number' ? d.avaliacao : undefined,
    imagens: d.imagem ? [String(d.imagem)] : [],
    cidade: local.cidade,
    uf: local.uf,
    paginaUrl: String(d.paginaUrl ?? ''),
  };
}
