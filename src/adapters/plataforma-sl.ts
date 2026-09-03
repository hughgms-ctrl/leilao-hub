import * as cheerio from 'cheerio';

/**
 * ADAPTER: plataforma "SL" — um software de leilão white-label usado por
 * vários leiloeiros regionais.
 *
 * Descoberto por impressão digital: cinco sites do mapa do BuscaAii
 * compartilham as MESMAS classes CSS não-padrão (`card-vertical`,
 * `bem-detalhes`, `badges-left`, `card-actions-horizontal`) e a MESMA
 * rota `/leilao/lotes/veiculos`. O sexto site do grupo, suporteleiloes,
 * responde 404 nessa rota porque é a fabricante do software, não um
 * leiloeiro — está de fora.
 *
 * Um adapter serve os cinco. É o motivo de valer a pena: cada site tem
 * poucos lotes (4 a 12), mas todos são judiciais e a maioria vem com a
 * marcação PARCELADO.
 *
 * O card da listagem NÃO traz ano — sem ele não há FIPE nem score. O ano
 * está na página do lote, em "DESCRIÇÃO: ... ano/mod. 2013/2014 ...",
 * junto com a cor. E as OBSERVAÇÕES trazem o art. 895 por extenso:
 *
 *   "25% do valor do lance á vista, e o restante em até 30 meses ...
 *    conforme Art. 895 §7º do NCPC"
 *
 * que é exatamente o que detectarParcelamento já sabe ler. Por isso a
 * coleta sempre busca o detalhe: são ~30 lotes no total, custa 1 minuto.
 */

export interface SlRawLot {
  site: string;          // slug do leiloeiro dono do lote
  leilaoSlug: string;    // identifica o leilão dentro do site
  loteId: string;
  numeroLote?: string;
  descricao: string;
  parcelado: boolean;    // badge "PARCELADO" na listagem
  leilaoNome?: string;
  dataTexto?: string;    // "TER. 22/09/2026 10:00"
  lanceInicial?: number;
  imagem?: string;
  paginaUrl: string;
  /** vocabulário que o normalizer já entende */
  auction_name?: string;
  auction_date_end?: string;
  tipoLeilao?: string;
  condicoes?: string;    // OBSERVAÇÕES: é onde vem o art. 895
}

/** Leiloeiros que rodam esta plataforma. */
export const SITES: { slug: string; host: string; nome: string }[] = [
  { slug: 'clademir-leiloes', host: 'www.clademirleiloeiro.com.br', nome: 'Clademir Leilões' },
  { slug: 'valerio-iamin', host: 'www.valerioiaminleiloes.com.br', nome: 'Valério Iamin Leilões' },
  { slug: 'leomar-kirinus', host: 'www.leomarkirinusleiloes.com.br', nome: 'Leomar Kirinus Leilões' },
  { slug: 'regional-leiloes', host: 'www.regionalleiloes.com.br', nome: 'Regional Leilões' },
  { slug: 'tonial-leiloes', host: 'www.tonialleiloes.com.br', nome: 'Tonial Leilões' },
];

const ROTA_VEICULOS = '/leilao/lotes/veiculos';
const DELAY_MS = 2000;

const HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'pt-BR,pt;q=0.9',
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function precoBR(txt?: string): number | undefined {
  if (!txt) return undefined;
  const n = parseFloat(txt.replace(/[^\d,]/g, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** "TER. 22/09/2026 10:00" -> ISO */
export function dataDoCard(txt?: string): string | undefined {
  const m = (txt ?? '').match(/(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (!m) return undefined;
  const hh = (m[4] ?? '00').padStart(2, '0');
  return `${m[3]}-${m[2]}-${m[1]}T${hh}:${m[5] ?? '00'}:00`;
}

export class PlataformaSlAdapter {
  slug = 'plataforma-sl';

  parseCards(html: string, site: { slug: string; host: string }): SlRawLot[] {
    const $ = cheerio.load(html);
    const out: SlRawLot[] = [];

    $('.card-vertical').each((_, el) => {
      const c = $(el);
      c.find('script, style, svg').remove();

      const href = (c.find('a[href*="/lote_id/"]').first().attr('href') ?? '').split('?')[0];
      const m = href.match(/\/leilao\/([^/]+)\/lote_id\/(\d+)/);
      if (!m) return;

      const texto = (sel: string) => c.find(sel).first().text().replace(/\s+/g, ' ').trim();

      // A descrição é o nó de texto sem classe entre o badge e o título do
      // leilão. Pegar por posição quebraria quando falta um badge, então
      // filtramos por conteúdo.
      const candidatos = c
        .find('*')
        .map((_i, e) => $(e).clone().children().remove().end().text().replace(/\s+/g, ' ').trim())
        .get()
        .filter((t) => t.length > 4);

      const leilaoNome = texto('.info-title');
      const dataTexto = texto('.meta-item');
      const numeroLote = texto('.badge-primary');

      const descricao =
        candidatos.find(
          (t) =>
            t !== leilaoNome &&
            t !== dataTexto &&
            t !== numeroLote &&
            !/^R\$/.test(t) &&
            !/^(favorite_border|Detalhes|Lance Inicial:?|PARCELADO|NO DEPÓSITO)$/i.test(t) &&
            !/^LOTE\s*\d+$/i.test(t),
        ) ?? '';

      out.push({
        site: site.slug,
        leilaoSlug: m[1],
        loteId: m[2],
        numeroLote: numeroLote.replace(/^LOTE\s*/i, '') || undefined,
        descricao,
        parcelado: /PARCELADO/i.test(c.text()),
        leilaoNome: leilaoNome || undefined,
        dataTexto: dataTexto || undefined,
        lanceInicial: precoBR(texto('.bid-value')),
        imagem: (() => {
          const src = c.find('img').first().attr('src') ?? '';
          return src && !/nopicture/i.test(src)
            ? (src.startsWith('http') ? src : `https://${site.host}${src}`)
            : undefined;
        })(),
        paginaUrl: `https://${site.host}${href}`,
        auction_name: leilaoNome || undefined,
        auction_date_end: dataDoCard(dataTexto),
        tipoLeilao: /judicial/i.test(leilaoNome) ? 'Judicial' : undefined,
      });
    });

    return out;
  }

  /**
   * Detalhe do lote: ano e cor (bloco DESCRIÇÃO) e o texto do art. 895
   * (bloco OBSERVAÇÕES). Recorte por rótulo, porque os blocos são
   * acordeões sem classe própria.
   */
  parseDetalhe(html: string): { descricao?: string; condicoes?: string } {
    const $ = cheerio.load(html);
    $('script, style, svg').remove();
    const t = $('body').text().replace(/\s+/g, ' ');

    const corta = (de: RegExp, ate: RegExp): string | undefined => {
      const i = t.search(de);
      if (i < 0) return undefined;
      const resto = t.slice(i).replace(de, '');
      const j = resto.search(ate);
      const trecho = (j < 0 ? resto : resto.slice(0, j)).replace(/keyboard_arrow_down/g, '').trim();
      return trecho.length > 3 ? trecho.slice(0, 4000) : undefined;
    };

    // O acordeão é obrigatório no recorte: a página também tem o aviso
    // legal "DESCRIÇÃO DOS BENS — cópia fiel das informações fornecidas
    // pelos cartórios...", que vem ANTES e casaria primeiro, trazendo o
    // texto errado para dentro da descrição do veículo.
    return {
      descricao: corta(
        /DESCRI[ÇC][ÃA]O\s+keyboard_arrow_down\s*/,
        /OBSERVA[ÇC][ÕO]ES|[ÚU]LTIMOS LANCES|EDITAL/,
      ),
      condicoes: corta(
        /OBSERVA[ÇC][ÕO]ES\s+keyboard_arrow_down\s*/,
        /[ÚU]LTIMOS LANCES|EDITAL E DOCUMENTOS/,
      ),
    };
  }

  async fetchSite(site: { slug: string; host: string; nome: string }): Promise<SlRawLot[]> {
    const r = await fetch(`https://${site.host}${ROTA_VEICULOS}`, { headers: HEADERS });
    if (!r.ok) throw new Error(`${site.slug}: HTTP ${r.status}`);
    const lotes = this.parseCards(await r.text(), site);

    // Detalhe SEMPRE: o card não traz ano, e sem ano não há FIPE.
    let comAno = 0;
    for (const l of lotes) {
      await sleep(DELAY_MS);
      try {
        const d = await fetch(l.paginaUrl, { headers: HEADERS });
        if (!d.ok) continue;
        const det = this.parseDetalhe(await d.text());
        if (det.descricao) {
          // o detalhe COMPLEMENTA o nome do card ("FIAT/SIENA EL 1.4 FLEX"
          // + "placa ..., ano/mod. 2013/2014"), não o substitui
          l.descricao = `${l.descricao}, ${det.descricao}`.replace(/^,\s*/, '');
          if (/\b(19|20)\d{2}\b/.test(det.descricao)) comAno++;
        }
        if (det.condicoes) l.condicoes = det.condicoes;
      } catch {
        // um detalhe que falha não derruba o resto
      }
    }

    console.log(`[${this.slug}] ${site.slug}: ${lotes.length} lotes (${comAno} com ano no detalhe)`);
    return lotes;
  }

  async fetchAllLots(): Promise<SlRawLot[]> {
    const todos: SlRawLot[] = [];
    for (const site of SITES) {
      try {
        todos.push(...(await this.fetchSite(site)));
      } catch (e) {
        console.error(`[${this.slug}] ${site.slug} FALHOU:`, (e as Error).message);
      }
      await sleep(DELAY_MS);
    }
    return todos;
  }
}
