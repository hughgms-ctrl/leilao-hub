import * as cheerio from 'cheerio';
import { pareceVeiculo } from './sfrazao';

/**
 * ADAPTER: E-Leilões (e-leiloes.com.br)
 *
 * App Nuxt, mas com a listagem renderizada no SERVIDOR — cheerio basta.
 * O `window.__NUXT__` vem só com config, e a API interna responde 400 em
 * toda rota testada; não vale caçar, o HTML já traz tudo.
 *
 * Três detalhes que custaram tempo e ficam registrados:
 *
 * 1. O card NÃO é uma âncora: é um <div class="lote-item" role="link">
 *    com a navegação em JS. A URL do lote só aparece dentro do link de
 *    compartilhamento do WhatsApp, no próprio card.
 *
 * 2. Paginação é `?page=N` (12 por página, ~40 páginas). `?pagina=N` e
 *    `?p=N` são ACEITOS e devolvem sempre a página 1 — passaria como
 *    coleta completa e truncada. Mesma armadilha do Leilões Judiciais.
 *
 * 3. O acervo é misto (imóvel, veículo, trator, informática) e o card não
 *    diz a categoria. A separação é pela mesma whitelist de marca do
 *    S. Frazão.
 *
 * O título não traz ano, então a coleta busca o detalhe de cada veículo.
 * De lá vêm ano/modelo, cor, combustível, a vara e a data do leilão.
 */

export interface ElRawLot {
  loteId: string;
  ide?: string;
  numeroLote?: string;
  titulo: string;
  cidadeUf?: string;      // "Almeirim - PA"
  conservacao?: string;   // "Conservação Ruim"
  avaliacao?: number;
  valorVenda?: number;
  lanceAtual?: number;
  statusTexto?: string;
  paginaUrl: string;
  imagem?: string;
  /** vindos do detalhe */
  descricao?: string;
  auction_name?: string;
  auction_date_end?: string;
  tipoLeilao?: string;
  condicoes?: string;
}

const BASE = 'https://www.e-leiloes.com.br';
const DELAY_MS = 2000;
const MAX_PAGINAS = 60;

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

/** "23/09/2026, 14:30" -> ISO */
export function dataBr(txt?: string): string | undefined {
  const m = (txt ?? '').match(/(\d{2})\/(\d{2})\/(\d{4})(?:,?\s*(\d{1,2}):(\d{2}))?/);
  if (!m) return undefined;
  return `${m[3]}-${m[2]}-${m[1]}T${(m[4] ?? '00').padStart(2, '0')}:${m[5] ?? '00'}:00`;
}

export class ELeiloesAdapter {
  slug = 'e-leiloes';

