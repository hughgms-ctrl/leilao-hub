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
  // O leiloeiro precisa existir ANTES: o INSERT abaixo pega o id por
  // subquery e, sem a linha, gravaria ZERO sem erro nenhum — o runner
  // imprimia "salvo em raw_scrapes" e o normalizer não achava nada.
  // Custou uma coleta inteira do Portal Zuk para aparecer.
  await pool.query(
    `INSERT INTO leiloeiros (slug, nome)
     VALUES ($1, $1)
     ON CONFLICT (slug) DO NOTHING`,
    [leiloeiroSlug],
  );

  const r = await pool.query(
    `INSERT INTO raw_scrapes (leiloeiro_id, tipo, url, payload)
     SELECT id, $2, $3, $4::jsonb
     FROM leiloeiros WHERE slug = $1`,
    [leiloeiroSlug, tipo, url ?? null, JSON.stringify(payload)],
  );

  // rede de segurança: nunca mais um "salvo" silencioso que não salvou
  if (r.rowCount === 0) {
    throw new Error(
      `raw_scrapes não gravou nada para "${leiloeiroSlug}" — leiloeiro ausente?`,
    );
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}
