import type { DbLot } from './sodre';

/**
 * Mapper: card do Mega Leilões → registro para `lotes`.
 *
 * O acervo de veículos do Mega é praticamente todo JUDICIAL, e é por isso
 * que a fonte existe aqui: é onde há carro com proposta de pagamento
 * parcelado do art. 895 do CPC.
 *
 * Estrutura de praça (própria do judicial): a 1ª praça sai pelo valor da
 * AVALIAÇÃO e a 2ª com deságio (tipicamente 50%). O valor da praça em
 * curso é o lance MÍNIMO publicado pelo juízo — é lance inicial de
 * verdade, não lance corrente de pregão, então esses lotes nascem com
 * score `confirmado`.
 *
 * Título vem no formato "Carro Fiat Palio Weekend Adventure - 2013 (Lote 01)".
 */

/** "R$ 19.774,50" → 19774.5 */
function precoBR(txt?: string): number | undefined {
  if (!txt) return undefined;
  const n = parseFloat(txt.replace(/[^\d,]/g, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** categoria da URL → vocabulário que o fipeTypeFor entende */
function tipoDe(categoria: string): string {
  const c = (categoria || '').toLowerCase();
  if (/moto/.test(c)) return 'motos';
  if (/caminh|onibus|pesad/.test(c)) return 'caminhões';
  if (/carro|utilitar|van/.test(c)) return 'carros';
  return 'carros';
}

/**
 * "Carro Fiat Palio Weekend Adventure - 2013 (Lote 01)"
 *  → marca "fiat", modelo "palio weekend adventure", ano 2013
 */
export function parseTitulo(
  titulo: string,
): { marca?: string; modelo?: string; ano?: number; anoFab?: number } {
  const semLote = titulo.replace(/\s*\(Lote[^)]*\)\s*$/i, '').trim();
  // o ano vem como "- 2013" ou "- 2007/2008" (fabricação/modelo)
  const mAno = semLote.match(/-\s*(\d{4})(?:\s*\/\s*(\d{4}))?\s*$/);
  const anoFab = mAno ? Number(mAno[1]) : undefined;
  const ano = mAno ? Number(mAno[2] ?? mAno[1]) : undefined;
  const semAno = mAno ? semLote.slice(0, mAno.index).trim().replace(/-\s*$/, '').trim() : semLote;

  // a primeira palavra é o tipo do bem ("Carro", "Moto", "Caminhão")
  const partes = semAno.split(/\s+/);
  if (partes.length < 2) return { ano };
  const marca = partes[1];
  const modelo = partes.slice(2).join(' ');
  return {
    marca: marca ? marca.toLowerCase() : undefined,
    modelo: modelo ? modelo.toLowerCase() : undefined,
    ano,
    anoFab,
  };
}

/** "Aberto para lances" → enum status_lote */
function statusDe(s: string): string {
  const t = (s || '').toLowerCase();
  if (/encerrad|finalizad/.test(t)) return 'vendido';
  if (/aberto|andamento/.test(t)) return 'andamento';
  if (/suspens|cancelad/.test(t)) return 'retirado';
  return 'andamento';
}

export function mapMegaDoc(d: Record<string, any>): DbLot | null {
  const codigo = d.codigo as string;
  if (!codigo || !d.leilaoId) return null;

  const { marca, modelo, ano, anoFab } = parseTitulo(String(d.titulo ?? ''));
  const [cidade, uf] = String(d.localidade ?? '').split(',').map((s) => s.trim());

  // valor da praça em curso = lance mínimo publicado pelo juízo
  const lanceMinimo = precoBR(d.precoAtual) ?? precoBR(d.praca2Valor) ?? precoBR(d.praca1Valor);
  // 1ª praça sai pela avaliação judicial do bem
  const avaliacao = precoBR(d.praca1Valor);

  return {
    externalId: codigo,
    auctionExternalId: String(d.leilaoId),
    numeroLote: String(d.numeroLote ?? '').replace(/^Lote\s*/i, '') || undefined,
    tipo: tipoDe(String(d.categoria ?? '')),
    marca,
    modelo,
    anoFabricacao: anoFab,
    anoModelo: ano,
    cor: undefined,
    combustivel: undefined,
    km: undefined,            // não publicado na listagem
    condicao: undefined,      // judicial não declara monta: score usa o default
    origem: /judicial/i.test(String(d.tipoLeilao ?? '')) ? 'judicial' : undefined,
    comitente: undefined,
    statusTexto: statusDe(String(d.status ?? '')),
    temChave: undefined,
    financiavel: undefined,
    descricao: [d.titulo, d.descricao].filter(Boolean).join('\n\n') || undefined,
    // lance mínimo da praça é preço publicado, não lance de pregão
    lanceInicial: lanceMinimo,
    lanceAtual: undefined,
    valorMercado: avaliacao,
    imagens: d.imagem ? [String(d.imagem)] : [],
    cidade: cidade ? cidade.toLowerCase() : undefined,
    uf: uf ? uf.toUpperCase().slice(0, 2) : undefined,
    paginaUrl: String(d.paginaUrl ?? ''),
  };
}
