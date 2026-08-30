import { SodreSantoroApiAdapter } from './adapters/sodre-santoro-api';
import { saveRawScrape, closePool } from './db';
import { connectionStringDireta } from './pg-config';

/**
 * Runner v3 — funciona com ou sem banco.
 *   Sem DIRECT_DATABASE_URL: só coleta e imprime amostras (modo exploração).
 *   Com DIRECT_DATABASE_URL: também salva no staging raw_scrapes.
 *
 * Usa a conexão DIRETA (5432), não o pooler: é processo longo, com
 * INSERT de payload grande. O pooler (6543) é da API.
 *
 * Uso:
 *   npx tsx src/run.ts                                     # exploração
 *   DIRECT_DATABASE_URL=postgres://... npx tsx src/run.ts  # completo
 */
async function main() {
  const adapter = new SodreSantoroApiAdapter();
  const hasDb = Boolean(connectionStringDireta());
  const startedAt = Date.now();

  try {
    // Modo amostra: bootstrap + dump da 1a pagina em sample-response.json.
    // Serve para iterar no parser offline, sem re-scrapear o site.
    if (process.env.SAMPLE_ONLY) {
      console.log(`[${adapter.slug}] SAMPLE_ONLY — capturando 1a pagina...`);
      await adapter.dumpSample();
      return;
    }

    console.log(`[${adapter.slug}] bootstrap (cookies Azion via Playwright)...`);
    await adapter.bootstrap();

    console.log(`[${adapter.slug}] paginando /api/search-lots...`);
    const { raw, parsed } = await adapter.fetchAllLots();
    console.log(`[${adapter.slug}] ${raw.length} lotes coletados`);

    // Segunda coleta, no MESMO run (aproveita os cookies do bootstrap):
    // detalhe dos leilões ativos referenciados pelos lotes.
    console.log(`[${adapter.slug}] coletando detalhe dos leilões...`);
    const leiloes = await adapter.fetchAuctions(raw);
    console.log(`[${adapter.slug}] ${leiloes.length} leilões detalhados`);

    if (hasDb) {
      await saveRawScrape(adapter.slug, 'lot_detail', { results: raw }, 'api/search-lots');
      if (leiloes.length) {
        await saveRawScrape(adapter.slug, 'auction_list', { results: leiloes }, 'api/auctions');
      }
      console.log(`[${adapter.slug}] salvo em raw_scrapes`);
    } else {
      console.log(`[${adapter.slug}] DIRECT_DATABASE_URL ausente — pulando gravação (modo exploração)`);
    }

    console.log('\n=== AMOSTRA: 1º lote BRUTO (formato real da API) ===');
    console.log(JSON.stringify(raw[0], null, 2));
    console.log('\n=== AMOSTRA: 3 lotes MAPEADOS (como nosso parser entendeu) ===');
    parsed.slice(0, 3).forEach((lote, i) => {
      console.log(`--- lote ${i + 1} ---`);
      console.log(JSON.stringify(lote, null, 2));
    });

    console.log(
      `\n[${adapter.slug}] concluído em ${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
    );
  } catch (err) {
    console.error(`[${adapter.slug}] falhou:`, err);
    process.exitCode = 1;
  } finally {
    if (hasDb) await closePool();
  }
}

main();