  parseCards(html: string): ElRawLot[] {
    const $ = cheerio.load(html);
    const out: ElRawLot[] = [];

    $('.lote-item').each((_, el) => {
      const c = $(el);
      c.find('script, style, svg, path').remove();
      const texto = c.text().replace(/\s+/g, ' ').trim();

      // a URL só existe dentro do compartilhamento
      const wa = c.find('a[href*="whatsapp"]').attr('href') ?? '';
      const url = decodeURIComponent(wa).match(/https?:\/\/[^\s&"']*\/lotes\/(\d+)\/[^\s&"']*/);
      if (!url) return;

      const titulo = c.find('.lote-row__title-link').first().text().replace(/\s+/g, ' ').trim();
      if (!titulo || !pareceVeiculo(titulo)) return;

      out.push({
        loteId: url[1],
        ide: texto.match(/IDE\s*(\d+)/)?.[1],
        numeroLote: texto.match(/Lote\s*(\d+)/i)?.[1],
        titulo,
        cidadeUf: c.find('.lote-row__location').first().text().replace(/\s+/g, ' ').trim() || undefined,
        conservacao: texto.match(/Conserva[çc][ãa]o\s+(\w+)/i)?.[1],
        avaliacao: precoBR(texto.match(/Valor avaliado:\s*R\$\s*(\d{1,3}(?:\.\d{3})*,\d{2})/i)?.[1]),
        valorVenda: precoBR(texto.match(/Leil[ãa]o [ÚU]nico:\s*R\$\s*(\d{1,3}(?:\.\d{3})*,\d{2})/i)?.[1]),
        lanceAtual: precoBR(texto.match(/Lance Atual:\s*R\$\s*(\d{1,3}(?:\.\d{3})*,\d{2})/i)?.[1]),
        statusTexto: c.find('.status-tag__label').first().text().trim() || undefined,
        paginaUrl: url[0],
        imagem: c.find('img').first().attr('src') || undefined,
      });
    });

    return out;
  }

  /**
   * Detalhe: ano/modelo, cor, vara e data. Recorte por rótulo porque os
   * blocos não têm classe própria.
   */
  parseDetalhe(html: string): Partial<ElRawLot> {
    const $ = cheerio.load(html);
    $('script, style, svg').remove();
    const t = $('body').text().replace(/\s+/g, ' ');

    // "1ª Vara Cível de Sertãozinho SP • Leilão Judicial Leilão único
    //  R$ 2.744,49 23/09/2026, 14:30"
    // O texto da página vem SEM espaço entre elementos
    // ("•Leilão JudicialLeilão único"), então o tipo é uma lista fechada:
    // `\w+` parava no "ã" e devolvia "Leilão JudicialLeil".
    const vara = t.match(
      /((?:\d+ª\s*)?Vara[^•]{3,70})•\s*(Leil[ãa]o\s*(?:Judicial|Extrajudicial|[ÚUúu]nico))/i,
    );
    const data = t.match(/Leil[ãa]o [úu]nico[^0-9]{0,20}R\$[\d.,]+\s*(\d{2}\/\d{2}\/\d{4},?\s*\d{1,2}:\d{2})/i)
      ?? t.match(/(\d{2}\/\d{2}\/\d{4},\s*\d{1,2}:\d{2})/);

    // "Veículo GM/Astra GLS, cor azul, ... Ano/Modelo 2000/2000"
    const desc = t.match(/(Ve[íi]culo\s+.{10,300}?Ano\/Modelo\s*\d{4}\/\d{4})/i)?.[1];

    // sem espaco depois do rotulo: "ObservacoesCaracteristicas: ..."
    const obs = t.match(/Observa[çc][õo]es\s*(.{10,1200}?)(?:Documentos|Edital|Compartilhar|$)/i)?.[1];

    return {
      descricao: desc?.trim(),
      auction_name: vara?.[1]?.trim(),
      auction_date_end: dataBr(data?.[1]),
      tipoLeilao: vara?.[2]?.trim(),
      condicoes: obs?.trim().slice(0, 4000),
    };
  }

  async fetchAllLots(comDetalhe = true): Promise<ElRawLot[]> {
    const todos: ElRawLot[] = [];
    const vistos = new Set<string>();

    for (let page = 1; page <= MAX_PAGINAS; page++) {
      if (page > 1) await sleep(DELAY_MS);

      const r = await fetch(`${BASE}/busca?page=${page}`, { headers: HEADERS });
      if (!r.ok) break;
      const html = await r.text();

      const cards = this.parseCards(html);
      // a página existe mas não tem lote nenhum: fim da listagem
      if (!/lote-item/.test(html)) break;

      let novos = 0;
      for (const l of cards) {
        if (vistos.has(l.loteId)) continue;
        vistos.add(l.loteId);
        todos.push(l);
        novos++;
      }
      if (page % 10 === 0) console.log(`[${this.slug}] página ${page}: ${todos.length} veículos até aqui`);
      if (cards.length === 0 && novos === 0 && page > 3) {
        // páginas seguidas sem veículo ainda podem ter imóveis; só paramos
        // quando o HTML deixa de trazer card algum (checado acima)
      }
    }

    console.log(`[${this.slug}] ${todos.length} veículos na listagem`);

    if (comDetalhe) {
      let comAno = 0;
      for (const l of todos) {
        await sleep(DELAY_MS);
        try {
          const d = await fetch(l.paginaUrl, { headers: HEADERS });
          if (!d.ok) continue;
          Object.assign(l, this.parseDetalhe(await d.text()));
          if (l.descricao && /\d{4}\/\d{4}/.test(l.descricao)) comAno++;
        } catch {
          // um detalhe que falha não derruba a coleta
        }
      }
      console.log(`[${this.slug}] detalhe: ${comAno}/${todos.length} com ano/modelo`);
    }

    return todos;
  }
}
