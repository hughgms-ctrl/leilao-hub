import * as cheerio from 'cheerio';

/**
 * ADAPTER: Nakakogue Leilões (nakakogueleiloes.com.br)
 *
 * Leiloeiro do Paraná, acervo majoritariamente de Vara do Trabalho.
 * HTML renderizado no servidor, sem paginação: os lotes de uma categoria
 * cabem todos numa página.
 *
 * As categorias são numeradas em /lotes/consulta/N:
 *   1 = Imóveis (48)   2 = Veículos (24)   3 = Máquinas (1)
 *   4 = vazia          5 = todas (158)
 *
 * Só a 2 interessa. Usar a 5 (todas) traria imóvel e sucata de disjuntor
 * junto, e a categoria já vem escrita no card — não há por que adivinhar.
 *
 * O card é um <li> com tudo em texto corrido:
 *
 *   "411 - Veiculo REB/LINSHALM SRF2ECL, Especie: Carga, Tipo:
 *    semirreboque, ... Ano/Modelo 1999/19  Categoria: Veículos
 *    Valor Minimo: R$ 45.000,00  Edital: 02ª Vara do Trabalho de Curitiba
 *    Situação: À Venda  Lance Atual R$ 0,00"
 *
 * O "Edital" é o juízo, e é ele que identifica o leilão — o site não
 * expõe um id de leilão separado do número do lote.
 */

export interface NkRawLot {
  leilaoId: string;      // id do leilão na URL
  numeroLote: string;
  descricao: string;
  categoria?: string;
  avaliacao?: number;
  valorMinimo?: number;
  lanceAtual?: number;
  situacao?: string;
  imagem?: string;
  paginaUrl: string;
  /** vocabulário que o normalizer já entende */
  auction_name?: string;
  tipoLeilao?: string;
}

const BASE = 'https://www.nakakogueleiloes.com.br';
const CATEGORIA_VEICULOS = 2;

const HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'pt-BR,pt;q=0.9',
};

function precoBR(txt?: string): number | undefined {
  if (!txt) return undefined;
  const n = parseFloat(txt.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** "R$ 45.000,00" com o cifrão separado do número */
const RX_VALOR = String.raw`R\$\s*(\d{1,3}(?:\.\d{3})*,\d{2})`;

export class NakakogueAdapter {
  slug = 'nakakogue';

  parseCards(html: string): NkRawLot[] {
    const $ = cheerio.load(html);
    const out: NkRawLot[] = [];

    $('a[href*="detalhe-lote/"]').each((_, a) => {
      const href = ($(a).attr('href') ?? '').split('?')[0];
      const m = href.match(/detalhe-lote\/(\d+)\/(\d+)/);
      if (!m) return;

      // o <li> que envolve o link é o card
      const c = $(a).closest('li');
      if (!c.length) return;
      c.find('script, style, svg').remove();

      // cheerio já decodifica &atilde; e companhia
      const texto = c.text().replace(/\s+/g, ' ').trim();

      // "411 - Veiculo REB/... Ano/Modelo 1999/19  Categoria: Veículos"
      const descricao =
        texto.match(/^\d+\s*-\s*(.+?)\s*Categoria:/)?.[1]?.trim() ??
        texto.match(/^\d+\s*-\s*(.{5,200})/)?.[1]?.trim() ??
        '';

      const edital = texto.match(/Edital:\s*(.+?)\s*(?:Situa[çc][ãa]o|Lance Atual|VER LOTE|$)/i)?.[1]?.trim();

      out.push({
        leilaoId: m[1],
        numeroLote: m[2],
        descricao,
        categoria: texto.match(/Categoria:\s*([^V]{2,30}?)\s*(?:Valor|Edital|Situa)/i)?.[1]?.trim(),
        avaliacao: precoBR(texto.match(new RegExp(`Valor Avaliado:\\s*${RX_VALOR}`, 'i'))?.[1]),
        valorMinimo: precoBR(texto.match(new RegExp(`Valor M[ií]nimo:\\s*${RX_VALOR}`, 'i'))?.[1]),
        lanceAtual: precoBR(texto.match(new RegExp(`Lance Atual\\s*${RX_VALOR}`, 'i'))?.[1]),
        situacao: texto.match(/Situa[çc][ãa]o:\s*([^L]{2,20}?)\s*(?:Lance|VER|$)/i)?.[1]?.trim(),
        imagem: (() => {
          const src = c.find('img').first().attr('src') ?? '';
          return src ? (src.startsWith('http') ? src : `${BASE}/${src.replace(/^\//, '')}`) : undefined;
        })(),
        paginaUrl: href.startsWith('http') ? href : `${BASE}/${href.replace(/^\//, '')}`,
        auction_name: edital,
        // "02ª Vara do Trabalho de Curitiba" — juízo é leilão judicial
        // "DIVISAO DE APOIO A EXECUÇÃO" também é juízo — sem "execu" na
        // lista, 4 dos 24 lotes ficavam de fora do filtro judicial.
        tipoLeilao:
          edital && /vara|comarca|ju[íi]zo|tribunal|trabalho|execu[çc]/i.test(edital)
            ? 'Judicial'
            : undefined,
      });
    });

    return out;
  }

  async fetchAllLots(): Promise<NkRawLot[]> {
    const r = await fetch(`${BASE}/lotes/consulta/${CATEGORIA_VEICULOS}`, { headers: HEADERS });
    if (!r.ok) throw new Error(`consulta/${CATEGORIA_VEICULOS}: HTTP ${r.status}`);

    const lotes = this.parseCards(await r.text());
    console.log(`[${this.slug}] ${lotes.length} lotes na categoria Veículos`);
    return lotes;
  }
}
