/**
 * ADAPTER: Superbid / Canal Judicial (canaljudicial.com.br)
 *
 * Quinta fonte, e a de melhor qualidade do projeto: API JSON paginada,
 * sem proteção de bot no caminho, com praça e parcelamento ESTRUTURADOS
 * — nada de garimpar edital com regex.
 *
 * Como cheguei no endpoint (vale registrar, porque tem duas armadilhas):
 *
 *   1. Existe um `/seo/offers/` no mesmo host que devolve payload POBRE:
 *      praça sempre "Praça Única", parcelamento e processo vazios. O front
 *      escolhe `/seo` só quando a query traz `urlSeo`:
 *          "/offer-query" + (r.includes("urlSeo") ? "/seo" : "") + "/offers/?"
 *      Sem `urlSeo` vem o payload completo.
 *
 *   2. O acervo judicial NÃO é um portal separado. `portalId` continua
 *      [2,15] (o mesmo do marketplace) e o que separa é o filtro por
 *      submarketplace. portalId=[9], que eu havia testado, é o Superbid
 *      ARGENTINA — devolvia 293 e quase bateu com os 298 por coincidência.
 *
 * O total confere com o que o site exibe (298 veículos).
 */

export interface SuperbidRawLot {
  offerId: number;
  auctionId: number;
  lotNumber?: number;
  shortDesc: string;
  /** descrição longa (vem na MESMA resposta); repõe ano que falta no shortDesc */
  detalhe?: string;
  subCategoria?: string;
  cidadeUf?: string;       // "Pirapozinho - SP"
  preco?: number;
  temLance: boolean;
  totalLances?: number;
  imagens: string[];
  paginaUrl: string;
  /** vocabulário que o normalizer já entende (mesmo do Sodré) */
  auction_name?: string;
  auction_date_init?: string;
  auction_date_end?: string;
  tipoLeilao: 'Judicial';
  praca?: string;
  leiloeiro?: string;
  /** condição comercial estruturada: 25% de entrada + 30x é o art. 895 */
  parcelamento?: { parcelas: number; entradaPct: number };
}

const API = 'https://offer-query.superbid.net/offers/';
const SITE = 'https://www.canaljudicial.com.br';
const PAGE_SIZE = 100;
const DELAY_MS = 2000;

/**
 * `;` separa condições. Sem o segundo termo viriam os ~5 mil lotes
 * corporativos, que não são judiciais nem parceláveis.
 */
const FILTRO = [
  'product.productType.description:carros-motos',
  'auction.subMarketplaces.subMarketplaceDesc:judicial',
].join(';');

const HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  Accept: 'application/json',
  'Accept-Language': 'pt-BR,pt;q=0.9',
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** detailedDescription vem com HTML e entidades; vira texto puro. */
function textoPuro(html: unknown): string | undefined {
  if (typeof html !== 'string' || !html.trim()) return undefined;
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n)))
    .replace(/\s+/g, ' ')
    .trim() || undefined;
}

function num(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export class SuperbidAdapter {
  slug = 'superbid-judicial';

  private url(pageNumber: number): string {
    const q = new URLSearchParams({
      filter: FILTRO,
      locale: 'pt_BR',
      orderBy: 'score:desc',
      pageNumber: String(pageNumber),
      pageSize: String(PAGE_SIZE),
      portalId: '[2,15]',
      requestOrigin: 'marketplace',
      searchType: 'opened',
      timeZoneId: 'America/Sao_Paulo',
    });
    return `${API}?${q.toString()}`;
  }

  mapOffer(o: Record<string, any>): SuperbidRawLot | null {
    const offerId = o?.id;
    const a = o?.auction ?? {};
    if (!offerId || !a.id) return null;

    const p = o?.product ?? {};
    const cc = o?.commercialCondition ?? {};

    // galleryJson traz o link já absoluto; thumbnailUrl é o fallback
    const galeria: string[] = Array.isArray(p.galleryJson)
      ? p.galleryJson.map((g: any) => g?.link).filter((s: any) => typeof s === 'string')
      : [];
    if (!galeria.length && typeof p.thumbnailUrl === 'string') galeria.push(p.thumbnailUrl);

    const parcelas = Number(cc.maxInstallments) || 0;
    const entradaPct = Number(cc.minAdvanceRate) || 0;

    return {
      offerId,
      auctionId: a.id,
      lotNumber: typeof o.lotNumber === 'number' ? o.lotNumber : undefined,
      shortDesc: String(p.shortDesc ?? '').trim(),
      detalhe: textoPuro(p.detailedDescription),
      subCategoria: p.subCategory?.description ?? undefined,
      cidadeUf: p.location?.city ?? undefined,
      preco: num(o.price),
      temLance: o.hasBids === true,
      totalLances: typeof o.totalBids === 'number' ? o.totalBids : undefined,
      imagens: galeria,
      // o roteador ignora o slug — verificado: /oferta/x-4964721 responde 200
      paginaUrl: `${SITE}/oferta/lote-${offerId}`,
      auction_name: a.desc ? String(a.desc) : undefined,
      auction_date_init: a.beginDate ? String(a.beginDate) : undefined,
      auction_date_end: a.endDate ? String(a.endDate) : undefined,
      tipoLeilao: 'Judicial',
      praca: a.judicialPracaDescription ?? undefined,
      leiloeiro: a.auctioneer ?? undefined,
      parcelamento: parcelas > 0 ? { parcelas, entradaPct } : undefined,
    };
  }

  async fetchAllLots(): Promise<SuperbidRawLot[]> {
    const todos: SuperbidRawLot[] = [];
    const vistos = new Set<number>();
    let total = Infinity;

    for (let page = 1; todos.length < total && page <= 30; page++) {
      if (page > 1) await sleep(DELAY_MS);

      const r = await fetch(this.url(page), { headers: HEADERS });
      if (!r.ok) throw new Error(`offers p${page}: HTTP ${r.status}`);
      const d: any = await r.json();

      if (Number.isFinite(d?.total)) total = d.total;
      const ofertas: any[] = Array.isArray(d?.offers) ? d.offers : [];
      if (!ofertas.length) break;

      let novos = 0;
      for (const o of ofertas) {
        const l = this.mapOffer(o);
        if (!l || vistos.has(l.offerId)) continue;
        vistos.add(l.offerId);
        todos.push(l);
        novos++;
      }
      console.log(`[${this.slug}] página ${page}: +${novos} (total ${todos.length}/${total})`);
      if (novos === 0) break;
    }

    return todos;
  }
}
