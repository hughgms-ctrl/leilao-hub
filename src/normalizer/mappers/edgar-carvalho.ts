import type { DbLot } from './sodre';
import { parseShortDesc } from './superbid';

/**
 * Mapper: lote do Edgar de Carvalho -> registro para `lotes`.
 *
 * O título é limpo para marca/modelo ("CARRO FORD ECOSPORT") e a
 * descrição do detalhe é quem tem ano e cor:
 *
 *   "Veículo objeto de restrição pelo sistema RENAJUD; veículo FORD
 *    ECOSPORT PLACA KXZ5624 RJ, modelo XLT 1.6 Flex, cor prata,
 *    ano 2009/2010, CHASSI ..."
 *
 * Os dois entram juntos em parseShortDesc — sétimo mapper a reusá-lo.
 */

const RX_MOTO = /\b(motocicleta|moto|cg|cb|cbx|xre|bros|titan|fan|biz|pop|xtz|ybr|nxr)\b/i;
const RX_PESADO = /\b(caminh[ãa]o|[ôo]nibus|carreta|van|furg[ãa]o|trator)\b/i;

export function mapEdgarCarvalhoDoc(d: Record<string, any>): DbLot | null {
  if (!d.leilaoId || !d.loteId) return null;

  const titulo = String(d.titulo ?? '');
  const detalhe = String(d.descricao ?? '');
  // ponto-e-vírgula separa cláusulas na descrição do oficial
  const bruta = `${titulo}, ${detalhe}`.replace(/;/g, ',').replace(/^,\s*/, '');
  const p = parseShortDesc(bruta);

  const categoria = String(d.categoria ?? '').toLowerCase();
  const tipo =
    /moto/.test(categoria) || RX_MOTO.test(titulo)
      ? 'motos'
      : /caminh|onibus/.test(categoria) || RX_PESADO.test(titulo)
        ? 'caminhões'
        : 'carros';

  return {
    externalId: `${d.leilaoId}-${d.loteId}`,
    auctionExternalId: String(d.leilaoId),
    numeroLote: String(d.loteId),
    tipo,
    marca: p.marca,
    modelo: p.modelo,
    anoFabricacao: p.anoFab,
    anoModelo: p.anoModelo,
    cor: p.cor,
    combustivel: /\b(gasolina|diesel|flex|[áa]lcool|etanol)\b/i.exec(bruta)?.[1]?.toLowerCase(),
    km: undefined,
    condicao: /sucata/i.test(bruta) ? 'sucata' : undefined,
    origem: /judicial/i.test(String(d.tipoLeilao ?? '')) ? 'judicial' : undefined,
    comitente: d.comitente ? String(d.comitente).toLowerCase() : undefined,
    statusTexto: 'disponivel',
    temChave: undefined,
    financiavel: undefined,
    descricao: bruta || undefined,
    // com 2ª praça publicada é ela o preço de entrada; senão a 1ª
    lanceInicial:
      typeof d.lance2 === 'number' ? d.lance2
      : typeof d.lance1 === 'number' ? d.lance1
      : undefined,
    lanceAtual: undefined,
    valorMercado: typeof d.avaliacao === 'number' ? d.avaliacao : undefined,
    imagens: d.imagem ? [String(d.imagem)] : [],
    // o site não publica cidade do bem no card nem no detalhe
    cidade: undefined,
    uf: undefined,
    paginaUrl: String(d.paginaUrl ?? ''),
  };
}
