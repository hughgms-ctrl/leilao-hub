import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import type { RawLot } from '../types';

/**
 * ADAPTER v2: Sodré Santoro — via API interna descoberta no DevTools.
 *
 * Endpoint real:  POST https://www.sodresantoro.com.br/api/search-lots
 * Formato:        proxy de Elasticsearch
 *   Request body: { indices: ["veiculos","judiciais-veiculos"], query: {...}, size, ... }
 *   Response:     { results: [...], aggs: {...}, total, page, perPage }
 *
 * Campos conhecidos dos documentos (confirmados pelas aggs):
 *   lot_brand, lot_model, lot_year_model, lot_km, lot_fuel, lot_category,
 *   lot_location ("guarulhos i/sp"), lot_origin (seguro/frota/judicial...),
 *   lot_sinister (média monta/pequena monta/sem sinistro), lot_praca_label,
 *   client_name (comitente), lot_financeable, lot_transmission, lot_optionals
 *
 * Proteção: Azion Bot Manager (cookies az_asm / az_botm).
 * Estratégia: Playwright abre o site UMA vez, coleta os cookies da sessão,
 * e daí em diante tudo é fetch direto na API — rápido e sem parse de HTML.
 */

const BASE_URL = 'https://www.sodresantoro.com.br';
const API_URL = `${BASE_URL}/api/search-lots`;
const PAGE_SIZE = 50;
const DELAY_MS = 2000;
const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Filtro de "lote ativo", copiado do corpo real que o site envia:
 *   - leilão online; ou
 *   - leilão aberto, exceto lotes com status 5/7 (retirado/cancelado); ou
 *   - leilão encerrado, mas lote com status 6 (vendido/condicional)
 *   - nunca lotes de teste (lot_test)
 * Sem esse filtro a API devolve lote encerrado e lote de teste junto.
 */
const ACTIVE_LOTS_FILTER = [
  {
    bool: {
      should: [
        { bool: { must: [{ term: { auction_status: 'online' } }] } },
        {
          bool: {
            must: [{ term: { auction_status: 'aberto' } }],
            must_not: [{ terms: { lot_status_id: [5, 7] } }],
          },
        },
        {
          bool: {
            must: [
              { term: { auction_status: 'encerrado' } },
              { terms: { lot_status_id: [6] } },
            ],
          },
        },
      ],
      minimum_should_match: 1,
    },
  },
  {
    bool: {
      should: [{ bool: { must_not: [{ term: { lot_test: true } }] } }],
      minimum_should_match: 1,
    },
  },
];

interface SearchLotsResponse {
  results: Record<string, any>[];
  total: number;
  page?: number;
  perPage?: number;
}

export class SodreSantoroApiAdapter {
  slug = 'sodre-santoro';
  private cookieHeader = '';

  /** corpo real da requisição que o site faz, capturado no bootstrap */
  capturedRequestBody: Record<string, any> | null = null;
  /** resposta real da 1ª página, capturada no bootstrap */
  capturedResponse: SearchLotsResponse | null = null;

  /**
   * Passa pelo Azion Bot Manager com um navegador real e captura os
   * cookies da sessão. Chamar uma vez por run; cookies valem 24h
   * (Max-Age=86400 visto no DevTools).
   *
   * Também intercepta a chamada que o PRÓPRIO site faz para
   * /api/search-lots. Foi daí que saiu o formato real de query/paginação
   * e o shape dos documentos, sem gastar requisição extra contra a API —
   * é o caminho para reconferir se o site mudar o contrato.
   */
  async bootstrap(): Promise<void> {
    const browser = await chromium.launch({ headless: true });
    try {
      const ctx = await browser.newContext({
        userAgent: USER_AGENT,
        locale: 'pt-BR',
      });
      const page = await ctx.newPage();

      page.on('request', (req) => {
        if (!req.url().includes('/api/search-lots')) return;
        try {
          const post = req.postData();
          if (post && !this.capturedRequestBody) {
            this.capturedRequestBody = JSON.parse(post);
          }
        } catch {
          /* corpo não-JSON: ignora */
        }
      });
      page.on('response', async (res) => {
        if (!res.url().includes('/api/search-lots')) return;
        try {
          const body = await res.json();
          // a 1ª chamada do site é só de agregação (size: 0, results vazio);
          // guardamos a primeira que realmente traz lotes.
          if (!this.capturedResponse && body?.results?.length) {
            this.capturedResponse = body;
          }
        } catch {
          /* resposta não-JSON ou já consumida: ignora */
        }
      });

      await page.goto(`${BASE_URL}/veiculos/lotes`, {
        waitUntil: 'networkidle',
        timeout: 60_000,
      });
      const cookies = await ctx.cookies();
      this.cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
    } finally {
      await browser.close();
    }
  }

