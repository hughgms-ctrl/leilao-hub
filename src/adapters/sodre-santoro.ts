import { chromium, type Browser, type Page } from 'playwright';
import type { RawAuction, RawLot, ScraperAdapter } from '../types';

/**
 * ADAPTER: Sodré Santoro (sodresantoro.com.br)
 *
 * ⚠️ IMPORTANTE — leia antes de rodar:
 *
 * 1. Os seletores CSS e endpoints marcados com [VERIFICAR] abaixo são
 *    hipóteses baseadas na estrutura típica desse tipo de site. Sites de
 *    leiloeiro mudam com frequência. Antes do primeiro run:
 *      a) Abra o site no Chrome com DevTools → aba Network → filtro XHR/Fetch
 *      b) Navegue até a listagem de leilões de veículos
 *      c) Procure requests que retornam JSON com a lista de lotes/leilões
 *    Se existir um endpoint JSON interno (quase sempre existe em site com
 *    filtro dinâmico), a ESTRATÉGIA A abaixo captura ele automaticamente —
 *    você só precisa ajustar o padrão de URL em JSON_URL_PATTERNS.
 *
 * 2. A ESTRATÉGIA B (parse do DOM) é fallback. É mais frágil; ajuste os
 *    seletores inspecionando o HTML real.
 *
 * 3. Rate limiting: DELAY_MS entre páginas. Não abaixe. Um scraper educado
 *    passa despercebido; um agressivo toma bloqueio de IP e estraga o
 *    projeto inteiro.
 *
 * 4. Respeite o robots.txt e os Termos de Uso do site. Rode com IP fixo
 *    identificável e User-Agent honesto se for operar isso como produto.
 */

const BASE_URL = 'https://www.sodresantoro.com.br';
const LISTING_URL = `${BASE_URL}/veiculos/lotes`; // [VERIFICAR] rota real da listagem
const DELAY_MS = 3000;
const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

// Padrões de URL que provavelmente carregam JSON de lotes/leilões.
// Ajuste depois de inspecionar a aba Network. [VERIFICAR]
const JSON_URL_PATTERNS = [/\/api\//i, /\/lotes/i, /\/auctions/i, /\/search/i];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface CapturedJson {
  url: string;
  body: unknown;
}

export class SodreSantoroAdapter implements ScraperAdapter {
  slug = 'sodre-santoro';
  private browser: Browser | null = null;

  private async getPage(): Promise<Page> {
    if (!this.browser) {
      this.browser = await chromium.launch({ headless: true });
    }
    const ctx = await this.browser.newContext({
      userAgent: USER_AGENT,
      locale: 'pt-BR',
    });
    return ctx.newPage();
  }

  /**
   * ESTRATÉGIA A — intercepta respostas JSON enquanto navega.
   * Muito mais robusta que parsear HTML: o payload JSON interno do site
   * costuma ter TODOS os campos (km, chassi, lance) já estruturados.
   */
  private captureJson(page: Page): CapturedJson[] {
    const captured: CapturedJson[] = [];
    page.on('response', async (res) => {
      try {
        const url = res.url();
        const ct = res.headers()['content-type'] ?? '';
        if (!ct.includes('application/json')) return;
        if (!JSON_URL_PATTERNS.some((p) => p.test(url))) return;
        const body = await res.json();
        captured.push({ url, body });
      } catch {
        /* respostas não-JSON ou já consumidas: ignora */
      }
    });
    return captured;
  }

