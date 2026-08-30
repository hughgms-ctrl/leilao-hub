import type { PoolConfig } from 'pg';

/**
 * Conexão do SCRAPER/NORMALIZER: usa DIRECT_DATABASE_URL (Supabase porta
 * 5432, conexão direta). São processos longos, com transações e milhares
 * de INSERTs — o pooler em modo transaction quebra prepared statements e
 * não ganha nada aqui. O pooler (6543) é para a API serverless.
 *
 * Aceita DATABASE_URL como fallback para não quebrar setup local antigo.
 */
export function connectionStringDireta(): string | undefined {
  return process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
}

/**
 * Supabase exige TLS (sslmode=require). O certificado é de uma CA que o
 * Node não traz no bundle padrão, então rejectUnauthorized:false — sem
 * isso o pg estoura SELF_SIGNED_CERT_IN_CHAIN. Em Postgres local (sem
 * sslmode na URL) devolve undefined e a conexão segue em texto plano.
 */
export function sslPara(url: string | undefined): PoolConfig['ssl'] {
  if (!url) return undefined;
  const ehSupabase = /supabase\.(co|com)/i.test(url);
  const pedeSsl = /sslmode=require|sslmode=verify/i.test(url);
  return ehSupabase || pedeSsl ? { rejectUnauthorized: false } : undefined;
}

/** PoolConfig pronto para scraper/normalizer. */
export function poolConfigDireto(): PoolConfig {
  const connectionString = connectionStringDireta();
  return { connectionString, ssl: sslPara(connectionString) };
}
