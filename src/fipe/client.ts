import { FIPE_DELAY_MS } from '../config';

/**
 * Cliente da FIPE via Parallelum (https://fipe.parallelum.com.br).
 * Plano free, sem chave. Cache em memória por execução — brands/models
 * mudam raramente; preços são cacheados de forma persistente na tabela
 * fipe_precos pelo matcher.
 */

const BASE = 'https://fipe.parallelum.com.br/api/v2';

export type VehicleType = 'cars' | 'motorcycles' | 'trucks';

export interface FipeRef { code: string; name: string }
export interface FipePrice {
  price: string;        // "R$ 45.678,00"
  brand: string;
  model: string;
  modelYear: number;
  fuel: string;
  codeFipe: string;
  referenceMonth: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const brandCache = new Map<string, FipeRef[]>();
const modelCache = new Map<string, FipeRef[]>();
const yearCache = new Map<string, FipeRef[]>();

async function get<T>(path: string): Promise<T> {
  await sleep(FIPE_DELAY_MS);
  const res = await fetch(`${BASE}${path}`, {
    headers: { Accept: 'application/json' },
  });
  if (res.status === 429) {
    // rate limit: espera e tenta uma vez mais
    await sleep(5000);
    const retry = await fetch(`${BASE}${path}`);
    if (!retry.ok) throw new Error(`FIPE ${path}: HTTP ${retry.status} (após retry)`);
    return retry.json() as Promise<T>;
  }
  if (!res.ok) throw new Error(`FIPE ${path}: HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export async function getBrands(type: VehicleType): Promise<FipeRef[]> {
  if (!brandCache.has(type)) {
    brandCache.set(type, await get<FipeRef[]>(`/${type}/brands`));
  }
  return brandCache.get(type)!;
}

export async function getModels(type: VehicleType, brandCode: string): Promise<FipeRef[]> {
  const key = `${type}:${brandCode}`;
  if (!modelCache.has(key)) {
    modelCache.set(key, await get<FipeRef[]>(`/${type}/brands/${brandCode}/models`));
  }
  return modelCache.get(key)!;
}

export async function getYears(
  type: VehicleType,
  brandCode: string,
  modelCode: string,
): Promise<FipeRef[]> {
  const key = `${type}:${brandCode}:${modelCode}`;
  if (!yearCache.has(key)) {
    yearCache.set(
      key,
      await get<FipeRef[]>(`/${type}/brands/${brandCode}/models/${modelCode}/years`),
    );
  }
  return yearCache.get(key)!;
}

export async function getPrice(
  type: VehicleType,
  brandCode: string,
  modelCode: string,
  yearId: string,
): Promise<FipePrice> {
  return get<FipePrice>(`/${type}/brands/${brandCode}/models/${modelCode}/years/${yearId}`);
}

/** "R$ 45.678,00" → 45678.00 */
export function parseFipePrice(txt: string): number | undefined {
  const n = parseFloat(txt.replace(/[^\d,]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
}
