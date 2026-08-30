import { Pool } from 'pg';
import { poolConfigDireto, connectionStringDireta } from './pg-config';

/**
 * Verificação pós-scrape: prova que a coleta REALMENTE atualizou dados.
 *
 * Existe porque bloqueio do Azion é silencioso: o scrape pode terminar
 * com exit 0, sem exceção, e ter coletado zero lote. Sem esta checagem o
 * workflow ficaria verde enquanto a base envelhece.
 *
 * Nunca imprime a connection string.
 */
/**
 * Janela larga de propósito. Medido no primeiro run real do Actions: o
 * normalize levou ~32 min (cada query é um round-trip até a Supabase em
 * sa-east-1), e com janela de 30 min a checagem enxergou só 625 dos 701
 * lotes — os primeiros já tinham saído da janela. Se o normalize ficar
 * mais lento, 30 min viraria FALSO VERMELHO.
 *
 * Alargar não enfraquece o teste: bloqueio de verdade significa ZERO lote
 * atualizado, e os runs ficam 6 h distantes entre si, então a janela nunca
 * pega o trabalho da execução anterior.
 */
const JANELA_MIN = Number(process.env.JANELA_VERIFICACAO_MIN ?? 120);

async function main() {
  if (!connectionStringDireta()) {
    console.error('DIRECT_DATABASE_URL ausente — impossível verificar.');
    process.exit(1);
  }

  const pool = new Pool(poolConfigDireto());
  try {
    const { rows } = await pool.query(
      `SELECT
         count(*) FILTER (WHERE last_seen_at > now() - ($1 || ' minutes')::interval) AS recentes,
         count(*) AS total,
         max(last_seen_at) AS ultimo
       FROM lotes`,
      [JANELA_MIN],
    );
    const recentes = Number(rows[0].recentes);
    const total = Number(rows[0].total);
    const ultimo = rows[0].ultimo;

    const leiloes = await pool.query(
      `SELECT count(*) FILTER (WHERE condicoes_venda IS NOT NULL) AS enriquecidos,
              count(*) AS total
       FROM leiloes`,
    );

    console.log(`lotes atualizados nos últimos ${JANELA_MIN} min: ${recentes}`);
    console.log(`lotes na base: ${total} | último last_seen_at: ${ultimo ?? '(nenhum)'}`);
    console.log(
      `leilões enriquecidos: ${leiloes.rows[0].enriquecidos}/${leiloes.rows[0].total}`,
    );

    if (recentes === 0) {
      console.error('');
      console.error('::error::scrape rodou mas NADA foi atualizado nos últimos ' +
        `${JANELA_MIN} min — possível bloqueio do Azion (403) ou mudança no ` +
        'contrato da API do leiloeiro. Verifique o log do passo de scrape.');
      process.exit(1);
    }

    console.log('verificação OK');
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error('verificação falhou:', (e as Error).message);
  process.exit(1);
});
