import { Pool } from 'pg';
import { poolConfigDireto } from './pg-config';

const pool = new Pool(poolConfigDireto());

/**
 * Grava payload bruto no staging. O normalizer processa depois.
 * Nunca escreva direto em `lotes` a partir do scraper — se o parse
 * mudar, você quer poder reprocessar sem re-scrapear.
 */
export async function saveRawScrape(
  leiloeiroSlug: string,
  tipo: 'auction_list' | 'lot_detail',
  payload: unknown,
  url?: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO raw_scrapes (leiloeiro_id, tipo, url, payload)
     SELECT id, $2, $3, $4::jsonb
     FROM leiloeiros WHERE slug = $1`,
    [leiloeiroSlug, tipo, url ?? null, JSON.stringify(payload)],
  );
}

export async function closePool(): Promise<void> {
  await pool.end();
}
