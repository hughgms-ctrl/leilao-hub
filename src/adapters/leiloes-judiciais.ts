import * as cheerio from 'cheerio';

/**
 * ADAPTER: Leilões Judiciais (leiloesjudiciais.com.br)
 *
 * Sexta fonte, e a maior de acervo JUDICIAL do projeto: ~1.538 veículos,
 * contra 487 de todas as outras somadas.
 *
 *   Carros 756 | Motos 632 | Caminhões 70 | Ônibus 24 | outros ~56
 *
 * É um app Nuxt, mas renderizado no SERVIDOR: a listagem inteira vem no
 * HTML, então cheerio basta — sem browser. O `window.__NUXT__` da página
 * vem vazio (só config), e a API em api.leiloesjudiciais.com.br responde
 * 400 em toda rota que testei; não vale caçar, o HTML já traz tudo.
 *
 * Paginação: `?pagina=N` — 42 lotes por página. Cuidado: `?page=N` e
 * `?p=N` são ACEITOS e devolvem sempre a página 1, o que passaria
 * despercebido como coleta "completa" e truncada.
 *
 * O card é a própria âncora (<a class="card-lote-leilao" href=...>) e
 * traz mais dado que a maioria das fontes: avaliação, lance mínimo E
 * lance atual, além de visitas e nº de lances.
 */

export interface LjRawLot {
  leilaoId: string;
  loteId: string;
  descricao: string;    // "I/BMW X5 M50D - 18/19 - Preta - Depósito"
  cidadeUf?: string;    // "Porto Alegre/RS"
  statusTexto?: string; // "Aberto para Lance"
  avaliacao?: number;
  lanceMinimo?: number;
  lanceAtual?: number;
  categoria: string;    // slug da categoria de origem
  imagem?: string;
  paginaUrl: string;
  /** o acervo inteiro é judicial; o normalizer lê este campo */
  tipoLeilao: 'Judicial';
  /** encerramento do leilão — vem da página do leilão, não do card */
  auction_date_end?: string;
}

const BASE = 'https://www.leiloesjudiciais.com.br';
const DELAY_MS = 2000;
const MAX_PAGINAS = 40; // teto de segurança: carros tem 18

/**
 * Só as categorias que a FIPE pode cobrir ou que são veículo de fato.
 * Aeronaves, náuticos e motorhomes ficam de fora: não há tabela e só
 * gerariam lote sem score.
 */
export const CATEGORIAS: { slug: string; tipo: string }[] = [
  { slug: 'carros', tipo: 'carros' },
  { slug: 'motos', tipo: 'motos' },
  { slug: 'caminhoes', tipo: 'caminhões' },
  { slug: 'onibus', tipo: 'caminhões' },
  { slug: 'veiculos-pesados', tipo: 'utilit. pesados' },
  { slug: 'reboque-e-semireboque', tipo: 'implementos rod.' },
  { slug: 'tratores', tipo: 'tratores' },
  { slug: 'outros-veiculos', tipo: 'outros' },
];

const HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** "R$ 152.000,00" -> 152000 */
function precoBR(txt?: string): number | undefined {
  if (!txt) return undefined;
  const n = parseFloat(txt.replace(/[^\d,]/g, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function inteiro(txt?: string): number | undefined {
  const n = parseInt((txt ?? '').replace(/\D/g, ''), 10);
  return Number.isFinite(n) ? n : undefined;
}

export class LeiloesJudiciaisAdapter {
  slug = 'leiloes-judiciais';

  /**
   * O card é uma sequência plana de <span>. Ler por POSIÇÃO quebraria no
   * dia em que um campo faltar, então cada dado é achado por rótulo ou
   * por formato: cidade é o que casa "algo/UF", descrição é o texto com
   * " - ", e os valores vêm do span seguinte ao rótulo.
   */
  parseCards(html: string, categoria: string): LjRawLot[] {
    const $ = cheerio.load(html);
    const out: LjRawLot[] = [];

    $('a.card-lote-leilao').each((_, el) => {
      const c = $(el);
      c.find('svg, style, script').remove();

      const href = (c.attr('href') ?? '').split('?')[0];
      const m = href.match(/\/lote\/(\d+)\/(\d+)/);
      if (!m) return;

      const spans = c
        .find('span, strong')
        .map((_i, s) => $(s).clone().children().remove().end().text().replace(/\s+/g, ' ').trim())
        .get()
        .filter(Boolean);

      // valor que vem logo depois do rótulo
      const aposRotulo = (rotulo: RegExp): string | undefined => {
        const i = spans.findIndex((t) => rotulo.test(t));
        return i >= 0 ? spans[i + 1] : undefined;
      };

      const cidadeUf = spans.find((t) => /^[^/]{2,40}\/[A-Z]{2}$/.test(t));
      // descrição: o span com " - " que não seja a cidade nem um valor
      const descricao =
        spans.find(
          (t) => t !== cidadeUf && / - /.test(t) && !/^R\$/.test(t) && !/^#/.test(t),
        ) ?? '';

      const status = spans.find(
        (t) => /lance|encerrad|suspens|vendid|aberto/i.test(t) && !/^R\$/.test(t) && !/^Lance/i.test(t),
      );

      out.push({
        leilaoId: m[1],
        loteId: m[2],
        descricao,
        cidadeUf,
        statusTexto: status,
        avaliacao: precoBR(aposRotulo(/^Avalia/i)),
        lanceMinimo: precoBR(aposRotulo(/Lance m[íi]nimo/i)),
        lanceAtual: precoBR(aposRotulo(/Lance Atual/i)),
        categoria,
        imagem: c.find('img').first().attr('src') || undefined,
        paginaUrl: href.startsWith('http') ? href : `${BASE}${href}`,
        tipoLeilao: 'Judicial',
      });
    });

    return out;
  }

  /**
   * Encerramento do leilão. O CARD não traz data nenhuma — sem isto os
   * 2.123 lotes desta fonte entram sem prazo, e não dá para saber se um
   * lote fecha amanhã ou já fechou.
   *
   * A página do leilão rotula assim:
   *   "1º Encerramento - 20/08/2026 16:00"   (1ª praça)
   *   "2º Encerramento - 03/09/2026 16:00"   (2ª praça)
   *   "1º Ciclo - 18/09/2026 16:30"          (venda direta)
   *
   * Um mesmo leilão pode ter 6 datas: 2 praças e 4 ciclos de venda
   * direta. Gravamos o PRÓXIMO encerramento ainda no futuro, não o
   * último — dizer que o prazo é 08/12 quando a 1ª praça fecha em 22 dias
   * faria o usuário perder o lote achando que tinha tempo.
   *
   * Sem nenhuma data futura, devolve a última: serve para saber que o
   * leilão já acabou.
   */
  parseDataFim(html: string, agora = new Date()): string | undefined {
    const t = cheerio.load(html)('body').text().replace(/\s+/g, ' ');
    const datas = [...t.matchAll(/(?:Encerramento|Ciclo)\s*-\s*(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/g)]
      .map((m) => `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:00`)
      .sort();
    if (!datas.length) return undefined;

    const iso = agora.toISOString().slice(0, 19);
    return datas.find((d) => d > iso) ?? datas[datas.length - 1];
  }

  /** Busca o encerramento de cada leilão distinto. Sequencial, com delay. */
  async fetchDatasLeilao(ids: string[]): Promise<Map<string, string>> {
    const datas = new Map<string, string>();
    for (const id of ids) {
      await sleep(DELAY_MS);
      try {
        const r = await fetch(`${BASE}/leilao/${id}`, { headers: HEADERS });
        if (!r.ok) continue;
        const d = this.parseDataFim(await r.text());
        if (d) datas.set(id, d);
      } catch {
        // um leilão sem data não impede os outros
      }
    }
    console.log(`[${this.slug}] datas: ${datas.size}/${ids.length} leilões com encerramento`);
    return datas;
  }

  /** "Página 3 de 18" -> 18 */
  totalPaginas(html: string): number {
    const t = cheerio.load(html)('body').text().replace(/\s+/g, ' ');
    const m = t.match(/P[áa]gina\s+\d+\s+de\s+(\d+)/i);
    return m ? Number(m[1]) : 1;
  }

  async fetchCategoria(cat: { slug: string; tipo: string }): Promise<LjRawLot[]> {
    const todos: LjRawLot[] = [];
    const vistos = new Set<string>();
    let total = 1;

    for (let pagina = 1; pagina <= Math.min(total, MAX_PAGINAS); pagina++) {
      if (pagina > 1) await sleep(DELAY_MS);

      const url = `${BASE}/veiculos/${cat.slug}${pagina > 1 ? `?pagina=${pagina}` : ''}`;
      const r = await fetch(url, { headers: HEADERS });
      if (!r.ok) throw new Error(`${cat.slug} p${pagina}: HTTP ${r.status}`);
      const html = await r.text();

      if (pagina === 1) total = this.totalPaginas(html);

      let novos = 0;
      for (const l of this.parseCards(html, cat.slug)) {
        const k = `${l.leilaoId}-${l.loteId}`;
        if (vistos.has(k)) continue;
        vistos.add(k);
        todos.push(l);
        novos++;
      }
      if (novos === 0) break;
    }

    console.log(`[${this.slug}] ${cat.slug}: ${todos.length} lotes (${total} páginas)`);
    return todos;
  }

  async fetchAllLots(comDatas = true): Promise<LjRawLot[]> {
    const todos: LjRawLot[] = [];
    for (const cat of CATEGORIAS) {
      try {
        todos.push(...(await this.fetchCategoria(cat)));
      } catch (e) {
        // uma categoria que falha não derruba as outras
        console.error(`[${this.slug}] ${cat.slug} FALHOU:`, (e as Error).message);
      }
      await sleep(DELAY_MS);
    }

    // Segunda passada só pelos leilões DISTINTOS: são ~330 para ~2.100
    // lotes, então buscar por leilão custa 6x menos que por lote.
    if (comDatas && todos.length) {
      const ids = [...new Set(todos.map((l) => l.leilaoId))];
      const datas = await this.fetchDatasLeilao(ids);
      for (const l of todos) l.auction_date_end = datas.get(l.leilaoId);
    }

    return todos;
  }
}
