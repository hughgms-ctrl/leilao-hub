/**
 * Detecção de parcelamento judicial (art. 895 do CPC) no texto do edital.
 *
 * O CPC permite ao interessado propor pagamento parcelado: no mínimo 25%
 * à vista a título de sinal e o saldo em até 30 parcelas mensais,
 * garantidas pelo próprio bem. NÃO é financiamento — não há análise de
 * crédito nem banco envolvido; é proposta dentro do processo.
 *
 * Isso não vale para todo leilão judicial: o juízo pode exigir pagamento
 * só à vista, e vários editais exigem. Por isso a leitura é por leilão.
 *
 * Estratégia deliberadamente CONSERVADORA: só marca `permite` quando o
 * texto invoca o art. 895 num contexto de parcelamento. Dizer a alguém
 * que dá para parcelar quando não dá é pior do que não marcar nada, então
 * o falso negativo é o erro preferido.
 */

export interface Parcelamento {
  permite: boolean;
  entradaPct?: number;
  parcelasMax?: number;
  trecho?: string;
}

/** o art. 895 é a base legal; sem ele não afirmamos nada */
const BASE_LEGAL = /art(?:igo)?\.?\s*895|cpc\s*,?\s*895|895\s*do\s*cpc/i;
const CONTEXTO_PARCELA = /parcelad|parcelament|parcelas?\s+mensa|presta[çc][õo]es/i;

/** "no mínimo 25% do valor ofertado à vista, a título de sinal" */
const ENTRADA = /(\d{1,3})\s*%[^.;]{0,80}?(?:à\s*vista|a\s*vista|sinal|entrada|caução)/i;
/** "o saldo ser dividido em até 30 parcelas mensais" */
const PARCELAS = /at[ée]\s*(\d{1,3})\s*(?:\([^)]*\)\s*)?(?:parcelas|presta[çc][õo]es|meses|vezes)/i;

export function detectarParcelamento(texto?: string | null): Parcelamento {
  if (!texto) return { permite: false };

  const temBase = BASE_LEGAL.test(texto);
  const temContexto = CONTEXTO_PARCELA.test(texto);
  if (!temBase || !temContexto) return { permite: false };

  // recorta a vizinhança da menção legal: é onde ficam os números, e evita
  // pegar "25%" de outra cláusula qualquer do edital
  const pos = texto.search(BASE_LEGAL);
  const janela = texto.slice(Math.max(0, pos - 200), pos + 900);

  const mEntrada = janela.match(ENTRADA);
  const mParcelas = janela.match(PARCELAS);

  const entradaPct = mEntrada ? Number(mEntrada[1]) : undefined;
  const parcelasMax = mParcelas ? Number(mParcelas[1]) : undefined;

  return {
    permite: true,
    // descarta número fora de faixa plausível (erro de parse, não de edital)
    entradaPct: entradaPct !== undefined && entradaPct > 0 && entradaPct <= 100 ? entradaPct : undefined,
    parcelasMax: parcelasMax !== undefined && parcelasMax > 0 && parcelasMax <= 120 ? parcelasMax : undefined,
    trecho: janela.replace(/\s+/g, ' ').trim().slice(0, 700),
  };
}
