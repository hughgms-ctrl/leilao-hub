import type { DbLot } from './sodre';

/**
 * Mapper: oferta do Superbid / Canal Judicial -> registro para `lotes`.
 *
 * Acervo 100% judicial, com praça (1ª/2ª/única) e condição de parcelamento
 * vindas ESTRUTURADAS da API — diferente das outras fontes, aqui não se
 * infere nada de texto de edital.
 *
 * O que ainda sai de texto é marca/modelo/ano: `product.brand` e
 * `product.model` vêm vazios na maioria, então tudo é extraído da
 * descrição, que aparece em pelo menos cinco formatos:
 *
 *   "MOTOCICLETA HONDA CG 160 ANO 2019"
 *   "VW/Gol 1000, 93/94, cinza"                    <- ano com 2 dígitos
 *   "JTA/SUZUKI EN125 YES, 09/10"
 *   "Citroen/Xsara Picassoexa, Ano/Modelo: 2006/2006, Final da placa ..."
 *   "SANDERO ANO/MOD 2013/2014, COR BRANCA"
 */

/** Palavras que abrem a descrição e não são marca. */
const PREFIXO_TIPO =
  /^(ve[íi]culo|autom[óo]vel|motocicleta|moto|carro|sucata(\s+de)?|lote\s*\d*[:.-]?|\d+\s*[-–]\s*)\s+/i;

/** "IMP" = importado; não é marca em "IMP/FORD ESCORT 1.8I GL". */
const NAO_MARCA = /^(imp|nac|importado|nacional|i)$/i;

/** Rótulos que aparecem grudados no nome e não são marca nem modelo. */
const ROTULO = /^(ano|anos|mod|modelo|marca|tipo|cor|placa|final|lote|um|uma|de|do|da)$/i;

const RX_COR = /\bcor\s+([a-zA-Zà-ÿ]+)/i;
const RX_COR_SOLTA =
  /,\s*(branc[ao]|pret[ao]|prat[ao]|cinza|vermelh[ao]|azul|verde|amarel[ao]|marrom|bege|dourad[ao])\b/i;

function expandirAno(n: number): number {
  if (n >= 1000) return n;
  // "93" -> 1993, "14" -> 2014. O corte é o ano corrente + 2, que é até
  // onde a FIPE publica modelo novo.
  const limite = (new Date().getFullYear() % 100) + 2;
  return n <= limite ? 2000 + n : 1900 + n;
}

/** Acha o ano num texto qualquer, nos formatos que o Superbid usa. */
function acharAno(t: string): { anoFab?: number; anoModelo?: number } {
  const par4 = t.match(/\b(\d{4})\s*\/\s*(\d{4})\b/);
  if (par4) return { anoFab: Number(par4[1]), anoModelo: Number(par4[2]) };

  // "FABRICADO EM 2019, MODELO 2019"
  const fabMod = t.match(/fabrica\w*\s+em\s+(\d{4})[\s,]+modelo\s+(\d{4})/i);
  if (fabMod) return { anoFab: Number(fabMod[1]), anoModelo: Number(fabMod[2]) };

  const rotulado = t.match(/ano(?:\s*\/?\s*mod(?:elo)?)?\.?\s*:?\s*(\d{4})\b/i);
  if (rotulado) return { anoFab: Number(rotulado[1]), anoModelo: Number(rotulado[1]) };

  const par2 = t.match(/\b(\d{2})\s*\/\s*(\d{2})\b/);
  if (par2) {
    return { anoFab: expandirAno(Number(par2[1])), anoModelo: expandirAno(Number(par2[2])) };
  }

  // ano de 4 dígitos ocupando um campo inteiro ("Ford/Focus SE, 2016,
  // Vermelho"). Exigir o campo inteiro evita pegar "320i" ou "92.112 Kg";
  // a faixa plausível em parseShortDesc é a segunda barreira.
  const solto = t.match(/(?:^|,)\s*(\d{4})\s*(?=,|$)/);
  if (solto) return { anoFab: Number(solto[1]), anoModelo: Number(solto[1]) };

  return {};
}

