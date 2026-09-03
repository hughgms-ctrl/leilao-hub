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
  const detalhe = String(d.descricao ?? '');
  // "Veículo X, cor azul, ... Ano/Modelo 2000/2000" já vem com vírgula,
  // que é o separador que parseShortDesc espera
  const bruta = detalhe ? `${titulo}, ${detalhe.replace(/^Ve[íi]culo\s+/i, '')}` : titulo;

  const p = parseShortDesc(bruta);
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
    anoFabricacao: p.anoFab,
    anoModelo: p.anoModelo,
    cor: p.cor,
    combustivel: /\b(gasolina|diesel|flex|[áa]lcool|etanol)\b/i.exec(bruta)?.[1]?.toLowerCase(),
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
