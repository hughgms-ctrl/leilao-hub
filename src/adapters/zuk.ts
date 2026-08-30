import * as cheerio from 'cheerio';

/**
 * ADAPTER: Portal Zuk / Zukerman (portalzuk.com.br)
 *
 * Quarta fonte, também de acervo judicial (os lotes vêm de Tribunal de
 * Justiça). Volume pequeno — ~56 veículos — mas no nicho de carro
 * judicial parcelável o valor está em cobrir tudo, não em ter muito.
 *
 * HTML server-rendered. A listagem entrega 30 cards e o resto vem por
 * um POST que o botão "Carregar mais" dispara:
 *
 *   POST /leilao-de-imoveis/mais
 *   limit=30&count_imovel_zuk=<offset>&path=<url da listagem>
 *   &order=data_leilao&div_parceiro_count=0&_token=<CSRF>
 *
 * O caminho diz "imoveis" mesmo para veículos — é o endpoint genérico
 * deles. O `_token` é CSRF e precisa ser lido da página a cada execução.
 *
 * A descrição do CARD vem truncada com "..." em 36 dos 56 lotes, e em
 * formatos variados ("Carro, VW/Fusca 1300, ... 1980/1980" convive com
 * "LOTE 03: VEÍCULO VOLKSWAGEN 25-370 E CONSTEL..."). Sem ano não há
 * match FIPE e sem FIPE não há score, então a coleta busca a página de
 * detalhe de cada lote — server-rendered, sem browser. Efeito medido:
 * truncados 36 → 1, ano 24 → 46/56, marca+modelo+ano 21 → 43/56.
 *
 * Todo lote traz número de processo judicial (56/56), o que confirma que
 * o acervo é 100% de Tribunal de Justiça.
 */

