import * as cheerio from 'cheerio';

/**
 * ADAPTER: S. Frazão (sfrazao.com.br)
 *
 * Sétima fonte. Descoberta pelo host das imagens no BuscaAii — ver
 * docs/concorrencia-buscaaii.md.
 *
 * ATENÇÃO, não confundir com `frazaoleiloes.com.br`: são leiloeiros
 * diferentes. Aquele tem 278 lotes e ZERO veículos (é imobiliário).
 *
 * Site PHP simples, HTML renderizado no servidor:
 *   index.php                      -> lista TODOS os idLeilao já feitos
 *   leilao.php?idLeilao=N          -> cabeçalho do leilão + cards de lote
 *   lote.php?idLote=M              -> detalhe (não usado: o card já basta)
 *
 * DUAS ARMADILHAS, ambas capazes de sujar o acervo em silêncio:
 *
 * 1. A home lista leilão ENCERRADO junto com o ativo — o leilão 5 fechou
 *    em agosto de 2022 e continua linkado. Importar os 171 traria anos de
 *    leilão morto. Por isso só entra quem tem praça com encerramento no
 *    futuro.
 *
 * 2. Os leilões são "unificados": imóvel, veículo e diversos no mesmo
 *    pregão. Num leilão de 20 lotes, 6 eram veículo e o resto casa,
 *    terreno e balcão expositor. A separação é por marca conhecida — sem
 *    isso, "CASA C/ 446M²" viraria um carro sem marca no ranking.
 *
 * Em troca, o card do lote é o mais completo que já vi: avaliação, lance
 * mínimo, 2ª praça COM o deságio já calculado, e incremento mínimo.
 */

export interface SfrazaoRawLot {
  leilaoId: string;
  loteId: string;
  numeroLote?: string;
  descricao: string;
  avaliacao?: number;
  lanceMinimo?: number;
  segundaPraca?: number;
  desagioPct?: number;
  maiorLance?: number;
  imagem?: string;
  paginaUrl: string;
  /** vocabulário que o normalizer já entende */
  auction_name?: string;
  auction_date_end?: string;
  tipoLeilao?: string;
}

const BASE = 'https://www.sfrazao.com.br';
const DELAY_MS = 2000;

const HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'pt-BR,pt;q=0.9',
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Marcas usadas para separar veículo do resto do leilão unificado.
 * Whitelist de propósito: errar para menos (perder um veículo de marca
 * exótica) é melhor que errar para mais (pôr um imóvel no ranking de
 * carro e tentar casar com a FIPE).
 */
const MARCAS = [
  'agrale', 'audi', 'bmw', 'byd', 'caoa', 'chery', 'chevrolet', 'chrysler',
  'citroen', 'citroën', 'daf', 'dodge', 'ducati', 'effa', 'fiat', 'ford',
  'foton', 'gm', 'gmc', 'harley', 'honda', 'hyundai', 'iveco', 'jac', 'jaguar',
  'jeep', 'jta', 'kawasaki', 'kia', 'land rover', 'lexus', 'mahindra', 'man',
  'marcopolo', 'mercedes', 'mitsubishi', 'mmc', 'nissan', 'peugeot', 'porsche',
  'ram', 'renault', 'scania', 'seat', 'shineray', 'ssangyong', 'subaru',
  'suzuki', 'toyota', 'troller', 'volare', 'volkswagen', 'volvo', 'vw',
  'yamaha', 'sundown', 'traxx', 'dafra', 'haojue', 'kasinski', 'bajaj',
];

const RX_MARCA = new RegExp(`\\b(${MARCAS.join('|')})\\b`, 'i');

/** Palavras que denunciam que NÃO é veículo, mesmo citando marca. */
const RX_NAO_VEICULO =
  /\b(casa|terreno|ch[áa]cara|apartamento|apto|galp[ãa]o|s[íi]tio|fazenda|im[óo]vel|sala comercial|lote de terreno|gleba)\b/i;

export function pareceVeiculo(desc: string): boolean {
  const d = desc || '';
  if (RX_NAO_VEICULO.test(d)) return false;
  return RX_MARCA.test(d);
}

/** "ABC ABC" -> "ABC". Só desdobra quando as duas metades são idênticas. */
export function desdobrar(s: string): string {
  const t = s.trim();
  if (t.length % 2 === 1) {
    const meio = (t.length - 1) / 2;
    if (t.slice(0, meio) === t.slice(meio + 1) && /\s/.test(t[meio])) return t.slice(0, meio);
  }
  return t;
}

