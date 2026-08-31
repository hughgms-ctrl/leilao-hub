import type { DbLot } from './sodre';
import { parseShortDesc } from './superbid';
import { CATEGORIAS } from '../../adapters/leiloes-judiciais';

/**
 * Mapper: card do Leilões Judiciais -> registro para `lotes`.
 *
 * Acervo 100% judicial, e o card é o mais completo que temos: traz
 * AVALIAÇÃO, lance mínimo e lance atual ao mesmo tempo. A avaliação vira
 * valor_mercado, o que dá uma segunda referência de preço além da FIPE.
 *
 * A descrição vem como
 *   "I/BMW X5 M50D - 18/19 - Preta - Depósito"
 *   "Toyota/Hilux CD SRX 4X4 - 16/16 - Maringá/PR"
 *   "Chevrolet Camaro 2SS - 10/11 - Preto - Cuiabá/MT"
 *
 * que é o mesmo formato do Superbid trocando vírgula por " - ". Em vez de
 * escrever um segundo parser (e um segundo conjunto de bugs), normalizo o
 * separador e reuso parseShortDesc — ele já resolve prefixo "I/" de
 * importado, ano de dois dígitos e rótulo grudado no nome.
 */

const TIPO_POR_CATEGORIA = new Map(CATEGORIAS.map((c) => [c.slug, c.tipo]));

export function mapLeiloesJudiciaisDoc(d: Record<string, any>): DbLot | null {
  if (!d.leilaoId || !d.loteId) return null;

  const bruta = String(d.descricao ?? '');
  const p = parseShortDesc(bruta.replace(/\s+-\s+/g, ', '));

  const [cidade, uf] = String(d.cidadeUf ?? '').split('/').map((s: string) => s?.trim());

  const status = String(d.statusTexto ?? '').toLowerCase();
  const ehSucata = /sucata/i.test(bruta);

  return {
    externalId: `${d.leilaoId}-${d.loteId}`,
    auctionExternalId: String(d.leilaoId),
    numeroLote: String(d.loteId),
    tipo: TIPO_POR_CATEGORIA.get(String(d.categoria)) ?? 'carros',
    marca: p.marca,
    modelo: p.modelo,
    anoFabricacao: p.anoFab,
    anoModelo: p.anoModelo,
    cor: p.cor,
    combustivel: undefined,
    km: undefined,
    condicao: ehSucata ? 'sucata' : undefined,
    origem: 'judicial',
    comitente: undefined,
    statusTexto: /aberto|lance/.test(status) ? 'em_pregao' : d.statusTexto || undefined,
    temChave: undefined,
    financiavel: undefined,
    descricao: bruta || undefined,
    // o lance mínimo é o que se paga na praça em curso; a avaliação do
    // juízo entra como valor de mercado, não como lance.
    lanceInicial: typeof d.lanceMinimo === 'number' ? d.lanceMinimo : undefined,
    lanceAtual: typeof d.lanceAtual === 'number' ? d.lanceAtual : undefined,
    valorMercado: typeof d.avaliacao === 'number' ? d.avaliacao : undefined,
    imagens: d.imagem ? [String(d.imagem)] : [],
    cidade: cidade ? cidade.toLowerCase() : undefined,
    uf: uf ? uf.toUpperCase().slice(0, 2) : undefined,
    paginaUrl: String(d.paginaUrl ?? ''),
  };
}