  async fetchAuctions(): Promise<RawAuction[]> {
    const page = await this.getPage();
    const captured = this.captureJson(page);

    await page.goto(LISTING_URL, { waitUntil: 'networkidle', timeout: 60_000 });
    await sleep(DELAY_MS);

    // Se a Estratégia A capturou JSON, prefira-o:
    const jsonHit = captured.find((c) => this.looksLikeAuctionList(c.body));
    if (jsonHit) {
      await page.context().close();
      return this.parseAuctionsFromJson(jsonHit.body, jsonHit.url);
    }

    // ESTRATÉGIA B — fallback DOM [VERIFICAR seletores]
    const auctions = await page.$$eval(
      '[data-testid="auction-card"], .card-leilao, article.leilao', // [VERIFICAR]
      (cards) =>
        cards.map((el) => ({
          externalId:
            el.getAttribute('data-id') ??
            (el.querySelector('a') as HTMLAnchorElement | null)?.href ??
            '',
          titulo: el.querySelector('h2, h3, .titulo')?.textContent?.trim() ?? '',
          paginaUrl:
            (el.querySelector('a') as HTMLAnchorElement | null)?.href ?? '',
          dataTexto: el.querySelector('.data, time')?.textContent?.trim() ?? '',
        })),
    );

    await page.context().close();

    return auctions
      .filter((a) => a.externalId && a.paginaUrl)
      .map((a) => ({
        externalId: this.normalizeId(a.externalId),
        titulo: a.titulo,
        paginaUrl: a.paginaUrl,
        // dataTexto fica no payload bruto; normalizer converte p/ ISO
        descricao: a.dataTexto || undefined,
      }));
  }

  async fetchLots(auction: RawAuction): Promise<RawLot[]> {
    const page = await this.getPage();
    const captured = this.captureJson(page);

    await page.goto(auction.paginaUrl, {
      waitUntil: 'networkidle',
      timeout: 60_000,
    });

    // Muitos sites carregam lotes com scroll infinito — força carregamento:
    await this.autoScroll(page);
    await sleep(DELAY_MS);

    const jsonHit = captured.find((c) => this.looksLikeLotList(c.body));
    if (jsonHit) {
      await page.context().close();
      return this.parseLotsFromJson(jsonHit.body, auction);
    }

    // Fallback DOM [VERIFICAR seletores]
    const lots = await page.$$eval(
      '[data-testid="lot-card"], .card-lote, article.lote', // [VERIFICAR]
      (cards) =>
        cards.map((el) => ({
          externalId: el.getAttribute('data-id') ?? '',
          titulo: el.querySelector('h3, .titulo')?.textContent?.trim() ?? '',
          lanceTexto:
            el.querySelector('.lance, .valor, .price')?.textContent?.trim() ??
            '',
          url: (el.querySelector('a') as HTMLAnchorElement | null)?.href ?? '',
          img: (el.querySelector('img') as HTMLImageElement | null)?.src ?? '',
        })),
    );

    await page.context().close();

    return lots
      .filter((l) => l.externalId || l.url)
      .map((l) => ({
        externalId: this.normalizeId(l.externalId || l.url),
        auctionExternalId: auction.externalId,
        descricao: l.titulo,
        lanceAtual: this.parseBRL(l.lanceTexto),
        imagens: l.img ? [l.img] : [],
        paginaUrl: l.url,
      }));
  }

  async close(): Promise<void> {
    await this.browser?.close();
    this.browser = null;
  }

  // ---------- helpers ----------

  /** heurística: o JSON capturado parece uma lista de leilões? */
  private looksLikeAuctionList(body: unknown): boolean {
    const arr = this.extractArray(body);
    if (!arr || arr.length === 0) return false;
    const sample = arr[0] as Record<string, unknown>;
    const keys = Object.keys(sample).map((k) => k.toLowerCase());
    return keys.some((k) => /leilao|auction|evento|edital/.test(k));
  }

  private looksLikeLotList(body: unknown): boolean {
    const arr = this.extractArray(body);
    if (!arr || arr.length === 0) return false;
    const sample = arr[0] as Record<string, unknown>;
    const keys = Object.keys(sample).map((k) => k.toLowerCase());
    return keys.some((k) => /lote|lot|lance|bid|veiculo|placa|chassi/.test(k));
  }

  /** APIs variam: { data: [...] }, { items: [...] }, { results: [...] } ou array direto */
  private extractArray(body: unknown): unknown[] | null {
    if (Array.isArray(body)) return body;
    if (typeof body === 'object' && body !== null) {
      for (const key of ['data', 'items', 'results', 'lotes', 'leiloes', 'content']) {
        const v = (body as Record<string, unknown>)[key];
        if (Array.isArray(v)) return v;
      }
    }
    return null;
  }

