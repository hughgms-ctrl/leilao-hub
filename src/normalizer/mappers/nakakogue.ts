import type { DbLot } from './sodre';
import { parseShortDesc } from './superbid';

/**
 * Mapper: lote do Nakakogue -> registro para `lotes`.
 *
 * A descrição vem em texto corrido do oficial, com o veículo no começo:
 *
 *   "Um veiculo VW/GOL SPECIAL - Placa: MVX-4978; ano 1996"
 *   "MMC OUTLANDER 3.0 GT, 2015/2016"
 *   "Motocicleta HONDA/CG 150 TITAN KS, Placa: AMB-1234"
 *
 * parseShortDesc já lida com prefixo ("Um veiculo", "Motocicleta"), com
 * barra na marca e com ano em par ou solto — é o sexto mapper a reusá-lo.
 */

const RX_MOTO = /\b(motocicleta|moto|cg|cb|cbx|xre|bros|titan|fan|biz|pop|xtz|ybr|nxr)\b/i;
const RX_PESADO =
  /\b(caminh[ãa]o|[ôo]nibus|carreta|semirreboque|reboque|cavalo mec|trator|[ôo]nibus)\b/i;

export function mapNakakogueDoc(d: Record<string, any>): DbLot | null {
  if (!d.leilaoId || !d.numeroLote) return null;

  const bruta = String(d.descricao ?? '');
  // Aqui convivem três separadores de campo: ponto-e-vírgula, hífen e
  // travessão ("VW/GOL SPECIAL - Placa: MVX-4978; ano 1996"). Sem
  // normalizar todos, "- Placa: MVX-4978" entrava dentro do modelo.
  // O hífen COLADO fica (MVX-4978, CG-150): só o cercado por espaço é
  // separador.
  const p = parseShortDesc(bruta.replace(/;/g, ',').replace(/\s+[-–—]\s+/g, ', '));

  const tipo = RX_PESADO.test(bruta)
    ? 'implementos rod.'
    : RX_MOTO.test(bruta)
      ? 'motos'
      : 'carros';

  const situacao = String(d.situacao ?? '').toLowerCase();

  return {
    // o número do lote se repete entre leilões; a chave junta os dois
    externalId: `${d.leilaoId}-${d.numeroLote}`,
    auctionExternalId: String(d.leilaoId),
    numeroLote: String(d.numeroLote),
    tipo,
    marca: p.marca,
    modelo: p.modelo,
    anoFabricacao: p.anoFab,
    anoModelo: p.anoModelo,
    cor: p.cor,
    combustivel: undefined,
    km: undefined,
    condicao: /sucata/i.test(bruta) ? 'sucata' : undefined,
    origem: /judicial/i.test(String(d.tipoLeilao ?? '')) ? 'judicial' : undefined,
    // o "Edital" é o juízo responsável — serve de comitente
    comitente: d.auction_name ? String(d.auction_name).toLowerCase() : undefined,
    statusTexto: /venda|aberto/.test(situacao) ? 'disponivel' : d.situacao || undefined,
    temChave: undefined,
    financiavel: undefined,
    descricao: bruta || undefined,
    lanceInicial: typeof d.valorMinimo === 'number' ? d.valorMinimo : undefined,
    lanceAtual: typeof d.lanceAtual === 'number' ? d.lanceAtual : undefined,
    valorMercado: typeof d.avaliacao === 'number' ? d.avaliacao : undefined,
    imagens: d.imagem ? [String(d.imagem)] : [],
    // o card não publica cidade; o juízo dá a comarca, mas extrair
    // cidade de "02ª Vara do Trabalho de Curitiba" seria inferência
    cidade: undefined,
    uf: undefined,
    paginaUrl: String(d.paginaUrl ?? ''),
  };
}
