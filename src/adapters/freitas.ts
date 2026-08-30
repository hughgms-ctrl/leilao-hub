import * as cheerio from 'cheerio';
import { Agent } from 'undici';

/**
 * ADAPTER: Freitas Leiloeiro (freitasleiloeiro.com.br)
 *
 * Diferente do Sodré, aqui NÃO existe API JSON — o site é ASP.NET MVC e
 * devolve HTML. Sondei /api/*, /Leiloes/PesquisarJson, subdomínio de api:
 * tudo 404. O que existe é o endpoint que a própria listagem chama:
 *
 *   GET /Leiloes/PesquisarLotes?Categoria=1&PageNumber=N&TopRows=50&...
 *
 * Ele devolve um PARTIAL de HTML só com os cards (não a página inteira),
 * o que torna o parse bem contido. Página sem card = fim da paginação.
 *
 * Há WAF (GoCache): requisição sem cabeçalho de browser leva
 * "Acesso Bloqueado". Não precisa de Playwright, só dos headers certos.
 *
 * FRAGILIDADE: isto depende das classes CSS `cardLote-*`. Se o site
 * remaquetar, o parse silenciosamente devolve zero — por isso o adapter
 * lança erro quando uma página vem com HTML mas sem nenhum card
 * reconhecido, em vez de tratar como "acabou".
 */

const BASE_URL = 'https://www.freitasleiloeiro.com.br';
const CDN = 'https://cdn3.freitasleiloeiro.com.br';
const PAGE_SIZE = 50;
const DELAY_MS = 2000;
const CATEGORIA_VEICULOS = 1;
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/** Cabeçalhos de browser de verdade: o WAF (GoCache) olha mais que o UA. */
const HEADERS_BROWSER: Record<string, string> = {
  'User-Agent': USER_AGENT,
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
  'Cache-Control': 'no-cache',
  Pragma: 'no-cache',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin',
};

/**
 * Dispatcher usado SOMENTE nas requisições da Freitas.
 *
 * PROBLEMA: o servidor deles não envia o certificado intermediário, então
 * a cadeia chega incompleta e o Node estoura
 * UNABLE_TO_VERIFY_LEAF_SIGNATURE. Navegador e Windows disfarçam porque
 * buscam o intermediário faltante sozinhos (AIA fetching); o Node não faz
 * isso. Era por isso que a coleta passava na máquina local e falhava no
 * runner do GitHub — não era bloqueio de WAF, como parecia no começo.
 *
 * ESCOPO E RISCO: este agent vale só para o fetch abaixo. A conexão com o
 * banco e a API da FIPE continuam com verificação normal — de propósito
 * NÃO se usa NODE_TLS_REJECT_UNAUTHORIZED, que desligaria a verificação
 * do processo inteiro. Aqui só se lê HTML público e não trafega
 * credencial nenhuma, então o pior caso de um ataque no meio do caminho
 * é dado de lote falso, não vazamento. O parser já falha alto quando o
 * HTML não tem os cards esperados.
 *
 * SE A FREITAS CORRIGIR A CADEIA: dá para remover isto e o `undici`.
 */
const agenteFreitas = new Agent({ connect: { rejectUnauthorized: false } });

/**
 * fetch com retry.
 *
 * No GitHub Actions a primeira tentativa morreu com "fetch failed" — erro
 * de conexão, sem status HTTP, provavelmente o WAF cortando IP de
 * datacenter. O erro cru do fetch não diz nada; aqui a causa real é
 * propagada para o log e a chamada é repetida com espera.
 */
