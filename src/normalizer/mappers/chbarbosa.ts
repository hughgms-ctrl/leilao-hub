import type { DbLot } from './sodre';
import { parseShortDesc } from './superbid';

/**
 * Mapper: lote do CH Barbosa -> registro para `lotes`.
 *
 * O título já traz marca, modelo e ano:
 *   "MOTOCICLETA YAMAHA/YBR 125E - 2006/2006"
 *   "TOYOTA HILUX CS4X4, ANO 2009/2009"
 *   "CAMIHÕES M-BENZ / CONJ CARRETA BASCULANTE"   (o typo é da fonte)
 *
 * Oitavo mapper a reusar parseShortDesc.
 */

const RX_MOTO = /\b(motocicleta|moto|ybr|cg|cb|cbx|xre|bros|titan|fan|biz|pop|xtz)\b/i;
// "CAMIHÕES" está escrito assim na fonte — a regex cobre as duas grafias
const RX_PESADO = /\b(cami[nh]?h[õo]es|caminh[ãa]o|[ôo]nibus|carreta|basculante|cavalo mec|trator)\b/i;

export function mapChBarbosaDoc(d: Record<string, any>): DbLot | null {
  if (!d.loteId) return null;

  const titulo = String(d.titulo ?? '');
  // " / " e " - " separam campos aqui ("M-BENZ / CONJ CARRETA")
  const p = parseShortDesc(titulo.replace(/\s+[-–—]\s+/g, ', '));

  const tipo = RX_PESADO.test(titulo)
    ? 'caminhões'
    : RX_MOTO.test(titulo)
      ? 'motos'
      : 'carros';

  return {
    externalId: String(d.loteId),
    // o site não expõe id de leilão na listagem; o lote é a chave
    auctionExternalId: String(d.loteId),
    numeroLote: String(d.loteId),
    tipo,
    marca: p.marca,
    modelo: p.modelo,
    anoFabricacao: p.anoFab,
    anoModelo: p.anoModelo,
    cor: p.cor,
    combustivel: undefined,
    km: undefined,
    condicao: /sucata/i.test(titulo) ? 'sucata' : undefined,
    // todo o acervo de veículos vem de comarca; o adapter confirma no
    // detalhe quando disponível
    origem: /judicial/i.test(String(d.tipoLeilao ?? '')) ? 'judicial' : undefined,
    comitente: d.auction_name ? String(d.auction_name).toLowerCase() : undefined,
    statusTexto: 'disponivel',
    temChave: undefined,
    financiavel: undefined,
    descricao: titulo || undefined,
    // a 2ª praça é o preço real de entrada quando publicada — aqui ela
    // vem sempre com 50% de deságio sobre a avaliação
    lanceInicial:
      typeof d.praca2 === 'number' ? d.praca2
      : typeof d.praca1 === 'number' ? d.praca1
      : undefined,
    lanceAtual: undefined,
    valorMercado: typeof d.avaliacao === 'number' ? d.avaliacao : undefined,
    imagens: d.imagem ? [String(d.imagem)] : [],
    cidade: undefined,
    uf: undefined,
    paginaUrl: String(d.paginaUrl ?? ''),
  };
}
