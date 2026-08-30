import {
  CONDICAO_MULTIPLIER, ORIGEM_ADJUST, TAXAS_FIXAS_ESTIMADAS, COMISSAO_DEFAULT,
  LANCE_MIN_RATIO_FIPE, STATUS_PONTUAVEIS, MULTIPLICADOR_CONDICAO_AUSENTE,
} from './config';

/**
 * Score de oportunidade = quanto o custo total fica ABAIXO da FIPE ajustada.
 *
 *   lanceRef     = maior entre lance inicial e lance atual (ignorando nulos)
 *   custoTotal   = lanceRef × (1 + comissão) + taxas fixas
 *   fipeAjustada = fipe × multiplicador(condição) × (1 + ajuste(origem))
 *   score        = (fipeAjustada − custoTotal) / fipeAjustada
 *
 * score 0.35 = comprar 35% abaixo do valor realista. Negativo = pagando caro.
 * Retorna null quando não dá pra opinar com honestidade:
 *   - sem FIPE, sem lance, ou condição fora da tabela (ex.: sucata);
 *   - lote já vendido/retirado (não é oportunidade de compra);
 *   - lance de referência abaixo do piso de sanidade — leilão recém-aberto
 *     com lance simbólico produziria "95% abaixo da FIPE", que é ruído.
 */

export interface ScoreInput {
  fipe: number;
  lanceInicial?: number | null;
  lanceAtual?: number | null;
  condicao?: string | null;      // lot_sinister
  origem?: string | null;        // lot_origin
  comissao?: number | null;      // taxa do leiloeiro
  status?: string | null;        // status_lote já mapeado
}

export interface ScoreResult {
  score: number;
  custoEstimadoTotal: number;
  fipeAjustada: number;
  lanceReferencia: number;
}

/** maior entre inicial e atual, ignorando nulos/zeros */
export function lanceReferencia(
  lanceInicial?: number | null,
  lanceAtual?: number | null,
): number | null {
  const candidatos = [lanceInicial, lanceAtual].filter(
    (v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0,
  );
  return candidatos.length ? Math.max(...candidatos) : null;
}

export function calcularScore(i: ScoreInput): ScoreResult | null {
  if (!i.fipe) return null;

  // só faz sentido pontuar lote que ainda dá para comprar
  if (i.status && !STATUS_PONTUAVEIS.includes(i.status)) return null;

  const lanceRef = lanceReferencia(i.lanceInicial, i.lanceAtual);
  if (lanceRef === null) return null;

  // Condição AUSENTE (leiloeiro não publica) usa o default calibrado.
  // Antes isto caía em 1.0, tratando lote sem informação como se fosse
  // "sem sinistro" — inflava o score de toda fonte que não publica monta.
  const mult = i.condicao
    ? CONDICAO_MULTIPLIER[i.condicao.toLowerCase().trim()]
    : MULTIPLICADOR_CONDICAO_AUSENTE;
  // condição informada mas fora da tabela (sucata, grande monta): sem score
  if (mult === undefined) return null;

  const origemAdj = i.origem
    ? (ORIGEM_ADJUST[i.origem.toLowerCase().trim()] ?? 0)
    : 0;

  const fipeAjustada = i.fipe * mult * (1 + origemAdj);
  if (fipeAjustada <= 0) return null;

  // Piso de sanidade sobre a FIPE CHEIA, não a ajustada: com a ajustada,
  // um lote de média monta (0.45) tinha piso efetivo de ~5% da FIPE real,
  // e lance simbólico de pregão recém-aberto ainda passava.
  if (lanceRef < LANCE_MIN_RATIO_FIPE * i.fipe) return null;

  const comissao = i.comissao ?? COMISSAO_DEFAULT;
  const custoEstimadoTotal = lanceRef * (1 + comissao) + TAXAS_FIXAS_ESTIMADAS;

  return {
    score: Number(((fipeAjustada - custoEstimadoTotal) / fipeAjustada).toFixed(4)),
    custoEstimadoTotal: Number(custoEstimadoTotal.toFixed(2)),
    fipeAjustada: Number(fipeAjustada.toFixed(2)),
    lanceReferencia: lanceRef,
  };
}