  /**
   * Mapeia o JSON interno do site para RawAuction/RawLot.
   * Os nomes de campo aqui são chutes educados — ajuste após capturar
   * o JSON real (rode uma vez e inspecione raw_scrapes.payload). [VERIFICAR]
   */
  private parseAuctionsFromJson(body: unknown, url: string): RawAuction[] {
    const arr = this.extractArray(body) ?? [];
    return arr.map((item) => {
      const a = item as Record<string, any>;
      return {
        externalId: String(a.id ?? a.codigo ?? a.slug ?? ''),
        titulo: a.titulo ?? a.nome ?? a.title ?? '',
        modalidade: undefined,
        dataInicio: a.dataInicio ?? a.data_inicio ?? a.startDate,
        dataFim: a.dataFim ?? a.data_fim ?? a.endDate,
        cidade: a.cidade ?? a.city,
        uf: a.uf ?? a.estado ?? a.state,
        editalPdfUrl: a.edital ?? a.editalUrl ?? a.edital_pdf,
        paginaUrl: a.url ?? `${BASE_URL}/leilao/${a.id ?? a.slug ?? ''}`,
        comitente: a.comitente,
      } satisfies RawAuction;
    }).filter((a) => a.externalId);
  }

  private parseLotsFromJson(body: unknown, auction: RawAuction): RawLot[] {
    const arr = this.extractArray(body) ?? [];
    return arr.map((item) => {
      const l = item as Record<string, any>;
      return {
        externalId: String(l.id ?? l.codigo ?? ''),
        auctionExternalId: auction.externalId,
        numeroLote: l.numeroLote ?? l.numero ?? l.lote,
        tipo: l.tipo ?? l.categoria,
        marca: l.marca ?? l.brand,
        modelo: l.modelo ?? l.model,
        versao: l.versao,
        anoFabricacao: this.toInt(l.anoFabricacao ?? l.ano_fab),
        anoModelo: this.toInt(l.anoModelo ?? l.ano_modelo ?? l.ano),
        cor: l.cor,
        combustivel: l.combustivel,
        km: this.toInt(l.km ?? l.quilometragem),
        condicao: l.condicao ?? l.situacao,
        temChave: typeof l.chave === 'boolean' ? l.chave : undefined,
        documentacao: l.documentacao ?? l.doc,
        descricao: l.descricao ?? l.titulo,
        lanceInicial: this.toNum(l.lanceInicial ?? l.lance_inicial),
        lanceAtual: this.toNum(l.lanceAtual ?? l.lance_atual ?? l.lance),
        valorMercado: this.toNum(l.valorMercado ?? l.avaliacao),
        imagens: Array.isArray(l.imagens)
          ? l.imagens.map((i: any) => (typeof i === 'string' ? i : i?.url)).filter(Boolean)
          : l.imagem
            ? [l.imagem]
            : [],
        paginaUrl: l.url ?? `${auction.paginaUrl}#lote-${l.id ?? ''}`,
      } satisfies RawLot;
    }).filter((l) => l.externalId);
  }

  private async autoScroll(page: Page): Promise<void> {
    await page.evaluate(async () => {
      await new Promise<void>((resolve) => {
        let total = 0;
        const step = 600;
        const timer = setInterval(() => {
          window.scrollBy(0, step);
          total += step;
          if (total >= document.body.scrollHeight || total > 30_000) {
            clearInterval(timer);
            resolve();
          }
        }, 400);
      });
    });
  }

  /** "R$ 12.345,67" → 12345.67 */
  private parseBRL(txt: string): number | undefined {
    const m = txt.replace(/[^\d,.]/g, '').replace(/\./g, '').replace(',', '.');
    const n = parseFloat(m);
    return Number.isFinite(n) ? n : undefined;
  }

  private toInt(v: unknown): number | undefined {
    const n = parseInt(String(v), 10);
    return Number.isFinite(n) ? n : undefined;
  }

  private toNum(v: unknown): number | undefined {
    const n = typeof v === 'number' ? v : parseFloat(String(v));
    return Number.isFinite(n) ? n : undefined;
  }

  private normalizeId(raw: string): string {
    // extrai o último segmento numérico/slug de uma URL, se for o caso
    const m = raw.match(/([a-z0-9-]+)\/?$/i);
    return m ? m[1] : raw;
  }
}
