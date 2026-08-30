import { Pool, type PoolConfig } from 'pg';

/**
 * Conexão da API: usa DATABASE_URL apontando para o POOLER da Supabase
 * (porta 6543). Em serverless cada invocação pode abrir conexão nova —
 * a porta direta (5432) estoura o limite de conexões rapidinho.
 * O scraper/normalizer usa DIRECT_DATABASE_URL (5432); são coisas
 * diferentes de propósito.
 */
const connectionString =
  process.env.DATABASE_URL ?? 'postgresql://leilao:leilao@localhost:5432/leilaohub';

/**
 * Supabase exige TLS. O certificado é de uma CA que o Node não traz no
 * bundle padrão; sem rejectUnauthorized:false o pg estoura
 * SELF_SIGNED_CERT_IN_CHAIN. Postgres local (sem sslmode) segue sem TLS.
 */
function sslPara(url: string): PoolConfig['ssl'] {
  const ehSupabase = /supabase\.(co|com)/i.test(url);
  const pedeSsl = /sslmode=require|sslmode=verify/i.test(url);
  return ehSupabase || pedeSsl ? { rejectUnauthorized: false } : undefined;
}

/**
 * Tira o `sslmode` da URL.
 *
 * A partir do pg 8.16 o `sslmode=require` da connection string é tratado
 * como `verify-full` e SOBRESCREVE o objeto `ssl` — ou seja, o
 * rejectUnauthorized:false acima era ignorado e a conexão morria com
 * SELF_SIGNED_CERT_IN_CHAIN contra a CA da Supabase. Removendo o
 * parâmetro, quem manda no TLS é o objeto `ssl`.
 */
function semSslMode(url: string): string {
  try {
    const u = new URL(url);
    u.searchParams.delete('sslmode');
    return u.toString();
  } catch {
    return url;
  }
}

export const pool = new Pool({
  connectionString: semSslMode(connectionString),
  ssl: sslPara(connectionString),
  // serverless: poucas conexões por instância, liberadas rápido
  max: Number(process.env.PG_POOL_MAX ?? 5),
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 10_000,
});

/**
 * Lance de referência do lote: o MAIOR entre inicial e atual, ignorando
 * nulos e zeros. Mesma regra do score (src/score.ts no scraper) — se as
 * duas divergirem, o ranking da API deixa de bater com o score gravado.
 */
export const LANCE_REF_SQL =
  'NULLIF(GREATEST(COALESCE(l.lance_inicial, 0), COALESCE(l.lance_atual, 0)), 0)';