export function parseShortDesc(
  desc: string,
  detalhe?: string,
): { marca?: string; modelo?: string; anoFab?: number; anoModelo?: number; cor?: string } {
  const t = (desc || '').replace(/\s+/g, ' ').trim();

  // O ano falta em ~39% dos shortDesc, mas a descrição longa vem na MESMA
  // resposta da API e o repõe na maioria desses casos. Sem ano não há FIPE.
  let achado = acharAno(t);
  if (!achado.anoModelo && detalhe) achado = acharAno(detalhe);
  const { anoFab, anoModelo } = achado;

  const plausivel = (n?: number) =>
    n && n >= 1950 && n <= new Date().getFullYear() + 2 ? n : undefined;

  // --- marca / modelo ---
  // corta na primeira vírgula: depois dela vem cor, placa, ano solto...
  let cabeca = t.split(',')[0].replace(PREFIXO_TIPO, '').trim();

  // tira ano e rótulos de dentro do nome. Sem isto "SANDERO ANO/MOD
  // 2013/2014" virava marca "ano" e modelo "mod", e "HONDA modelo CG 150"
  // carregava a palavra "modelo" para dentro do modelo.
  cabeca = cabeca
    .replace(/\b\d{4}\s*\/\s*\d{4}\b/g, ' ')
    .replace(/\bano(?:\s*\/?\s*mod(?:elo)?)?\.?\s*:?\s*\d{2,4}\b/gi, ' ')
    .replace(/\bano\s*\/?\s*mod(?:elo)?\b/gi, ' ')
    .replace(/\b(marca|modelo)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  let marca: string | undefined;
  let modelo: string | undefined;

  const barra = cabeca.indexOf('/');
  if (barra > 0) {
    const esq = cabeca.slice(0, barra).trim().split(/\s+/).filter(Boolean);
    const dir = cabeca.slice(barra + 1).trim();
    if (esq.length && NAO_MARCA.test(esq[esq.length - 1])) {
      // "IMP/FORD ESCORT 1.8I GL" -> marca FORD, modelo ESCORT 1.8I GL
      const d = dir.split(/\s+/).filter(Boolean);
      marca = d[0];
      modelo = d.slice(1).join(' ') || undefined;
    } else {
      marca = esq[esq.length - 1];
      modelo = dir || undefined;
    }
  } else {
    const palavras = cabeca.split(/\s+/).filter(Boolean);
    if (palavras.length) {
      marca = palavras[0];
      modelo = palavras.slice(1).join(' ') || undefined;
    }
  }

  // rótulo que sobreviveu ao corte não pode virar marca
  if (marca && ROTULO.test(marca)) {
    const limpos = cabeca.split(/[\s/]+/).filter((w) => w && !ROTULO.test(w));
    marca = limpos[0];
    modelo = limpos.slice(1).join(' ') || undefined;
  }

  const cor =
    t.match(RX_COR)?.[1] ??
    t.match(RX_COR_SOLTA)?.[1] ??
    (detalhe ?? '').match(RX_COR)?.[1];

  return {
    marca: marca ? marca.toLowerCase() : undefined,
    modelo: modelo ? modelo.toLowerCase() : undefined,
    anoFab: plausivel(anoFab),
    anoModelo: plausivel(anoModelo) ?? plausivel(anoFab),
    cor: cor ? cor.toLowerCase() : undefined,
  };
}

/** subCategory da API -> tipo do nosso banco (o que a FIPE cobre) */
export function tipoDeSubcategoria(sub?: string, desc?: string): string {
  const s = (sub ?? '').toLowerCase();
  if (/motocicl|moto/.test(s)) return 'motos';
  if (/caminh|[oô]nibus/.test(s)) return 'caminhões';
  // Partes & Peças e Coleções não são veículo: vão para um tipo que
  // fipeTypeFor devolve null, senão o matcher tentaria casar peça avulsa
  // com um carro de nome parecido.
  if (/parte|pe[çc]a|cole[çc]/.test(s)) return 'partes e peças';
  if (/hatch|sedan|picape|suv|minivan|cup[êe]|utilit|furg|carro/.test(s)) return 'carros';
  return /motocicl/i.test(desc ?? '') ? 'motos' : 'carros';
}

export function mapSuperbidDoc(d: Record<string, any>): DbLot | null {
  if (!d.offerId || !d.auctionId) return null;

  const p = parseShortDesc(
    String(d.shortDesc ?? ''),
    d.detalhe ? String(d.detalhe) : undefined,
  );
  const [cidade, uf] = String(d.cidadeUf ?? '').split(' - ').map((s: string) => s?.trim());

  const sub = String(d.subCategoria ?? '');
  const ehSucata = /sucata/i.test(sub) || /sucata/i.test(String(d.shortDesc ?? ''));

  return {
    externalId: String(d.offerId),
    auctionExternalId: String(d.auctionId),
    numeroLote: d.lotNumber != null ? String(d.lotNumber) : undefined,
    tipo: tipoDeSubcategoria(sub, String(d.shortDesc ?? '')),
    marca: p.marca,
    modelo: p.modelo,
    anoFabricacao: p.anoFab,
    anoModelo: p.anoModelo,
    cor: p.cor,
    combustivel: undefined,
    km: undefined,
    // sucata é ~22% do acervo: sem marcar, entraria com o multiplicador
    // de condição ausente e apareceria barata demais no ranking.
    condicao: ehSucata ? 'sucata' : undefined,
    origem: 'judicial',
    comitente: d.auction_name ? String(d.auction_name).toLowerCase() : undefined,
    statusTexto: d.temLance ? 'em_pregao' : 'disponivel',
    temChave: undefined,
    financiavel: undefined,
    descricao: String(d.shortDesc ?? '') || undefined,
    lanceInicial: typeof d.preco === 'number' ? d.preco : undefined,
    lanceAtual: d.temLance && typeof d.preco === 'number' ? d.preco : undefined,
    valorMercado: undefined,
    imagens: Array.isArray(d.imagens) ? d.imagens.filter(Boolean) : [],
    cidade: cidade ? cidade.toLowerCase() : undefined,
    uf: uf ? uf.toUpperCase().slice(0, 2) : undefined,
    paginaUrl: String(d.paginaUrl ?? ''),
  };
}
