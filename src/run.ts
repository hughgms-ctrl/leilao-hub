import { SodreSantoroApiAdapter } from './adapters/sodre-santoro-api';
import { FreitasAdapter } from './adapters/freitas';
import { MegaAdapter } from './adapters/mega';
import { ZukAdapter } from './adapters/zuk';
import { SuperbidAdapter } from './adapters/superbid';
import { LeiloesJudiciaisAdapter } from './adapters/leiloes-judiciais';
import { SfrazaoAdapter } from './adapters/sfrazao';
import { PlataformaSlAdapter, SITES as SITES_SL } from './adapters/plataforma-sl';
import { ELeiloesAdapter } from './adapters/e-leiloes';
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

async function coletarLeiloesJudiciais(hasDb: boolean): Promise<number> {
  const a = new LeiloesJudiciaisAdapter();
  console.log(`\n[${a.slug}] paginando /veiculos/* (HTML) — acervo 100% judicial...`);
  const lotes = await a.fetchAllLots();
  console.log(`[${a.slug}] ${lotes.length} lotes coletados`);

  if (hasDb && lotes.length) {
    await saveRawScrape(a.slug, 'lot_detail', { results: lotes }, 'veiculos');
    console.log(`[${a.slug}] salvo em raw_scrapes`);
  }
  return lotes.length;
}

async function coletarSfrazao(hasDb: boolean): Promise<number> {
  const a = new SfrazaoAdapter();
  console.log(`\n[${a.slug}] varrendo leilao.php (HTML) — judicial e extrajudicial...`);
  const lotes = await a.fetchAllLots();
  console.log(`[${a.slug}] ${lotes.length} lotes coletados`);

  if (hasDb && lotes.length) {
    await saveRawScrape(a.slug, 'lot_detail', { results: lotes }, 'leilao.php');
    console.log(`[${a.slug}] salvo em raw_scrapes`);
  }
  return lotes.length;
}

/**
 * Plataforma SL: 5 leiloeiros no mesmo software. Cada um vira um
 * raw_scrape com o SEU slug — gravar tudo junto faria o card mostrar o
 * nome da plataforma no lugar do leiloeiro.
 */
async function coletarPlataformaSl(hasDb: boolean): Promise<number> {
  const a = new PlataformaSlAdapter();
  console.log(`\n[${a.slug}] ${SITES_SL.length} leiloeiros na mesma plataforma...`);
  let total = 0;

  for (const site of SITES_SL) {
    try {
      const lotes = await a.fetchSite(site);
      total += lotes.length;
      if (hasDb && lotes.length) {
        await saveRawScrape(site.slug, 'lot_detail', { results: lotes }, 'leilao/lotes/veiculos');
      }
    } catch (e) {
      console.error(`[${a.slug}] ${site.slug} FALHOU:`, (e as Error).message);
    }
  }
  console.log(`[${a.slug}] ${total} lotes coletados`);
  return total;
}

async function coletarELeiloes(hasDb: boolean): Promise<number> {
  const a = new ELeiloesAdapter();
  console.log(`\n[${a.slug}] paginando /busca (HTML) — acervo misto, filtrando veiculos...`);
  const lotes = await a.fetchAllLots(true);
  console.log(`[${a.slug}] ${lotes.length} lotes coletados`);

  if (hasDb && lotes.length) {
    await saveRawScrape(a.slug, 'lot_detail', { results: lotes }, 'busca');
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
  'leiloes-judiciais': coletarLeiloesJudiciais,
  'plataforma-sl': coletarPlataformaSl,
  'e-leiloes': coletarELeiloes,
  // 'sfrazao' fica FORA da rotação: o site devolve HTTP 403 para IP de
  // datacenter. Mesmo código e mesmos cabeçalhos passam da máquina local
  // e falham no runner do Actions, com e sem Sec-Fetch-* completo — dois
  // runs confirmaram. É bloqueio deliberado por origem, não filtro de
  // cabeçalho. Contornar exigiria proxy residencial, que é burlar o
  // bloqueio. O adapter e o mapper ficam prontos e testados (6/6 lotes do
  // leilão 478) para o dia em que houver um caminho legítimo — basta
  // devolver a linha abaixo.
  // 'sfrazao': coletarSfrazao,
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
