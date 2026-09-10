import * as cheerio from 'cheerio';

/**
 * ADAPTER: Edgar de Carvalho Jr. (edgarcarvalholeiloeiro.com.br)
 *
 * Leiloeiro do Rio, acervo pequeno mas judicial (Justiça Federal do RJ).
 * HTML no servidor, sem paginação: /veiculos lista tudo.
 *
 * Roda na plataforma da Suporte Leilões — as fotos vêm de
 * static.suporteleiloes.com.br. É a MESMA fabricante dos cinco sites do
 * adapter `plataforma-sl`, mas um produto diferente: lá a rota é
 * /leilao/lotes/veiculos com `.card-vertical`; aqui é /veiculos com
 * âncoras /oferta/leilao/. Por isso o adapter é separado, com o host
 * parametrizado para acomodar irmãos se aparecerem.
 *
 * O card da listagem não traz ano — sem ele não há FIPE. O detalhe traz:
 *
 *   "Descrição: Veículo ... FORD ECOSPORT PLACA KXZ5624 RJ, modelo
 *    XLT 1.6 Flex, cor prata, ano 2009/2010, CHASSI ..."
 *   "Comitente: Justiça Federal do Rio de Janeiro/RJ"
 *
 * São poucos lotes, então a coleta sempre busca o detalhe.
 */

export interface EcRawLot {
  site: string;
  leilaoId: string;
  loteId: string;
  titulo: string;
  categoria?: string;      // vem na própria URL: /veiculos/carros/
  lance1?: number;
  lance2?: number;
  data1?: string;
  data2?: string;
  imagem?: string;
  paginaUrl: string;
  /** do detalhe */
  descricao?: string;
  avaliacao?: number;
  comitente?: string;
  /** vocabulário do normalizer */
  auction_name?: string;
  auction_date_end?: string;
  tipoLeilao?: string;
}

export const SITES_EC: { slug: string; host: string; nome: string }[] = [
  {
    slug: 'edgar-carvalho',
    host: 'www.edgarcarvalholeiloeiro.com.br',
    nome: 'Edgar de Carvalho Jr.',
  },
];

const DELAY_MS = 2000;

const HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'pt-BR,pt;q=0.9',
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** "R$ 33.000,00" e também "R$33.000,00" (o detalhe cola o cifrão) */
const RX_VALOR = String.raw`R\$\s*(\d{1,3}(?:\.\d{3})*,\d{2})`;

