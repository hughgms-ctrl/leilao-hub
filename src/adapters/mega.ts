import * as cheerio from 'cheerio';

/**
 * ADAPTER: Mega Leilões (megaleiloes.com.br)
 *
 * Terceira fonte, escolhida por um motivo específico: o acervo de
 * veículos deles é praticamente TODO judicial (medido: 121 lotes, todos
 * marcados "Judicial"), enquanto no Sodré o judicial é resíduo. É aqui
 * que mora o carro com proposta de pagamento parcelado do art. 895.
 *
 * Como a Freitas, é HTML server-rendered — sem API JSON. Mas o markup é
 * totalmente semântico (`card-number`, `card-price`, `card-instance-*`),
 * então o parse é direto.
 *
 * Estrutura judicial: cada lote tem 1ª e 2ª praça, com datas e valores
 * diferentes. A 2ª praça é o valor com deságio (tipicamente 50%), e é o
 * que vale como lance de referência quando a 1ª já passou.
 *
 * Paginação: /veiculos?pagina=N. ATENÇÃO: pedir página além da última
 * devolve de novo a última, em vez de vazio — por isso a parada é por
 * "não vieram lotes novos", não por página vazia.
 */

const BASE_URL = 'https://www.megaleiloes.com.br';
const DELAY_MS = 2000;
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const HEADERS: Record<string, string> = {
  'User-Agent': USER_AGENT,
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Registro cru de um lote do Mega: strings literais, sem interpretação. */
export interface MegaRawLot {
  codigo: string;          // J126262 — id externo
  leilaoId: string;        // vem do link do auditório
  titulo: string;
  numeroLote: string;
  categoria: string;       // carros | motos | caminhoes (da URL)
  localidade: string;      // "São Paulo, SP"
  precoAtual: string;
  tipoLeilao: string;      // "Judicial" | "Extrajudicial"
  status: string;
  praca1Data: string;
  praca1Valor: string;
  praca2Data: string;
  praca2Valor: string;
  paginaUrl: string;
  imagem: string;
  // preenchidos pela coleta de detalhe
  descricao?: string;
  condicoes?: string;
}

export class MegaAdapter {
  slug = 'mega-leiloes';

  private async buscar(url: string): Promise<string> {
    const res = await fetch(url, { headers: HEADERS, redirect: 'follow' });
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    return res.text();
  }

  /** Extrai os cards de uma página de listagem. Exportado para teste offline. */
  parseListagem(html: string, pagina = 1): MegaRawLot[] {
    const $ = cheerio.load(html);
    const cards = $('.card').filter((_, el) => $(el).find('.card-number').length > 0);

    if (cards.length === 0 && html.replace(/\s|<[^>]*>/g, '').length > 500) {
      throw new Error(
        `listagem p${pagina}: HTML com conteúdo mas nenhum .card com .card-number — ` +
        'a maquete do Mega provavelmente mudou',
      );
    }

    const out: MegaRawLot[] = [];
    cards.each((_, el) => {
      const c = $(el);
      const txt = (s: string) => c.find(s).first().text().replace(/\s+/g, ' ').trim();

      const href = (c.find('a.card-image').attr('href') ?? c.find('a.card-title').attr('href') ?? '')
        .split('?')[0];
      const codigo = txt('.card-number');
      if (!codigo) return;

      // /auditorio/{leilaoId}/{loteId}/batch
      const gavet = c.find('a.card-gavet-link').attr('href') ?? '';
      const leilaoId = gavet.match(/\/auditorio\/(\d+)\//)?.[1] ?? '';

      // /veiculos/{categoria}/{uf}/{cidade}/{slug}
      const categoria = href.match(/\/veiculos\/([a-z-]+)\//i)?.[1] ?? '';

      // o bg da imagem vem em style ou data-bg (lazyload)
      const estilo = c.find('a.card-image').attr('style') ?? '';
      const imagem =
        c.find('a.card-image').attr('data-bg') ??
        estilo.match(/url\((?:&quot;|["'])?([^"')]+)/)?.[1] ??
        '';

      out.push({
        codigo,
        leilaoId,
        titulo: txt('.card-title'),
        numeroLote: txt('.card-batch-number'),
        categoria,
        localidade: txt('.card-locality'),
        precoAtual: txt('.card-price'),
        tipoLeilao: txt('.card-instance-title a'),
        status: txt('.card-status'),
        praca1Data: txt('.card-first-instance-date'),
        praca1Valor: c.find('.instance.first .card-instance-value').first().text().trim(),
        praca2Data: txt('.card-second-instance-date'),
        praca2Valor: c.find('.instance').eq(1).find('.card-instance-value').first().text().trim(),
        paginaUrl: href,
        imagem: /card-no-image/.test(imagem) ? '' : imagem,
      });
    });
    return out;
  }

  /**
   * Detalhe do lote: descrição completa (placa, chassi, renavam, DÉBITOS
   * do veículo) e o texto das condições, de onde sai a detecção do
   * parcelamento do art. 895. Sem isto o lote entra sem o dado que é o
   * ponto de existir a fonte.
   */
  parseDetalhe(html: string): { descricao?: string; condicoes?: string } {
    const $ = cheerio.load(html);
    $('script, style, nav, header, footer').remove();
    const texto = $('body').text().replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

    // a descrição do bem começa no "LOTE Nº"; as condições, no edital
    const iLote = texto.search(/LOTE\s*N[ºo°]/i);
    const descricao = iLote >= 0 ? texto.slice(iLote, iLote + 2500).trim() : undefined;

    return { descricao, condicoes: texto.slice(0, 60000) };
  }

  /**
   * Pagina a listagem de veículos e busca o detalhe de cada lote.
   *
   * A parada é por "nenhum lote novo": pedir página além da última faz o
   * Mega devolver de novo a última, então página vazia não serve de
   * sentinela (foi assim que a página 4 repetiu a 3 no teste).
   */
  async fetchAllLots(comDetalhe = true): Promise<MegaRawLot[]> {
    const todos: MegaRawLot[] = [];
    const vistos = new Set<string>();

    for (let pagina = 1; pagina <= 40; pagina++) {
      if (pagina > 1) await sleep(DELAY_MS);
      const html = await this.buscar(`${BASE_URL}/veiculos?pagina=${pagina}`);
      const lotes = this.parseListagem(html, pagina);

      const novos = lotes.filter((l) => !vistos.has(l.codigo));
      if (novos.length === 0) break; // última página repetida = fim
      for (const l of novos) {
        vistos.add(l.codigo);
        todos.push(l);
      }
      console.log(`[${this.slug}] página ${pagina}: +${novos.length} lotes (total ${todos.length})`);
    }

    if (!comDetalhe) return todos;

    console.log(`[${this.slug}] buscando detalhe de ${todos.length} lotes...`);
    let falhas = 0;
    for (const lote of todos) {
      await sleep(DELAY_MS);
      try {
        const d = this.parseDetalhe(await this.buscar(lote.paginaUrl));
        lote.descricao = d.descricao;
        lote.condicoes = d.condicoes;
      } catch (e) {
        falhas++;
        console.warn(`[${this.slug}] detalhe de ${lote.codigo} falhou: ${(e as Error).message}`);
      }
    }
    if (falhas) console.warn(`[${this.slug}] ${falhas} detalhes falharam`);
    return todos;
  }
}
