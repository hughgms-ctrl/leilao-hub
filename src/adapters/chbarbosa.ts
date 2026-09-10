import { chromium } from 'playwright';
import { desdobrar } from './sfrazao';

/**
 * ADAPTER: CH Barbosa Leilões (chbarbosaleiloes.com.br)
 *
 * Acervo pequeno (~6 veículos) mas judicial, de comarcas do MT e PR.
 *
 * É a ÚNICA fonte do projeto que precisa de navegador, e por um motivo
 * específico: os valores das praças não existem no HTML. A página do
 * lote traz a avaliação, o processo e a vara, mas o preço da 1ª e da 2ª
 * praça é montado no cliente a partir de um template (`${row.PracaAtual}`)
 * e não há endpoint JSON exposto. Sem o lance não há score, e o lote
 * entraria no acervo sem preço.
 *
 * A saída barata: a busca por categoria renderiza TODOS os veículos com
 * os dois valores de uma vez. É UM page load por coleta, não um por
 * lote — o Chromium já está no runner por causa do Sodré.
 *
 * A busca é por hash (`/busca/#Engine=Start&...&ID_Categoria=65`), e a
 * categoria 65 (Veículos) engloba carros, motos, caminhões e ônibus.
 */

export interface ChRawLot {
  loteId: string;
  titulo: string;
  praca1?: number;
  praca2?: number;
  data1?: string;
  data2?: string;
  avaliacao?: number;
  desconto?: number;
  paginaUrl: string;
  imagem?: string;
  /** vocabulário do normalizer */
  auction_name?: string;
  tipoLeilao?: string;
}

const BASE = 'https://www.chbarbosaleiloes.com.br';
const CATEGORIA_VEICULOS = 65;
const TIMEOUT_MS = 45_000;

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/** "R$ 35.000,00" — ponto de milhar e virgula decimal */
const RX_VALOR = String.raw`R\$\s*(\d{1,3}(?:\.\d{3})*,\d{2})`;

/** "15/09/2026" + "11:00" -> ISO */
function dataBr(data?: string, hora?: string): string | undefined {
  const m = (data ?? '').match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return undefined;
  return `${m[3]}-${m[2]}-${m[1]}T${(hora ?? '00:00').padStart(5, '0')}:00`;
}

function precoBR(txt?: string): number | undefined {
  if (!txt) return undefined;
  const n = parseFloat(txt.replace(/[^\d,]/g, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export class ChBarbosaAdapter {
  slug = 'ch-barbosa';

  /**
   * Parse do card já renderizado. Exportado para teste sem navegador.
   *
   * O texto do card vem assim, tudo corrido:
   *
   *   "0%de desconto Veículos 0 Habilitações 1342 Visitas 0 Propostas
   *    0 Lances MOTOCICLETA YAMAHA/YBR 125E - 2006/2006 MOTOCICLETA
   *    YAMAHA/YBR 125E 1ª Praça Abertura 01/08/2026 - 08:00 Fechamento
   *    15/09/2026 - 11:00 R$ 2.000,00 2ª Praça ... R$ 1.000,00
   *    (50% de desconto) ... Avaliação: R$ 2.000,00 ..."
   *
   * Cada campo sai por RÓTULO, nunca por posição: o primeiro "R$" do
   * texto é o da 1ª praça, mas o primeiro "% de desconto" é um badge de
   * cabeçalho que vale 0 e não tem relação com o deságio real.
   */
  parseCard(b: { href: string; texto: string; img: string }): ChRawLot {
    const id = (b.href.match(/\/lote\/[^/]+\/(\d+)/) ?? [])[1] ?? '';
    const t = b.texto;

    // o nome sai repetido (link + cabeçalho), como no S. Frazão
    const bruto = t.match(/\d+\s*Lances?\s+(.+?)\s*1[ªa]\s*Pra[çc]a/i)?.[1]?.trim();

    const praca = (n: 1 | 2) =>
      t.match(
        new RegExp(`${n}[ªa]\\s*Pra[çc]a.*?Fechamento\\s*([\\d/]+)\\s*-\\s*([\\d:]+)\\s*${RX_VALOR}`, 'i'),
      );
    const p1 = praca(1);
    const p2 = praca(2);

    return {
      loteId: id,
      titulo: bruto ? desdobrar(bruto) : t.slice(0, 90).trim(),
      praca1: precoBR(p1?.[3]),
      praca2: precoBR(p2?.[3]),
      data1: dataBr(p1?.[1], p1?.[2]),
      data2: dataBr(p2?.[1], p2?.[2]),
      avaliacao: precoBR(t.match(new RegExp(`Avalia[çc][ãa]o:\\s*${RX_VALOR}`, 'i'))?.[1]),
      // o deságio que interessa é o da 2ª praça, não o badge do topo
      desconto:
        Number(t.match(/2[ªa]\s*Pra[çc]a[\s\S]{0,180}?\((\d{1,3})\s*%\s*de\s*desconto\)/i)?.[1]) ||
        undefined,
      paginaUrl: b.href.startsWith('http') ? b.href : `${BASE}${b.href}`,
      imagem: b.img && !/sem-foto|placeholder/i.test(b.img) ? b.img : undefined,
    };
  }

  async fetchAllLots(): Promise<ChRawLot[]> {
    const browser = await chromium.launch({ headless: true });
    try {
      const ctx = await browser.newContext({
        userAgent: USER_AGENT,
        locale: 'pt-BR',
        viewport: { width: 1440, height: 900 },
      });
      const page = await ctx.newPage();

      const url =
        `${BASE}/busca/#Engine=Start&Scopo=1&Pagina=1&OrientacaoBusca=1` +
        `&Busca=&Mapa=&ID_Categoria=${CATEGORIA_VEICULOS}`;
      await page.goto(url, { waitUntil: 'networkidle', timeout: TIMEOUT_MS });

      // a listagem entra depois do networkidle; esperamos o card aparecer
      await page
        .waitForSelector('a[href*="/lote/"]', { timeout: 15_000 })
        .catch(() => undefined);

      // O evaluate devolve só TEXTO CRU e o parse acontece no Node.
      //
      // Não é só estilo: o tsx compila com esbuild, que injeta um helper
      // `__name` em funções nomeadas. Esse helper não existe no contexto
      // da página, e qualquer função declarada aqui dentro estoura
      // "ReferenceError: __name is not defined". Sem lógica aqui, não há
      // função para o esbuild instrumentar.
      const brutos = await page.evaluate(() => {
        const vistos: string[] = [];
        const out: { href: string; texto: string; img: string }[] = [];

        for (const a of Array.from(document.querySelectorAll('a[href*="/lote/"]'))) {
          const href = (a as HTMLAnchorElement).getAttribute('href') ?? '';
          const id = (href.match(/\/lote\/[^/]+\/(\d+)/) ?? [])[1];
          if (!id || vistos.includes(id)) continue;
          vistos.push(id);

          // sobe até o ancestral que carrega os valores das praças
          let card: Element = a;
          for (let i = 0; i < 5 && card.parentElement; i++) {
            if (/Pra[çc]a/i.test(card.textContent ?? '')) break;
            card = card.parentElement;
          }

          out.push({
            href,
            texto: (card.textContent ?? '').replace(/\s+/g, ' ').trim(),
            img: (card.querySelector('img') as HTMLImageElement | null)?.src ?? '',
          });
        }
        return out;
      });

      const lotes = brutos.map((b) => this.parseCard(b));
      console.log(`[${this.slug}] ${lotes.length} veículos na categoria`);
      return lotes;
    } finally {
      await browser.close();
    }
  }
}
