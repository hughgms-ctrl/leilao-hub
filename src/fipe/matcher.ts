import type { Pool } from 'pg';
import {
  getBrands, getModels, getYears, getPrice, parseFipePrice, type VehicleType,
} from './client';
import { FIPE_MATCH_MIN_SCORE } from '../config';

/**
 * Matcher fuzzy: (marca, modelo, ano, combustível) do leiloeiro → preço FIPE.
 *
 * O leiloeiro escreve "gol 1.0l mc4"; a FIPE tem "Gol 1.0 Flex 12V 5p".
 * Nunca vai ser match exato — por isso todo resultado carrega matchScore,
 * e abaixo de FIPE_MATCH_MIN_SCORE a gente prefere NÃO ter preço a ter
 * preço errado alimentando o ranking.
 *
 * Preços são cacheados em fipe_precos por (codigo_fipe, ano, combustível,
 * mês de referência) — a FIPE muda mensalmente, não faz sentido rebater.
 */

export interface FipeMatch {
  fipePrecoId: number;
  codigoFipe: string;
  preco: number;
  matchScore: number;
}

export interface LoteParaMatch {
  marca?: string | null;
  modelo?: string | null;
  anoModelo?: number | null;
  combustivel?: string | null;
  tipo?: string | null; // lot_category do leiloeiro
}

// ---------- similaridade (Dice coefficient sobre bigramas) ----------

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove acentos
    .replace(/(\d)\.(\d)/g, '$1$2')  // "1.0" → "10": motorização vira token estável
    .replace(/(\d)([a-z])/g, '$1 $2') // "1.0l" → "10 l", "12v" → "12 v"
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function bigrams(s: string): Set<string> {
  const t = s.replace(/ /g, '');
  const out = new Set<string>();
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  return out;
}

export function dice(a: string, b: string): number {
  const A = bigrams(normalize(a));
  const B = bigrams(normalize(b));
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return (2 * inter) / (A.size + B.size);
}

/** Bônus por tokens inteiros em comum ("gol", "1.0") — pega abreviação melhor que bigrama */
function tokenOverlap(a: string, b: string): number {
  const A = new Set(normalize(a).split(' ').filter((t) => t.length > 1));
  const B = new Set(normalize(b).split(' ').filter((t) => t.length > 1));
  if (A.size === 0) return 0;
  let hit = 0;
  for (const t of A) if (B.has(t)) hit++;
  return hit / A.size;
}

/**
 * Abreviações de carroceria que o leiloeiro usa e a FIPE escreve por extenso.
 * Sem isto, "etios sd xs" (sedã) casa com o hatch, que é outro modelo e
 * outro preço. Expandido SÓ em token isolado — "sd" solto vira "sedan",
 * mas o "sd" dentro de "sdrive" fica intacto.
 */
const ABREV_CARROCERIA: Record<string, string> = {
  sd: 'sedan',
  hb: 'hatch',
  sw: 'weekend',
  cd: 'cabine dupla',
  cs: 'cabine simples',
};

export function expandirAbreviacoes(s: string): string {
  return normalize(s)
    .split(' ')
    .map((t) => ABREV_CARROCERIA[t] ?? t)
    .join(' ');
}

/**
 * Séries especiais/comemorativas: a FIPE lista "COMPASS TD 350 80 Anos" como
 * modelo próprio e bem mais caro. Se o candidato tem marca de série especial
 * e a descrição do leiloeiro NÃO tem, é quase certo que é outro carro —
 * penaliza para não inflar a FIPE de referência.
 */
const SERIE_ESPECIAL = [
  /\b\d+\s*anos\b/,      // "80 anos", "70 anos"
  /\bedicao\b/,
  /\blimited\b/,
  /\bedition\b/,
  /\bcomemorativ\w*\b/,
];

const PENALIDADE_SERIE_ESPECIAL = 0.75;

function ehSerieEspecialNaoPedida(queryNorm: string, candidatoNorm: string): boolean {
  return SERIE_ESPECIAL.some((re) => re.test(candidatoNorm) && !re.test(queryNorm));
}

/** Score de UM candidato FIPE contra a query do leiloeiro (exportado p/ teste). */
export function pontuarCandidato(query: string, candidato: string): number {
  let s = 0.6 * dice(query, candidato) + 0.4 * tokenOverlap(query, candidato);
  if (ehSerieEspecialNaoPedida(normalize(query), normalize(candidato))) {
    s *= PENALIDADE_SERIE_ESPECIAL;
  }
  return s;
}

/**
 * Pontua o candidato contra a query CRUA e a EXPANDIDA, ficando com a maior.
 *
 * Necessário porque as duas convenções convivem na FIPE: ela escreve
 * "ETIOS XS Sedan" (por extenso) mas também "Hilux CD 4x4" (abreviado).
 * Expandir sempre quebrava picape; não expandir nunca quebrava sedã.
 * Pegando o melhor dos dois, cada lote casa pela convenção que a FIPE usou.
 */
