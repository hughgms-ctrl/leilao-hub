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

/** "Carro, VW/Fusca 1300, cor branca, 1980/1980, placas BUT-9876." */
export function parseDescricao(desc: string): {
  tipo: string; marca?: string; modelo?: string; cor?: string;
  anoFab?: number; anoModelo?: number;
} {
  const partes = (desc || '').split(',').map((p) => p.trim()).filter(Boolean);
  const tipo = tipoDe(partes[0] ?? '');

  // "VW/Fusca 1300" -> marca VW, modelo Fusca 1300
  const marcaModelo = partes[1] ?? '';
  const barra = marcaModelo.indexOf('/');
  const marca = barra > 0 ? marcaModelo.slice(0, barra).trim() : undefined;
  const modelo = barra > 0 ? marcaModelo.slice(barra + 1).trim() : marcaModelo || undefined;

  const corRaw = partes.find((p) => /^cor\s+/i.test(p));
  const anos = (desc || '').match(/(\d{4})\s*\/\s*(\d{4})/);

  return {
    tipo,
    marca: marca ? marca.toLowerCase() : undefined,
    modelo: modelo ? modelo.toLowerCase() : undefined,
    cor: corRaw ? corRaw.replace(/^cor\s+/i, '').toLowerCase() : undefined,
    anoFab: anos ? Number(anos[1]) : undefined,
    anoModelo: anos ? Number(anos[2]) : undefined,
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