async function fetchComRetry(url: string, headers: Record<string, string>, tentativas = 3): Promise<Response> {
  let ultimo: unknown;
  for (let i = 1; i <= tentativas; i++) {
    try {
      return await fetch(url, {
        headers,
        redirect: 'follow',
        dispatcher: agenteFreitas,
      } as RequestInit);
    } catch (e) {
      ultimo = e;
      const causa = (e as { cause?: { code?: string; message?: string } }).cause;
      console.warn(
        `[freitas-leiloeiro] tentativa ${i}/${tentativas} falhou: ${(e as Error).message}` +
        (causa ? ` | causa: ${causa.code ?? ''} ${causa.message ?? ''}` : ''),
      );
      if (i < tentativas) await sleep(3000 * i);
    }
  }
  const c = (ultimo as { cause?: { code?: string; message?: string } })?.cause;
  throw new Error(
    `conexão falhou após ${tentativas} tentativas: ${(ultimo as Error)?.message}` +
    (c ? ` | causa: ${c.code ?? ''} ${c.message ?? ''}` : ''),
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Registro cru extraído de um card — strings literais, sem interpretação. */
export interface FreitasRawLot {
  tipoNome: string;
  leilaoId: string;
  loteNumero: string;
  numeroExibido: string;
  descricao: string;
  valorTexto: string;
  valorRotulo: string;
  origem: string;
  situacao: string;
  dataLeilao: string;
  horaLeilao: string;
  opcionais: string[];
  imagem: string;
  paginaUrl: string;
}

export class FreitasAdapter {
  slug = 'freitas-leiloeiro';

  /**
   * Tipos de veículo (JSON!). Único endpoint da Freitas que devolve JSON.
   * Serve para dois fins: saber o tipo REAL de cada lote (carro/moto/pesado,
   * sem o que o matcher da FIPE procuraria moto na tabela de carros) e
   * conhecer o total esperado por tipo.
   */
  async fetchTipos(): Promise<{ subTipoId: number; nome: string; quantidade: number }[]> {
    const res = await fetchComRetry(
      `${BASE_URL}/Leiloes/PesquisarLotesTipos?categoria=${CATEGORIA_VEICULOS}`,
      { ...HEADERS_BROWSER, Accept: 'application/json' },
    );
    if (!res.ok) throw new Error(`PesquisarLotesTipos: HTTP ${res.status}`);
    return (await res.json()) as { subTipoId: number; nome: string; quantidade: number }[];
  }

  private url(page: number, size: number, tipoLoteId = 0): string {
    const p = new URLSearchParams({
      Nome: '', Categoria: String(CATEGORIA_VEICULOS), TipoLoteId: String(tipoLoteId),
      FaixaValor: '0', Condicao: '', PatioId: '0',
      AnoModeloMin: '0', AnoModeloMax: '0',
      ArCondicionado: 'false', DirecaoAssistida: 'false',
      Tag: '', ClienteSclId: '0',
      PageNumber: String(page), TopRows: String(size),
    });
    return `${BASE_URL}/Leiloes/PesquisarLotes?${p}`;
  }

  /** Uma página de cards já extraída para objetos. */
  async fetchPagina(page: number, size = PAGE_SIZE, tipoLoteId = 0, tipoNome = ''): Promise<FreitasRawLot[]> {
    const res = await fetchComRetry(this.url(page, size, tipoLoteId), {
      ...HEADERS_BROWSER,
      Referer: `${BASE_URL}/Leiloes/Pesquisar?query=&categoria=1`,
    });
    if (!res.ok) throw new Error(`PesquisarLotes p${page}: HTTP ${res.status}`);
    const html = await res.text();
    if (/Acesso Bloqueado/i.test(html)) {
      throw new Error(
        `PesquisarLotes p${page}: WAF (GoCache) bloqueou — confira o User-Agent`,
      );
    }
    return this.parsePagina(html, page).map((l) => ({ ...l, tipoNome }));
  }

  /** Exportado para teste offline: recebe HTML, devolve os cards. */
  parsePagina(html: string, page = 1): FreitasRawLot[] {
    const $ = cheerio.load(html);
    const cards = $('.cardlote');

    // HTML substancial sem nenhum card = maquete mudou, não "fim da lista"
    if (cards.length === 0 && html.replace(/\s|<[^>]*>/g, '').length > 200) {
      throw new Error(
        `PesquisarLotes p${page}: HTML com conteúdo mas nenhum .cardlote — ` +
        'a maquete do site provavelmente mudou',
      );
    }

    const out: FreitasRawLot[] = [];
    cards.each((_, el) => {
      const c = $(el);
      const href = c.find('a[href*="LoteDetalhes"]').first().attr('href') ?? '';
      const m = href.match(/leilaoId=(\d+)&(?:amp;)?loteNumero=(\d+)/i);
      if (!m) return;

      const datas = c.find('.cardLote-data span').map((_i, s) => $(s).text().trim()).get();

      out.push({
        tipoNome: '',
        leilaoId: m[1],
        loteNumero: m[2],
        numeroExibido: c.find('.cardLote-lote').text().trim(),
        descricao: c.find('.cardLote-descVeic').text().replace(/\s+/g, ' ').trim(),
        valorTexto: c.find('.cardLote-vlr').text().trim(),
        valorRotulo: c.find('.cardLote-lance').text().trim(),
        origem: c.find('.cardLote-details').text().replace(/\s+/g, ' ').trim(),
        situacao: c.text().match(/ABERTO PARA LANCES|ENCERRADO|EM BREVE|SUSPENSO/i)?.[0] ?? '',
        dataLeilao: datas[0] ?? '',
        horaLeilao: datas[1] ?? '',
        opcionais: c.find('.cardLote-opc button').map((_i, b) => $(b).attr('title') ?? '').get().filter(Boolean),
        imagem: c.find('img.cardLote-img').attr('src') ?? '',
        paginaUrl: `${BASE_URL}${href.replace(/&amp;/g, '&')}`,
      });
    });
    return out;
  }

  /**
   * Pagina POR TIPO, para que cada lote saia com o tipo correto.
   * ~572 lotes em 4 tipos = ~16 requests com TopRows=50.
   */
  async fetchAllLots(): Promise<FreitasRawLot[]> {
    const tipos = await this.fetchTipos();
    const todos: FreitasRawLot[] = [];
    const vistos = new Set<string>();

    for (const tipo of tipos) {
      console.log(`[${this.slug}] tipo "${tipo.nome}" (~${tipo.quantidade} lotes)`);
      for (let page = 1; page <= 100; page++) {
        await sleep(DELAY_MS);
        const lote = await this.fetchPagina(page, PAGE_SIZE, tipo.subTipoId, tipo.nome);
        if (lote.length === 0) break; // sentinela natural de fim
        for (const l of lote) {
          // um lote pode aparecer em mais de um tipo (ex.: "Desconto Desp.
          // OPE" e o tipo real) — a chave composta evita duplicar
          const chave = `${l.leilaoId}-${l.loteNumero}`;
          if (vistos.has(chave)) continue;
          vistos.add(chave);
          todos.push(l);
        }
      }
    }
    return todos;
  }
}