export function pontuarMelhorVariante(query: string, candidato: string): number {
  return Math.max(
    pontuarCandidato(query, candidato),
    pontuarCandidato(expandirAbreviacoes(query), candidato),
  );
}

function best(list: { code: string; name: string }[], query: string) {
  let bestItem = null as null | { code: string; name: string };
  let bestScore = 0;
  const queryExpandida = expandirAbreviacoes(query); // expande uma vez só
  for (const item of list) {
    const s = Math.max(
      pontuarCandidato(query, item.name),
      pontuarCandidato(queryExpandida, item.name),
    );
    if (s > bestScore) {
      bestScore = s;
      bestItem = item;
    }
  }
  return { item: bestItem, score: bestScore };
}

// ---------- categoria do leiloeiro → tipo FIPE ----------

export function fipeTypeFor(categoria?: string | null): VehicleType | null {
  if (!categoria) return 'cars';
  const c = normalize(categoria);
  if (/moto/.test(c)) return 'motorcycles';
  if (/caminh|pesad/.test(c)) return 'trucks';
  // "utilitario" sem sufixo: a categoria real do site é "utilitarios leves"
  // (plural). Com /utilitario leve/ os 88 lotes dessa categoria caíam fora.
  if (/carro|utilitario|van/.test(c)) return 'cars';
  // implementos rodoviários, tratores, náutico: FIPE não cobre
  return null;
}

// combustível do leiloeiro → código FIPE (1=gasolina/flex/álcool listados como Gasolina na v2, 3=diesel)
function fuelCode(combustivel?: string | null): number {
  if (combustivel && /diesel/i.test(combustivel)) return 3;
  return 1;
}

// ---------- matcher principal ----------

export async function matchFipe(
  pool: Pool,
  lote: LoteParaMatch,
): Promise<FipeMatch | null> {
  if (!lote.marca || !lote.modelo || !lote.anoModelo) return null;
  const type = fipeTypeFor(lote.tipo);
  if (!type) return null;

  // 1. marca
  const brands = await getBrands(type);
  const b = best(brands, lote.marca);
  if (!b.item || b.score < 0.5) return null;

  // 2. modelo — best() já compara nas duas convenções (crua e expandida)
  const models = await getModels(type, b.item.code);
  const m = best(models, lote.modelo);
  if (!m.item) return null;

  const matchScore = Number((0.3 * b.score + 0.7 * m.score).toFixed(3));
  if (matchScore < FIPE_MATCH_MIN_SCORE) return null;

  // 3. ano — FIPE usa ids "2014-1" (ano-combustível); 32000 = zero km
  const years = await getYears(type, b.item.code, m.item.code);
  const fuel = fuelCode(lote.combustivel);
  const yearId =
    years.find((y) => y.code === `${lote.anoModelo}-${fuel}`)?.code ??
    years.find((y) => y.code.startsWith(`${lote.anoModelo}-`))?.code;
  if (!yearId) return null;

  // 4. preço — cache persistente primeiro
  const mesRef = new Date();
  const mesReferencia = `${mesRef.getFullYear()}-${String(mesRef.getMonth() + 1).padStart(2, '0')}-01`;

  const price = await getPrice(type, b.item.code, m.item.code, yearId);
  const preco = parseFipePrice(price.price);
  if (!preco) return null;

  const upsert = await pool.query(
    `INSERT INTO fipe_precos
       (codigo_fipe, ano_modelo, combustivel_cod, mes_referencia, marca, modelo, preco)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (codigo_fipe, ano_modelo, combustivel_cod, mes_referencia)
       DO UPDATE SET preco = EXCLUDED.preco, fetched_at = now()
     RETURNING id`,
    [price.codeFipe, lote.anoModelo, fuel, mesReferencia, price.brand, price.model, preco],
  );

  return {
    fipePrecoId: upsert.rows[0].id,
    codigoFipe: price.codeFipe,
    preco,
    matchScore,
  };
}

/**
 * Consulta o cache persistente ANTES de bater na API — para lotes que já
 * têm codigo_fipe de execuções anteriores, isto elimina a chamada externa.
 */
export async function cachedFipePrice(
  pool: Pool,
  codigoFipe: string,
  anoModelo: number,
  combustivel?: string | null,
): Promise<{ fipePrecoId: number; preco: number } | null> {
  const mesRef = new Date();
  const mesReferencia = `${mesRef.getFullYear()}-${String(mesRef.getMonth() + 1).padStart(2, '0')}-01`;
  const r = await pool.query(
    `SELECT id, preco FROM fipe_precos
     WHERE codigo_fipe = $1 AND ano_modelo = $2 AND combustivel_cod = $3
       AND mes_referencia = $4`,
    [codigoFipe, anoModelo, fuelCode(combustivel), mesReferencia],
  );
  if (r.rowCount === 0) return null;
  return { fipePrecoId: r.rows[0].id, preco: Number(r.rows[0].preco) };
}
