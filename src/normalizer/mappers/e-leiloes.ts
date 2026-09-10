import type { DbLot } from './sodre';
import { parseShortDesc } from './superbid';

/**
 * Mapper: lote do E-Leilões -> registro para `lotes`.
 *
 * O título da listagem não traz ano ("GM/Astra GLS"), então o adapter
 * busca o detalhe, de onde vem
 *
 *   "Veículo GM/Astra GLS, cor azul, Renavam ..., gasolina. ...
 *    Ano/Modelo 2000/2000"
 *
 * Título e descrição são concatenados aqui: o título é mais limpo para
 * marca/modelo, e a descrição é quem tem ano e cor. parseShortDesc
 * resolve os dois — é o quinto mapper que o reusa.
 */

const RX_MOTO = /\b(motocicleta|moto|cg|cb|cbx|xre|bros|titan|fan|biz|pop|xtz|ybr|nxr)\b/i;
const RX_PESADO = /\b(caminh[ãa]o|[ôo]nibus|carreta|cavalo mec|trator|picape cd 4p)\b/i;

export function mapELeiloesDoc(d: Record<string, any>): DbLot | null {
  if (!d.loteId) return null;

  const titulo = String(d.titulo ?? '');
  // Ano e cor vêm em CAMPO do detalhe, não dentro de um texto — o site
  // escreve cada lote de um jeito. parseShortDesc cuida só de
  // marca/modelo, a partir do título.
  const p = parseShortDesc(titulo);
  const anoFab = typeof d.anoFab === 'number' ? d.anoFab : p.anoFab;
  const anoModelo = typeof d.anoModelo === 'number' ? d.anoModelo : p.anoModelo;
  const bruta = titulo;
  const [cidade, uf] = String(d.cidadeUf ?? '').split(' - ').map((s: string) => s?.trim());

  const tipo = RX_PESADO.test(titulo) ? 'caminhões' : RX_MOTO.test(titulo) ? 'motos' : 'carros';

  // "Conservação Ruim" é dado do leiloeiro, não inferência nossa
  const conserv = d.conservacao ? String(d.conservacao).toLowerCase() : undefined;

  return {
    externalId: String(d.loteId),
    // o site não expõe id de leilão; a vara identifica o pregão
    auctionExternalId: String(d.auction_name ?? `lote-${d.loteId}`),
    numeroLote: d.numeroLote ? String(d.numeroLote) : undefined,
    tipo,
    marca: p.marca,
    modelo: p.modelo,
    anoFabricacao: anoFab,
    anoModelo: anoModelo,
    cor: d.cor ? String(d.cor) : p.cor,
    // o combustível vem do detalhe; o título raramente o traz
    combustivel: d.combustivel
      ? String(d.combustivel)
      : /\b(gasolina|diesel|flex|[áa]lcool|etanol)\b/i.exec(bruta)?.[1]?.toLowerCase(),
    km: undefined,
    condicao: /sucata/i.test(bruta) ? 'sucata' : conserv,
    origem: /judicial/i.test(String(d.tipoLeilao ?? '')) ? 'judicial' : undefined,
    comitente: undefined,
    statusTexto: d.statusTexto ? String(d.statusTexto) : undefined,
    temChave: undefined,
    financiavel: undefined,
    descricao: bruta || undefined,
    // "Leilão Único" é o preço de venda; a avaliação vira valor de mercado
    lanceInicial: typeof d.valorVenda === 'number' ? d.valorVenda : undefined,
    lanceAtual: typeof d.lanceAtual === 'number' ? d.lanceAtual : undefined,
    valorMercado: typeof d.avaliacao === 'number' ? d.avaliacao : undefined,
    imagens: d.imagem ? [String(d.imagem)] : [],
    cidade: cidade ? cidade.toLowerCase() : undefined,
    uf: uf ? uf.toUpperCase().slice(0, 2) : undefined,
    paginaUrl: String(d.paginaUrl ?? ''),
  };
}
