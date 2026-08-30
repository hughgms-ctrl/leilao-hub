/**
 * Parâmetros de NEGÓCIO do score de oportunidade.
 * Tudo que é "opinião" fica aqui, num lugar só, pra calibrar depois
 * com dados reais de arremate — nada disso é lei, é chute inicial honesto.
 */

/** Multiplicador da FIPE conforme o estado do lote (lot_sinister). */
export const CONDICAO_MULTIPLIER: Record<string, number> = {
  'sem sinistro': 1.0,
  'pequena monta': 0.82, // custo de reparo + deságio de revenda de recuperado
  'média monta': 0.45,   // 0.65 era otimista: não cobria funilaria + deságio real
  // 'grande monta' / 'sucata' → sem score (não volta a circular): tratado no código
};

/**
 * Multiplicador quando o leiloeiro NÃO informa a condição do lote.
 *
 * A Freitas não publica monta/sinistro em lugar nenhum da listagem. Sem um
 * default esses lotes ficariam todos sem score — invisíveis no ranking.
 * 0.70 fica entre 'pequena monta' (0.82) e 'média monta' (0.45): assume que
 * o lote médio de leilão tem algum dano, sem fingir que é sucata.
 *
 * ATENÇÃO: isto vale só para condição AUSENTE. Condição informada mas fora
 * da tabela (sucata, grande monta) continua sem score, de propósito.
 */
export const MULTIPLICADOR_CONDICAO_AUSENTE = 0.70;

/** Origens que reduzem risco/burocracia (leve bônus) ou aumentam (penalidade). */
export const ORIGEM_ADJUST: Record<string, number> = {
  frota: 0.02,      // doc geralmente ok, manutenção de frota
  seguro: 0.0,
  financiamento: -0.02, // risco de débitos/burocracia de retomada
  judicial: -0.05,      // prazo, incerteza processual
  lojista: 0.0,
  particular: 0.0,
};

/** Custos fixos estimados além do lance (pátio, despachante, transferência, guincho). */
export const TAXAS_FIXAS_ESTIMADAS = 2500;

/** Comissão default se o leiloeiro não tiver taxa cadastrada. */
export const COMISSAO_DEFAULT = 0.05;

/** Abaixo desta confiança de match FIPE, não calculamos score (evita falso positivo). */
export const FIPE_MATCH_MIN_SCORE = 0.60;

/**
 * Piso de sanidade do lance de referência, como fração da FIPE CHEIA.
 * Leilão que acabou de abrir tem lance simbólico (R$ 500 num Cruze 2022);
 * pontuar isso gera "95% abaixo da FIPE", que é fantasia e não oportunidade.
 */
export const LANCE_MIN_RATIO_FIPE = 0.12;

/** Status em que faz sentido falar de oportunidade de compra. */
export const STATUS_PONTUAVEIS = ['disponivel', 'em_pregao'];

/** Pausa entre chamadas à API FIPE (rate limit educado, plano free). */
export const FIPE_DELAY_MS = 600;