function precoBR(txt?: string): number | undefined {
  if (!txt) return undefined;
  const n = parseFloat(txt.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** "16/09/2026 às 15:00" -> ISO */
export function dataBr(txt?: string): string | undefined {
  const m = (txt ?? '').match(/(\d{2})\/(\d{2})\/(\d{4})(?:\s*(?:às|as)\s*(\d{1,2}):(\d{2}))?/);
  if (!m) return undefined;
  return `${m[3]}-${m[2]}-${m[1]}T${(m[4] ?? '00').padStart(2, '0')}:${m[5] ?? '00'}:00`;
}

export class EdgarCarvalhoAdapter {
  slug = 'edgar-carvalho';

  parseCards(html: string, site: { slug: string; host: string }): EcRawLot[] {
    const $ = cheerio.load(html);
    $('script, style, svg').remove();
    const out: EcRawLot[] = [];

    $('a[href*="/oferta/leilao/"]').each((_, a) => {
      const href = ($(a).attr('href') ?? '').split('?')[0];
      // /oferta/leilao/veiculos/carros/11918/id-15233/carro-ford-ecosport
      const m = href.match(/\/oferta\/leilao\/([^/]+)\/([^/]+)\/(\d+)\/id-(\d+)/);
      if (!m) return;

      const c = $(a);
      const texto = c.text().replace(/\s+/g, ' ').trim();

      // "TÍTULO 1º Leilão: 16/09/2026 às 15:00 R$ 33.000,00 2º Leilão: ..."
      // ou "TÍTULO Data Única: 18/09/2026 às 10:00 R$ 42.000,00"
      const titulo =
        texto.match(/^(.+?)\s*(?:\d[ºo°]\s*Leil[ãa]o:|Data [ÚU]nica:)/i)?.[1]?.trim() ??
        c.find('h3, h2, h4').first().text().replace(/\s+/g, ' ').trim();

      const p1 = texto.match(
        new RegExp(`(?:1[ºo°]\\s*Leil[ãa]o|Data [ÚU]nica):\\s*([\\d/]+\\s*(?:às|as)\\s*[\\d:]+)\\s*${RX_VALOR}`, 'i'),
      );
      const p2 = texto.match(
        new RegExp(`2[ºo°]\\s*Leil[ãa]o:\\s*([\\d/]+\\s*(?:às|as)\\s*[\\d:]+)\\s*${RX_VALOR}`, 'i'),
      );

      out.push({
        site: site.slug,
        leilaoId: m[3],
        loteId: m[4],
        titulo,
        categoria: m[2],
        data1: p1?.[1],
        lance1: precoBR(p1?.[2]),
        data2: p2?.[1],
        lance2: precoBR(p2?.[2]),
        imagem: (() => {
          const src = c.find('img').first().attr('src') ?? '';
          return src && !/sem-foto/i.test(src)
            ? (src.startsWith('http') ? src : `https://${site.host}${src}`)
            : undefined;
        })(),
        paginaUrl: href.startsWith('http') ? href : `https://${site.host}${href}`,
      });
    });

    return out;
  }

  parseDetalhe(html: string): Partial<EcRawLot> {
    const $ = cheerio.load(html);
    $('script, style, svg').remove();
    const t = $('body').text().replace(/\s+/g, ' ');

    const comitente = t.match(/Comitente:\s*(.{3,70}?)\s*R\$/i)?.[1]?.trim();

    return {
      descricao: t.match(/Descri[çc][ãa]o\s+(.{20,1200}?)(?:Documentos|Edital|Localiza|Compartilh|$)/i)?.[1]?.trim(),
      avaliacao: precoBR(t.match(new RegExp(`${RX_VALOR}\\s*Valor Avalia`, 'i'))?.[1]),
      comitente,
      auction_name: comitente,
      // "Justiça Federal", "Vara", "Comarca" — o comitente é o juízo
      tipoLeilao:
        comitente && /justi[çc]a|vara|comarca|tribunal|ju[íi]zo|federal/i.test(comitente)
          ? 'Judicial'
          : undefined,
    };
  }

  async fetchSite(site: { slug: string; host: string; nome: string }): Promise<EcRawLot[]> {
    const r = await fetch(`https://${site.host}/veiculos`, { headers: HEADERS });
    if (!r.ok) throw new Error(`${site.slug}: HTTP ${r.status}`);
    const lotes = this.parseCards(await r.text(), site);

    let comAno = 0;
    for (const l of lotes) {
      await sleep(DELAY_MS);
      try {
        const d = await fetch(l.paginaUrl, { headers: HEADERS });
        if (!d.ok) continue;
        Object.assign(l, this.parseDetalhe(await d.text()));
        // a data de encerramento útil é a da praça em curso
        l.auction_date_end = dataBr(l.data2) ?? dataBr(l.data1);
        if (l.descricao && /\bano\s*\d{4}/i.test(l.descricao)) comAno++;
      } catch {
        // um detalhe que falha não derruba o resto
      }
    }

    console.log(`[${this.slug}] ${site.slug}: ${lotes.length} lotes (${comAno} com ano no detalhe)`);
    return lotes;
  }

  async fetchAllLots(): Promise<EcRawLot[]> {
    const todos: EcRawLot[] = [];
    for (const site of SITES_EC) {
      try {
        todos.push(...(await this.fetchSite(site)));
      } catch (e) {
        console.error(`[${this.slug}] ${site.slug} FALHOU:`, (e as Error).message);
      }
    }
    return todos;
  }
}
