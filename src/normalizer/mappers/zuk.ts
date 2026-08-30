import type { DbLot } from './sodre';

/**
 * Mapper: card do Portal Zuk → registro para `lotes`.
 *
 * Acervo judicial (Tribunal de Justiça), com a mesma estrutura de praça
 * do Mega: 1º leilão pelo valor da avaliação, 2º com deságio. O valor da
 * praça em curso é lance mínimo publicado, então score `confirmado`.
 *
 * A descrição vem num formato regular:
 *   "Carro, VW/Fusca 1300, cor branca, 1980/1980, placas BUT-9876."
 *    tipo   marca/modelo    cor          ano/ano     placa
 */

function precoBR(txt?: string): number | undefined {
  if (!txt) return undefined;
  const n = parseFloat(txt.replace(/[^\d,]/g, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function tipoDe(primeiroCampo: string): string {
  const t = (primeiroCampo || '').toLowerCase();
  if (/moto/.test(t)) return 'motos';
  if (/caminh|[oô]nibus|trator/.test(t)) return 'caminhões';
  return 'carros';
}

/**
 * A descrição do Zuk vem em pelo menos três formatos, e o servidor trunca
 * as longas. Nenhum campo estruturado — tudo sai daqui:
 *
 *   A) "Carro, VW/Fusca 1300, cor branca, 1980/1980, placas BUT-9876."
 *   B) "LOTE 3: VEÍCULO VW GOL 1.0 GIV, PLACA FFN-3857, ANO 2013, EM..."
 *   C) "LOTE 6.1 - 01(um) Veículo Iveco/Daily 35S14, diesel, ano de fab..."
 *
 * Por isso cada campo é procurado por PADRÃO no texto todo, e não por
 * posição de vírgula: com truncagem, contar campo quebra.
 */
export function parseDescricao(desc: string): {
  tipo: string; marca?: string; modelo?: string; cor?: string;
  anoFab?: number; anoModelo?: number;
} {
  const t = (desc || '').trim();
  const tipo = tipoDe(t);

  // ano: "1980/1980" primeiro; senão "ANO 2013" / "ano de fabricação 2013"
  const parAnos = t.match(/(\d{4})\s*\/\s*(\d{4})/);
  const anoSolto = t.match(/ano(?:\s+de\s+fabrica[çc][ãa]o)?\s*:?\s*(\d{4})/i);
  const anoFab = parAnos ? Number(parAnos[1]) : anoSolto ? Number(anoSolto[1]) : undefined;
  const anoModelo = parAnos ? Number(parAnos[2]) : anoFab;

  // marca/modelo: o padrão "MARCA/MODELO" aparece em todos os formatos.
  // Recorta até a próxima vírgula, que é onde o modelo termina.
  const mm = t.match(/([A-Za-zÀ-ÿ]{2,})\s*\/\s*([^,.;]{2,60})/);
  let marca = mm?.[1];
  let modelo = mm?.[2]?.trim();

  // sem barra: tenta o que vem depois de "VEÍCULO" (formato B)
  if (!marca) {
    const apos = t.match(/ve[íi]culo\s+([A-Za-zÀ-ÿ]{2,})\s+([^,.;]{2,60})/i);
    marca = apos?.[1];
    modelo = apos?.[2]?.trim();
  }

  const cor = t.match(/cor\s+([A-Za-zÀ-ÿ]+)/i)?.[1];

  // descarta ano fora de faixa plausível (pega "1.0" virando ano, etc.)
  const anoOk = (n?: number) => (n && n >= 1950 && n <= new Date().getFullYear() + 2 ? n : undefined);

  return {
    tipo,
    marca: marca ? marca.toLowerCase() : undefined,
    modelo: modelo ? modelo.toLowerCase() : undefined,
    cor: cor ? cor.toLowerCase() : undefined,
    anoFab: anoOk(anoFab),
    anoModelo: anoOk(anoModelo),
  };
}

export function mapZukDoc(d: Record<string, any>): DbLot | null {
  if (!d.leilaoId || !d.loteId) return null;

  const p = parseDescricao(String(d.descricao ?? ''));
  // "Cachoeira Paulista / SP - Centro"
  const [cidadeUf] = String(d.endereco ?? '').split(' - ');
  const [cidade, uf] = (cidadeUf ?? '').split('/').map((s) => s.trim());

  const v1 = precoBR(d.praca1Valor);
  const v2 = precoBR(d.praca2Valor);
  // enquanto a 1ª praça não passou, é ela que vale; senão, a 2ª
  const lanceMinimo = v2 ?? v1;

  return {
    externalId: `${d.leilaoId}-${d.loteId}`,
    auctionExternalId: String(d.leilaoId),
    numeroLote: String(d.loteId),
    tipo: p.tipo,
    marca: p.marca,
    modelo: p.modelo,
    anoFabricacao: p.anoFab,
    anoModelo: p.anoModelo,
    cor: p.cor,
    combustivel: undefined,
    km: undefined,          // o Zuk não publica quilometragem
    condicao: undefined,    // nem monta: score usa o default
    origem: 'judicial',     // acervo é de Tribunal de Justiça
    comitente: d.comitente ? String(d.comitente).toLowerCase() : undefined,
    statusTexto: 'andamento',
    temChave: undefined,
    financiavel: undefined,
    descricao: String(d.descricao ?? '') || undefined,
    lanceInicial: lanceMinimo,
    lanceAtual: undefined,
    valorMercado: v1,       // 1º leilão sai pela avaliação
    imagens: d.imagem ? [String(d.imagem)] : [],
    cidade: cidade ? cidade.toLowerCase() : undefined,
    uf: uf ? uf.toUpperCase().slice(0, 2) : undefined,
    paginaUrl: String(d.paginaUrl ?? ''),
  };
}
