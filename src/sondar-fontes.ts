/**
 * Sonda de alcance: diz quais leiloeiros respondem DE DENTRO do runner.
 *
 * Existe por causa de um erro caro: construí o adapter inteiro do
 * S. Frazão, com parser testado, e só na hora de coletar descobri que o
 * site devolve HTTP 403 para IP de datacenter. Mesmo código passava da
 * máquina local. Com 37 candidatos pela frente vindos do mapa do
 * BuscaAii, repetir isso custaria dias.
 *
 * Roda no GitHub Actions:  npm run sondar
 *
 * O que interessa é a diferença entre local e runner. Um site que dá 200
 * aqui e 403 lá está bloqueando origem, e não adianta insistir.
 */

const DOMINIOS = [
  // do mapa extraído do BuscaAii (docs/concorrencia-buscaaii.md),
  // ordenados pela incidência na amostra de 150 lotes
  'www.sfrazao.com.br',
  'www.legisleiloes.com.br',
  'www.bronzattoleiloes.com.br',
  'www.mullerleiloes.com.br',
  'www.renovarleiloes.com.br',
  'www.nsleiloes.leilao.br',
  'www.oroleiloes.lel.br',
  'www.cargneluttileiloes.com.br',
  'www.leomarkirinusleiloes.com.br',
  'www.rechleiloes.com.br',
  'www.clademirleiloeiro.com.br',
  'www.danielgarcialeiloes.com.br',
  'www.destakleiloes.com.br',
  'www.paulobotelholeiloeiro.com.br',
  'www.fidalgoleiloes.com.br',
  'agencialeilao.com.br',
  'www.regionalleiloes.com.br',
  'www.chbarbosaleiloes.com.br',
  'www.backleiloes.com.br',
  'edgarcarvalholeiloeiro.com.br',
  'www.italoleiloes.com',
  'www.tonialleiloes.com.br',
  'www.silveiraleiloes.com.br',
  'www.bastonleiloes.com.br',
  'leiloeiro.online',
  'www.mgl.com.br',
  'www.sublimeleiloes.com.br',
  'www.bianchileiloes.com.br',
  'www.3torresleiloes.com.br',
  'www.e-leiloes.com.br',
  'www.valerioiaminleiloes.com.br',
  'www.suporteleiloes.com.br',
  'vegasleiloes.com.br',
  'www.glleiloes.com.br',
  // vistos por logo no card, sem host próprio na amostra
  'www.rmoyses.com.br',
  'www.calilleiloes.com.br',
  // candidatos judiciais achados por busca dirigida
  'www.grupolance.com.br',
  'www.nakakogueleiloes.com.br',
];

const HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Upgrade-Insecure-Requests': '1',
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Marcadores de muro de bot, que dão 200 mas não entregam conteúdo. */
function muroDeBot(html: string): string | null {
  if (/Just a moment|cdn-cgi\/challenge-platform/i.test(html)) return 'cloudflare-challenge';
  if (/NOINDEX,\s*NOFOLLOW/i.test(html) && html.length < 4000) return 'muro-akamai/imperva';
  if (/Attention Required|Access denied|Acesso negado/i.test(html)) return 'access-denied';
  return null;
}

async function sondar(dominio: string) {
  const inicio = Date.now();
  try {
    const r = await fetch(`https://${dominio}/`, {
      headers: HEADERS,
      redirect: 'follow',
      signal: AbortSignal.timeout(25_000),
    });
    const html = await r.text();
    const ms = Date.now() - inicio;
    const muro = muroDeBot(html);
    const veredito = !r.ok ? `HTTP ${r.status}` : muro ? `BLOQUEADO (${muro})` : 'ok';
    const judicial = (html.match(/judicial/gi) ?? []).length;
    console.log(
      `  ${dominio.padEnd(34)} ${String(veredito).padEnd(26)} ${String(Math.round(html.length / 1024) + 'KB').padStart(7)}  judicial=${String(judicial).padStart(3)}  ${ms}ms`,
    );
  } catch (e) {
    console.log(`  ${dominio.padEnd(34)} ${'ERRO: ' + (e as Error).message.slice(0, 40)}`);
  }
}

async function main() {
  console.log(`sondando ${DOMINIOS.length} leiloeiros a partir DESTE host\n`);
  for (const d of DOMINIOS) {
    await sondar(d);
    await sleep(1500);
  }
  console.log('\nRegra: 200 aqui e 403 no runner = bloqueio por origem, não insistir.');
}

main();