const BASE_URL = 'https://www.portalzuk.com.br';
const LISTAGEM = `${BASE_URL}/leilao-de-veiculos`;
const PAGE_SIZE = 30;
const DELAY_MS = 2000;
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const HEADERS: Record<string, string> = {
  'User-Agent': USER_AGENT,
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface ZukRawLot {
  leilaoId: string;
  loteId: string;
  descricao: string;   // "Carro, VW/Fusca 1300, cor branca, 1980/1980, placas BUT-9876."
  endereco: string;    // "Cachoeira Paulista / SP - Centro"
  comitente: string;   // extraído do title: "Tribunal de Justiça do Estado de SP"
  praca1Label: string;
  praca1Valor: string;
  praca1Data: string;
  praca2Label: string;
  praca2Valor: string;
  praca2Data: string;
  imagem: string;
  paginaUrl: string;
  /** nº do processo judicial, só vem na página de detalhe */
  processo?: string;
}

export class ZukAdapter {
  slug = 'portal-zuk';

  /** Extrai os cards de um pedaço de HTML (página ou fragmento do POST). */
  parseCards(html: string): ZukRawLot[] {
    const $ = cheerio.load(html);
    const out: ZukRawLot[] = [];

    $('.card-property').each((_, el) => {
      const c = $(el);
      // SVG inline traz <style> com CSS que polui a extração de texto
      c.find('svg, style, script').remove();
      const a = c.find('a[href*="/veiculo/"]').first();
      const href = (a.attr('href') ?? '').split('?')[0];
      const m = href.match(/\/veiculo\/(\d+)-(\d+)/);
      if (!m) return;

      // title = "Veículos - VW em leilão - <endereço> - <comitente> | <cod>"
      const title = a.attr('title') ?? '';
      const comitente = title.split(' - ').slice(-1)[0]?.split('|')[0]?.trim() ?? '';

      // O fragmento devolvido pelo POST tem estrutura DIFERENTE da página
      // inicial (blocos de praça em outra ordem, endereço ausente). Por isso
      // nada aqui depende de índice: praça é lida pelo RÓTULO, e a descrição
      // é o maior <span> sem classe que não seja o endereço.
      const spans = c
        .find('span')
        .filter((_i, s2) => !$(s2).attr('class'))
        .map((_i, s2) => $(s2).text().replace(/\s+/g, ' ').trim())
        .get()
        .filter((t) => t.length > 10);

      const ehEndereco = (t: string) => /\s\/\s*[A-Z]{2}/.test(t);
      const endereco = spans.find(ehEndereco) ?? '';
      const descricao =
        spans.filter((t) => t !== endereco).sort((a, b) => b.length - a.length)[0] ?? '';

      // cada bloco de praça traz label + value + data; o label diz qual é
      const pracas: { label: string; valor: string; data: string }[] = [];
      c.find('.card-property-price').each((_i, bloco) => {
        const b = $(bloco);
        const label = b.find('.card-property-price-label').first().text().replace(/\s+/g, ' ').trim();
        if (!label) return;
        pracas.push({
          label,
          valor: b.find('.card-property-price-value').first().text().replace(/\s+/g, ' ').trim(),
          data: b.find('.card-property-price-data').first().text().replace(/\s+/g, ' ').trim(),
        });
      });
      const acha = (n: number) => pracas.find((x) => x.label.startsWith(String(n)));
      const p1 = acha(1) ?? pracas[0];
      const p2 = acha(2) ?? (pracas.length > 1 ? pracas[1] : undefined);

      const img = c.find('img').first().attr('src') ?? '';

      out.push({
        leilaoId: m[1],
        loteId: m[2],
        descricao,
        endereco,
        comitente,
        praca1Label: p1?.label ?? '',
        praca1Valor: p1?.valor ?? '',
        praca1Data: p1?.data ?? '',
        praca2Label: p2?.label ?? '',
        praca2Valor: p2?.valor ?? '',
        praca2Data: p2?.data ?? '',
        imagem: /ImgNaoDisp/i.test(img) ? '' : img,
        paginaUrl: href,
      });
    });
    return out;
  }

  /**
   * Detalhe do lote. A descrição do CARD vem truncada com "..." (36 dos 56
   * lotes), e sem ano não há match FIPE — então sem isto a maior parte do
   * acervo entra sem servir para o ranking.
   *
   * A página é server-rendered: o texto completo está em
   * <p class="property-hide-show">, e o <span id="descricao-detalhes">
   * aninhado guarda o excedente que o "ver mais" revelaria. Não precisa
   * de browser.
   */
  parseDetalhe(html: string): { descricao: string; processo?: string } {
    const $ = cheerio.load(html);
    $('script, style, svg').remove();

    const p = $('.property-info-text .property-hide-show').first();
    const descricao = p.text().replace(/\s+/g, ' ').trim();

    // "Processo: 1127919-19.2018.8.26.0100 Acessar processo"
    const itens = $('.property-description-items').first().text();
    const processo = itens.match(/\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/)?.[0];

    return { descricao, processo };
  }

  /** Enriquece cada lote com a descrição completa. Sequencial, com DELAY_MS. */
  async fetchDetalhes(lotes: ZukRawLot[]): Promise<ZukRawLot[]> {
    let ok = 0;
    for (const l of lotes) {
      await sleep(DELAY_MS);
      try {
        const r = await fetch(l.paginaUrl, { headers: HEADERS });
        if (!r.ok) continue;
        const d = this.parseDetalhe(await r.text());
        // só troca se o detalhe trouxer MAIS texto — nunca regride
        if (d.descricao && d.descricao.length > l.descricao.replace(/\.\.\.$/, '').length) {
          l.descricao = d.descricao;
          ok++;
        }
        if (d.processo) l.processo = d.processo;
      } catch {
        // um detalhe que falha não derruba a coleta
      }
    }
    console.log(`[${this.slug}] detalhe: ${ok}/${lotes.length} descrições completadas`);
    return lotes;
  }

  async fetchAllLots(comDetalhe = true): Promise<ZukRawLot[]> {
    const res = await fetch(LISTAGEM, { headers: HEADERS });
    if (!res.ok) throw new Error(`listagem: HTTP ${res.status}`);
    const html = await res.text();

    const $ = cheerio.load(html);
    const token = $('input[name="_token"]').first().attr('value') ?? '';
    if (!token) throw new Error('CSRF _token não encontrado na listagem — layout mudou');

    const cookies = (res.headers.getSetCookie?.() ?? [])
      .map((c) => c.split(';')[0])
      .join('; ');

    const todos = this.parseCards(html);
    const vistos = new Set(todos.map((l) => `${l.leilaoId}-${l.loteId}`));
    console.log(`[${this.slug}] listagem inicial: ${todos.length} lotes`);

    // "Carregar mais": o offset é quantos já foram entregues
    for (let i = 0; i < 20; i++) {
      await sleep(DELAY_MS);
      const corpo = new URLSearchParams({
        limit: String(PAGE_SIZE),
        count_imovel_zuk: String(todos.length),
        path: LISTAGEM,
        order: 'data_leilao',
        div_parceiro_count: '0',
        _token: token,
      });
      const r = await fetch(`${BASE_URL}/leilao-de-imoveis/mais`, {
        method: 'POST',
        headers: {
          ...HEADERS,
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest',
          Referer: LISTAGEM,
          ...(cookies ? { Cookie: cookies } : {}),
        },
        body: corpo,
      });
      if (!r.ok) throw new Error(`/mais: HTTP ${r.status}`);

      const novos = this.parseCards(await r.text()).filter(
        (l) => !vistos.has(`${l.leilaoId}-${l.loteId}`),
      );
      if (novos.length === 0) break;
      for (const l of novos) {
        vistos.add(`${l.leilaoId}-${l.loteId}`);
        todos.push(l);
      }
      console.log(`[${this.slug}] +${novos.length} lotes (total ${todos.length})`);
    }

    return comDetalhe ? this.fetchDetalhes(todos) : todos;
  }
}