/** "R$130.000,00" -> 130000 */
function precoBR(txt?: string): number | undefined {
  if (!txt) return undefined;
  const n = parseFloat(txt.replace(/[^\d,]/g, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

const MESES: Record<string, string> = {
  jan: '01', fev: '02', mar: '03', abr: '04', mai: '05', jun: '06',
  jul: '07', ago: '08', set: '09', out: '10', nov: '11', dez: '12',
};

/** "15/Set/2026, 10h00" -> ISO */
export function dataBrExtenso(txt?: string): string | null {
  const m = (txt ?? '').match(/(\d{1,2})\/(\w{3})\w*\/(\d{4})(?:,?\s*(\d{1,2})h(\d{2}))?/i);
  if (!m) return null;
  const mes = MESES[m[2].toLowerCase().slice(0, 3)];
  if (!mes) return null;
  const hh = m[4] ?? '00';
  const mm = m[5] ?? '00';
  return `${m[3]}-${mes}-${m[1].padStart(2, '0')}T${hh.padStart(2, '0')}:${mm}:00`;
}

export class SfrazaoAdapter {
  slug = 'sfrazao';

  /** ids de leilão citados na home (inclui encerrados) */
  parseIdsLeilao(html: string): string[] {
    return [...new Set([...html.matchAll(/idLeilao=(\d+)/g)].map((m) => m[1]))];
  }

  /**
   * Cabeçalho do leilão. `dataFim` é o MAIOR encerramento entre as praças
   * — é ele que decide se o leilão ainda vale.
   */
  parseLeilao(html: string): {
    titulo?: string;
    tipo?: string;
    dataFim?: string;
  } {
    const $ = cheerio.load(html);
    $('script, style').remove();
    const t = $('body').text().replace(/\s+/g, ' ');

    // A página imprime o nome do leilão DUAS vezes seguidas antes do
    // "(CÓDIGO N)" — provavelmente breadcrumb + cabeçalho. Capturamos o
    // bloco inteiro e desdobramos, senão o título sai repetido no banco.
    const bruto = t.match(/Página inicial\s+(.{10,400}?)\s*\(CÓDIGO \d+\)/)?.[1]?.trim();
    const titulo = bruto ? desdobrar(bruto) : undefined;
    const tipo = t.match(/Tipo:\s*(\w+)/)?.[1];

    const encerramentos = [...t.matchAll(/Encerramento:\s*(\d{1,2}\/\w+\/\d{4}[^E]{0,14})/g)]
      .map((m) => dataBrExtenso(m[1]))
      .filter((d): d is string => Boolean(d))
      .sort();

    return { titulo, tipo, dataFim: encerramentos[encerramentos.length - 1] };
  }

  /** Cards de lote da página do leilão. Só os que parecem veículo. */
  parseLotes(html: string, leilaoId: string, meta: { titulo?: string; tipo?: string; dataFim?: string }): SfrazaoRawLot[] {
    const $ = cheerio.load(html);
    const out: SfrazaoRawLot[] = [];

    $('.lote-borda').each((_, el) => {
      const c = $(el);
      c.find('script, style').remove();
      const texto = c.text().replace(/\s+/g, ' ').trim();

      const href = c.find('a[href*="lote.php?idLote="]').first().attr('href') ?? '';
      const loteId = href.match(/idLote=(\d+)/)?.[1];
      if (!loteId) return;

      // "LOTE 001 Maior Lance 0,00 Usuário - DESCRIÇÃO Avaliação: R$..."
      const descricao =
        texto.match(/Usu[áa]rio\s*-\s*(.+?)\s*Avalia[çc][ãa]o:/)?.[1]?.trim() ??
        texto.match(/LOTE\s*\d+\s*(.+?)\s*Avalia[çc][ãa]o:/)?.[1]?.trim() ??
        '';
      if (!pareceVeiculo(descricao)) return;

      // "2ª Praça: R$65.000,00(50,00%)" — o site já entrega o deságio
      const p2 = texto.match(/2ª Pra[çc]a:\s*(R\$[\d.,]+)\s*\(([\d.,]+)%\)/);

      out.push({
        leilaoId,
        loteId,
        numeroLote: texto.match(/LOTE\s*(\d+)/i)?.[1],
        descricao,
        avaliacao: precoBR(texto.match(/Avalia[çc][ãa]o:\s*(R\$[\d.,]+)/)?.[1]),
        lanceMinimo: precoBR(texto.match(/Lance m[íi]nimo:\s*(R\$[\d.,]+)/)?.[1]),
        segundaPraca: precoBR(p2?.[1]),
        desagioPct: p2?.[2] ? parseFloat(p2[2].replace(',', '.')) : undefined,
        maiorLance: precoBR(texto.match(/Maior Lance\s*(R?\$?[\d.,]+)/)?.[1]),
        imagem: c.find('img').first().attr('src') || undefined,
        paginaUrl: `${BASE}/lote.php?idLote=${loteId}`,
        auction_name: meta.titulo,
        auction_date_end: meta.dataFim,
        tipoLeilao: meta.tipo,
      });
    });

    return out;
  }

  async fetchAllLots(): Promise<SfrazaoRawLot[]> {
    const home = await fetch(`${BASE}/`, { headers: HEADERS });
    if (!home.ok) throw new Error(`home: HTTP ${home.status}`);
    const ids = this.parseIdsLeilao(await home.text());
    console.log(`[${this.slug}] ${ids.length} leilões citados na home (inclui encerrados)`);

    const agora = new Date().toISOString();
    const todos: SfrazaoRawLot[] = [];
    let ativos = 0;
    let vencidos = 0;

    for (const id of ids) {
      await sleep(DELAY_MS);
      try {
        const r = await fetch(`${BASE}/leilao.php?idLeilao=${id}`, { headers: HEADERS });
        if (!r.ok) continue;
        const html = await r.text();

        const meta = this.parseLeilao(html);
        // sem data não dá para afirmar que está ativo — fica de fora
        if (!meta.dataFim || meta.dataFim < agora) {
          vencidos++;
          continue;
        }
        ativos++;
        todos.push(...this.parseLotes(html, id, meta));
      } catch {
        // um leilão que falha não derruba a coleta
      }
    }

    console.log(
      `[${this.slug}] ${ativos} leilões ativos, ${vencidos} encerrados ignorados — ${todos.length} veículos`,
    );
    return todos;
  }
}
