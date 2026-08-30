import type { DbLot } from './sodre';

/**
 * Mapper: card cru da Freitas → registro pronto para upsert em `lotes`.
 *
 * A Freitas não tem API JSON; o adapter extrai os campos do HTML e aqui
 * eles são interpretados. A descrição vem num formato regular:
 *
 *   "RENAULT/OROCH DYN 16 SCE, 17/17, PLACA: G__-___7, GASOL/ALC, PRETA"
 *    marca /modelo                 ano   placa parcial  combustível  cor
 *
 * LIMITES CONHECIDOS desta fonte (não são bug, é o que o site publica):
 *   - não há quilometragem em lugar nenhum da listagem;
 *   - condição/monta NÃO tem campo próprio: vem grudada no texto da
 *     origem ("seguradora sinistro/média monta"), e é de lá que sai.
 *     Quando a origem não diz nada ("financeira"), o score cai no
 *     MULTIPLICADOR_CONDICAO_AUSENTE (ver src/config.ts);
 *   - o valor exibido é rotulado ("Maior lance"), e é o único preço.
 */

const BASE_URL = 'https://www.freitasleiloeiro.com.br';

/** "R$ 48.000,00" → 48000 */
function precoBR(txt: string): number | undefined {
  const n = parseFloat(txt.replace(/[^\d,]/g, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * "17" → 2017, "99" → 1999.
 * A Freitas usa ano com 2 dígitos. Corte no ano corrente + 1 (leilão traz
 * modelo do ano seguinte); acima disso é século passado.
 */
export function anoDoisDigitos(v: string, anoAtual = new Date().getFullYear()): number | undefined {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return undefined;
  if (v.trim().length === 4) return n;
  const limite = (anoAtual % 100) + 1;
  return n <= limite ? 2000 + n : 1900 + n;
}

/** "GASOL/ALC" → flex; "GASOLINA" → gasolina; "DIESEL" → diesel */
function combustivel(txt: string): string | undefined {
  const t = txt.toUpperCase();
  if (/GASOL\s*\/\s*ALC|FLEX|ALCOOL|ÁLCOOL/.test(t)) return 'flex';
  if (/DIESEL/.test(t)) return 'diesel';
  if (/GASOLINA/.test(t)) return 'gasolina';
  if (/EL[EÉ]TRIC/.test(t)) return 'elétrico';
  return undefined;
}

/** nome do tipo da Freitas → vocabulário que o fipeTypeFor entende */
function tipo(tipoNome: string): string {
  const t = tipoNome.toLowerCase();
  if (/moto/.test(t)) return 'motos';
  if (/pesado|caminh/.test(t)) return 'caminhões';
  if (/passeio|autom/.test(t)) return 'carros';
  return 'carros';
}

/**
 * A Freitas empacota ORIGEM e CONDIÇÃO no mesmo texto:
 *   "financeira"                         -> origem, sem condição
 *   "seguradora sinistro/média monta"    -> origem + condição
 *   "seguradora sucata"                  -> origem + condição (sem score!)
 *
 * Sem separar os dois, 23 lotes de SUCATA entravam no ranking com o
 * multiplicador de condição ausente. Sucata não volta a circular — a
 * tabela de multiplicadores a omite de propósito, e o score fica null.
 */
export function condicaoDaOrigem(txt: string): string | undefined {
  const t = txt.toLowerCase();
  if (/sucata/.test(t)) return 'sucata';
  if (/m[eé]d(ia)?\s*mont/.test(t)) return 'média monta';
  if (/peq(uena)?\s*mont/.test(t)) return 'pequena monta';
  if (/grande\s*mont/.test(t)) return 'grande monta';
  return undefined; // sem informação: score usa o default calibrado
}

/**
 * Normaliza a origem para o MESMO vocabulário do Sodré, senão
 * ORIGEM_ADJUST não casa e as duas fontes ficam incomparáveis.
 */
export function origemNormalizada(txt: string): string | undefined {
  const t = txt.toLowerCase();
  if (/segurador|seguro/.test(t)) return 'seguro';
  if (/financeir|financiamento/.test(t)) return 'financiamento';
  if (/judicial/.test(t)) return 'judicial';
  if (/frota/.test(t)) return 'frota';
  return t || undefined;
}

/** "ABERTO PARA LANCES" → enum status_lote */
function statusTexto(situacao: string): string {
  const s = situacao.toLowerCase();
  if (/encerrad/.test(s)) return 'vendido';
  if (/aberto/.test(s)) return 'andamento';
  return 'andamento';
}

export interface FreitasRawLotIn {
  tipoNome: string;
  leilaoId: string;
  loteNumero: string;
  numeroExibido: string;
  descricao: string;
  valorTexto: string;
  valorRotulo: string;
  origem: string;
  situacao: string;
  dataLeilao: string;
  horaLeilao: string;
  opcionais: string[];
  imagem: string;
  paginaUrl: string;
}

export function mapFreitasDoc(d: Record<string, any>): DbLot | null {
  const r = d as FreitasRawLotIn;
  if (!r.leilaoId || !r.loteNumero) return null;

  // "MARCA/MODELO ..., 17/17, PLACA: X, COMBUSTÍVEL, COR"
  const partes = (r.descricao ?? '').split(',').map((p) => p.trim());
  const marcaModelo = partes[0] ?? '';
  const barra = marcaModelo.indexOf('/');
  const marca = barra > 0 ? marcaModelo.slice(0, barra).trim() : undefined;
  const modelo = barra > 0 ? marcaModelo.slice(barra + 1).trim() : marcaModelo || undefined;

  const anos = (partes[1] ?? '').match(/(\d{2,4})\s*\/\s*(\d{2,4})/);
  const restante = partes.slice(2).join(', ');
  const cor = partes.length > 2 ? partes[partes.length - 1] : undefined;

  const valor = precoBR(r.valorTexto ?? '');
  // "Maior lance" = lance corrente. A Freitas não publica lance inicial,
  // então esses lotes nascem como score especulativo.
  const ehLanceCorrente = /maior lance|lance atual/i.test(r.valorRotulo ?? '');

  return {
    externalId: `${r.leilaoId}-${r.loteNumero}`,
    auctionExternalId: String(r.leilaoId),
    numeroLote: r.numeroExibido || r.loteNumero,
    tipo: tipo(r.tipoNome ?? ''),
    marca: marca?.toLowerCase(),
    modelo: modelo?.toLowerCase(),
    anoFabricacao: anos ? anoDoisDigitos(anos[1]) : undefined,
    anoModelo: anos ? anoDoisDigitos(anos[2]) : undefined,
    cor: cor ? cor.toLowerCase() : undefined,
    combustivel: combustivel(restante),
    km: undefined,        // a Freitas não publica quilometragem
    // condição e origem vêm grudadas no mesmo campo do card
    condicao: condicaoDaOrigem(r.origem ?? ''),
    origem: origemNormalizada(r.origem ?? ''),
    comitente: undefined,
    statusTexto: statusTexto(r.situacao ?? ''),
    temChave: undefined,
    financiavel: undefined,
    // preserva o texto cru da origem: é onde mora "remarcado", "rec furto"
    descricao: [r.descricao, r.origem].filter(Boolean).join(' | ') || undefined,
    lanceInicial: ehLanceCorrente ? undefined : valor,
    lanceAtual: ehLanceCorrente ? valor : undefined,
    imagens: r.imagem ? [r.imagem] : [],
    cidade: undefined,
    uf: undefined,
    paginaUrl: r.paginaUrl || `${BASE_URL}/Leiloes/LoteDetalhes?leilaoId=${r.leilaoId}&loteNumero=${r.loteNumero}`,
  };
}