  /**
   * Modo exploração: roda o bootstrap e grava em disco o corpo real da
   * requisição + a resposta bruta completa da 1ª página. A partir daí a
   * iteração no parser é feita em cima do arquivo, sem bater no site.
   */
  async dumpSample(): Promise<void> {
    await this.bootstrap();

    if (this.capturedRequestBody) {
      writeFileSync(
        'sample-request.json',
        JSON.stringify(this.capturedRequestBody, null, 2),
      );
      console.log('[dump] sample-request.json — corpo real enviado pelo site');
    } else {
      console.log('[dump] o site não disparou /api/search-lots durante o load');
    }

    // Prefere a resposta que o próprio site recebeu; só se o site não tiver
    // chamado a API no load é que gastamos uma requisição nossa.
    const first = this.capturedResponse ?? (await this.searchLots(0, PAGE_SIZE));
    writeFileSync('sample-response.json', JSON.stringify(first, null, 2));
    console.log(
      `[dump] sample-response.json — ${first?.results?.length ?? 0} lotes, total=${first?.total}`,
    );
  }

  /**
   * Busca uma página de lotes direto na API.
   *
   * Formato confirmado contra a API real:
   *
   *   - Paginação é `from`/`size` (Elasticsearch puro). ATENÇÃO: a resposta
   *     devolve `page`/`perPage`, mas `page` é SÓ ECO — mandar `page: 2` faz
   *     a API responder `"page": 2` e devolver de novo os MESMOS lotes da
   *     página 1. Paginar por `page` re-coletaria a 1ª página 15 vezes.
   *     `perPage` reflete o `size` enviado.
   *   - `sort` é respeitado. Ordenamos por `lot_id` asc: chave única e
   *     estável, então as janelas de `from` não se sobrepõem nem pulam lote
   *     (sem sort determinístico, paginação profunda no ES pode duplicar).
   *   - `query.bool.filter` precisa do filtro de lote ativo; com `filter: []`
   *     a API mistura lote encerrado e lote de teste.
   */
  async searchLots(from = 0, size = PAGE_SIZE): Promise<SearchLotsResponse> {
    const body = {
      indices: ['veiculos', 'judiciais-veiculos'],
      query: {
        bool: {
          filter: ACTIVE_LOTS_FILTER,
        },
      },
      from,
      size,
      sort: [{ lot_id: 'asc' }],
    };

    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
        Cookie: this.cookieHeader,
        Origin: BASE_URL,
        Referer: `${BASE_URL}/veiculos/lotes`,
      },
      body: JSON.stringify(body),
    });

    if (res.status === 403) {
      throw new Error(
        'Azion bloqueou a requisição (403). Rode bootstrap() de novo para renovar cookies.',
      );
    }
    if (!res.ok) {
      throw new Error(`search-lots falhou: HTTP ${res.status}`);
    }
    return (await res.json()) as SearchLotsResponse;
  }

  /**
   * Pagina a API inteira e devolve todos os lotes ativos.
   * Com 705 lotes e PAGE_SIZE=50 são ~15 requests — tranquilo com delay de 2s.
   */
  async fetchAllLots(): Promise<{ raw: Record<string, any>[]; parsed: RawLot[] }> {
    if (!this.cookieHeader) await this.bootstrap();

    const first = await this.searchLots(0, PAGE_SIZE);

    // Guarda a 1ª página bruta em disco: é a partir dela que se itera no
    // parser depois, sem precisar bater no site de novo.
    writeFileSync('sample-response.json', JSON.stringify(first, null, 2));

    const total = first.total ?? first.results.length;
    const all: Record<string, any>[] = [];
    const seen = new Set<string>();

    // dedup por lot_id: rede de segurança caso a janela de `from` deslize
    const push = (results: Record<string, any>[]) => {
      for (const r of results) {
        const id = String(r.lot_id ?? '');
        if (id && seen.has(id)) continue;
        if (id) seen.add(id);
        all.push(r);
      }
    };
    push(first.results);

    for (let from = PAGE_SIZE; from < total; from += PAGE_SIZE) {
      await sleep(DELAY_MS);
      const page = await this.searchLots(from, PAGE_SIZE);
      if (page.results.length === 0) break; // segurança contra loop infinito
      push(page.results);
    }

    return { raw: all, parsed: all.map((r) => this.mapLot(r)) };
  }

  /**
   * Mapeia um documento da API para RawLot.
   *
   * Shape confirmado contra um documento real: os documentos vêm PLANOS,
   * sem envelope `_source` do Elasticsearch.
   *
   * Notas de campo que não são óbvias:
   *   - identidade do lote é `lot_id` (numérico). O campo `id` é o
   *     `index_id` do documento no índice, NÃO o id do lote — é ele que
   *     aparece duplicado em `index_id`, e não bate com a URL do lote.
   *   - `bid_initial` / `bid_actual` vêm como STRING ("4200.00").
   *   - quando ninguém deu lance ainda, `bid_actual` repete `bid_initial`;
   *     `bid_has_bid` é quem diz se existe lance de verdade.
   *   - `lot_color` vem "" (string vazia) quando não informado.
   *   - não existe campo de valor de mercado/FIPE. Em lote judicial o valor
   *     de avaliação vem em `tj_praca_value` (geralmente null) e no texto de
   *     `lot_description`; extrair do texto fica para o normalizer.
   */
  mapLot(d: Record<string, any>): RawLot {
    return {
      externalId: String(d.lot_id ?? ''),
      auctionExternalId: String(d.auction_id ?? ''),
      numeroLote: d.lot_number || undefined,
      tipo: d.lot_category,                 // "carros", "motos", "caminhões"...
      marca: d.lot_brand,
      modelo: d.lot_model,
      anoFabricacao: this.toInt(d.lot_year_manufacture),
      anoModelo: this.toInt(d.lot_year_model),
      cor: d.lot_color || undefined,
      combustivel: d.lot_fuel ?? undefined,
      km: this.toInt(d.lot_km),
      condicao: d.lot_sinister,             // "média monta", "sem sinistro"...
      descricao: d.lot_description || d.lot_title || undefined,
      lanceInicial: this.toNum(d.bid_initial),
      // sem lance, a API repete o inicial — só reporta lance atual se houver
      lanceAtual: d.bid_has_bid ? this.toNum(d.bid_actual) : undefined,
      valorMercado: this.toNum(d.tj_praca_value),
      imagens: this.extractImages(d),
      paginaUrl: `${BASE_URL}/leilao/${d.auction_id}/lote/${d.lot_id}`,
    };
  }

  private extractImages(d: Record<string, any>): string[] {
    const cand = d.lot_pictures;
    if (!Array.isArray(cand)) return [];
    return cand
      .map((i: any) => (typeof i === 'string' ? i : i?.url ?? i?.src))
      .filter(Boolean);
  }

  private toInt(v: unknown): number | undefined {
    const n = parseInt(String(v), 10);
    return Number.isFinite(n) ? n : undefined;
  }

  private toNum(v: unknown): number | undefined {
    const n = typeof v === 'number' ? v : parseFloat(String(v));
    return Number.isFinite(n) ? n : undefined;
  }
}
