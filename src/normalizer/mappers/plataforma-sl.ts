import type { DbLot } from './sodre';
import { parseShortDesc } from './superbid';

/**
 * Mapper: lote da plataforma "SL" -> registro para `lotes`.
 *
 * Serve os cinco leiloeiros que rodam esse software. Cada um é gravado
 * com o SEU próprio slug (o card precisa mostrar "Clademir Leilões", não
 * o nome da plataforma), então este mapper aparece cinco vezes no
 * registry do normalizer.
 *
 * A descrição chega já concatenada pelo adapter: o nome do card mais o
 * bloco DESCRIÇÃO do detalhe —
 *
 *   "FIAT/SIENA EL 1.4 FLEX, placa IUW 2434, cor branca, ano/mod. 2013/2014"
 *
 * que é o formato separado por vírgula do Superbid. Reuso parseShortDesc
 * em vez de escrever um quarto parser de marca/modelo/ano.
 */

/** "(GIRUA/RS)" no fim da descrição */
function localDeDescricao(desc: string): { cidade?: string; uf?: string } {
  const m = (desc || '').match(/\(([^()/]{2,40})\/([A-Z]{2})\)/);
  if (!m) return {};
  return { cidade: m[1].trim().toLowerCase(), uf: m[2].toUpperCase() };
}

const RX_MOTO =
  /\b(motocicleta|moto|cg|cb|cbx|xre|bros|titan|fan|biz|pop|xtz|factor|fazer|ybr|nxr)\b/i;
const RX_PESADO = /\b(caminh[ãa]o|[ôo]nibus|carreta|cavalo mec|trator)\b/i;

export function mapPlataformaSlDoc(d: Record<string, any>): DbLot | null {
  if (!d.loteId || !d.leilaoSlug) return null;

  const bruta = String(d.descricao ?? '');
  const p = parseShortDesc(bruta);
  const local = localDeDescricao(bruta);

  const tipo = RX_PESADO.test(bruta) ? 'caminhões' : RX_MOTO.test(bruta) ? 'motos' : 'carros';

  return {
    // o id do lote é único por site, e o slug do leilão entra na chave
    // porque o mesmo número de lote se repete entre leilões
    externalId: `${d.leilaoSlug}-${d.loteId}`,
    auctionExternalId: String(d.leilaoSlug),
    numeroLote: d.numeroLote ? String(d.numeroLote) : undefined,
    tipo,
    marca: p.marca,
    modelo: p.modelo,
    anoFabricacao: p.anoFab,
    anoModelo: p.anoModelo,
    cor: p.cor,
    combustivel: undefined,
    km: undefined,
    condicao: /sucata/i.test(bruta) ? 'sucata' : undefined,
    origem: /judicial/i.test(String(d.leilaoNome ?? '')) ? 'judicial' : undefined,
    comitente: undefined,
    statusTexto: 'disponivel',
    temChave: undefined,
    financiavel: undefined,
    descricao: bruta || undefined,
    lanceInicial: typeof d.lanceInicial === 'number' ? d.lanceInicial : undefined,
    lanceAtual: undefined,
    valorMercado: undefined,
    imagens: d.imagem ? [String(d.imagem)] : [],
    cidade: local.cidade,
    uf: local.uf,
    paginaUrl: String(d.paginaUrl ?? ''),
  };
}
