import { SodreSantoroApiAdapter } from './adapters/sodre-santoro-api';
import { FreitasAdapter } from './adapters/freitas';
import { MegaAdapter } from './adapters/mega';
import { ZukAdapter } from './adapters/zuk';
import { SuperbidAdapter } from './adapters/superbid';
import { saveRawScrape, closePool } from './db';
import { connectionStringDireta } from './pg-config';

/**
 * Runner: coleta de TODOS os leiloeiros, um por vez.
 *
 * Sequencial de propósito — cada adapter tem seu próprio rate limit e
 * paralelizar só aumentaria a chance de bloqueio, sem ganho real (o
 * gargalo do pipeline é o normalize, não a coleta).
 *
 * Uma fonte que falha NÃO derruba as outras: o erro é registrado e o
 * runner segue. Só sai com código 1 se todas falharem.
 *
 * Sem DIRECT_DATABASE_URL roda em modo exploração (coleta e imprime).
 */

async function coletarSodre(hasDb: boolean): Promise<number> {
  const a = new SodreSantoroApiAdapter();
  console.log(`\n[${a.slug}] bootstrap (cookies Azion via Playwright)...`);
  await a.bootstrap();

  console.log(`[${a.slug}] paginando /api/search-lots...`);
  const { raw } = await a.fetchAllLots();
  console.log(`[${a.slug}] ${raw.length} lotes coletados`);

  console.log(`[${a.slug}] coletando detalhe dos leilões...`);
  const leiloes = await a.fetchAuctions(raw);
  console.log(`[${a.slug}] ${leiloes.length} leilões detalhados`);

  if (hasDb) {
    await saveRawScrape(a.slug, 'lot_detail', { results: raw }, 'api/search-lots');
    if (leiloes.length) {
      await saveRawScrape(a.slug, 'auction_list', { results: leiloes }, 'api/auctions');
    }
    console.log(`[${a.slug}] salvo em raw_scrapes`);
  }
  return raw.length;
}

async function coletarFreitas(hasDb: boolean): Promise<number> {
  const a = new FreitasAdapter();
  console.log(`\n[${a.slug}] paginando /Leiloes/PesquisarLotes (HTML)...`);
  const lotes = await a.fetchAllLots();
  console.log(`[${a.slug}] ${lotes.length} lotes coletados`);

  if (hasDb && lotes.length) {
    await saveRawScrape(a.slug, 'lot_detail', { results: lotes }, 'Leiloes/PesquisarLotes');
    console.log(`[${a.slug}] salvo em raw_scrapes`);
  }
  return lotes.length;
}

async function coletarMega(hasDb: boolean): Promise<number> {
  const a = new MegaAdapter();
  console.log(`\n[${a.slug}] paginando /veiculos (HTML) — acervo judicial...`);
  const lotes = await a.fetchAllLots();
  console.log(`[${a.slug}] ${lotes.length} lotes coletados`);

  if (hasDb && lotes.length) {
    await saveRawScrape(a.slug, 'lot_detail', { results: lotes }, 'veiculos');
    console.log(`[${a.slug}] salvo em raw_scrapes`);
  }
  return lotes.length;
}

async function coletarZuk(hasDb: boolean): Promise<number> {
  const a = new ZukAdapter();
  console.log(`\n[${a.slug}] paginando /leilao-de-veiculos (HTML) — acervo judicial...`);
  // comDetalhe=true: a descrição do card vem truncada e sem ano não há FIPE
  const lotes = await a.fetchAllLots(true);
  console.log(`[${a.slug}] ${lotes.length} lotes coletados`);

  if (hasDb && lotes.length) {
    await saveRawScrape(a.slug, 'lot_detail', { results: lotes }, 'leilao-de-veiculos');
    console.log(`[${a.slug}] salvo em raw_scrapes`);
  }
  return lotes.length;
}

async function coletarSuperbid(hasDb: boolean): Promise<number> {
  const a = new SuperbidAdapter();
  console.log(`\n[${a.slug}] paginando offer-query (JSON) — Canal Judicial...`);
  const lotes = await a.fetchAllLots();
  console.log(`[${a.slug}] ${lotes.length} lotes coletados`);

  if (hasDb && lotes.length) {
    await saveRawScrape(a.slug, 'lot_detail', { results: lotes }, 'offer-query/offers');
    console.log(`[${a.slug}] salvo em raw_scrapes`);
  }
  return lotes.length;
}

const FONTES: Record<string, (hasDb: boolean) => Promise<number>> = {
  'sodre-santoro': coletarSodre,
  'freitas-leiloeiro': coletarFreitas,
  'mega-leiloes': coletarMega,
  'portal-zuk': coletarZuk,
  'superbid-judicial': coletarSuperbid,
};

async function main() {
  const hasDb = Boolean(connectionStringDireta());
  const inicio = Date.now();
  if (!hasDb) console.log('DIRECT_DATABASE_URL ausente — modo exploração, nada será gravado');

  // FONTES=freitas-leiloeiro npm run scrape roda só uma
  const filtro = (process.env.FONTES ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const alvos = Object.keys(FONTES).filter((s) => !filtro.length || filtro.includes(s));

  const resultados: { slug: string; lotes?: number; erro?: string }[] = [];
  for (const slug of alvos) {
    try {
      resultados.push({ slug, lotes: await FONTES[slug](hasDb) });
    } catch (e) {
      console.error(`[${slug}] FALHOU:`, (e as Error).message);
      resultados.push({ slug, erro: (e as Error).message });
    }
  }

  console.log('\n=== RESUMO ===');
  for (const r of resultados) {
    console.log(`  ${r.slug}: ${r.erro ? `ERRO — ${r.erro}` : `${r.lotes} lotes`}`);
  }
  console.log(`concluído em ${((Date.now() - inicio) / 1000).toFixed(1)}s`);

  if (resultados.every((r) => r.erro)) process.exitCode = 1;
  if (hasDb) await closePool();
}

main();
