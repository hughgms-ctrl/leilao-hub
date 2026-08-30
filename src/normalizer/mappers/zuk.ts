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
  // Semirreboque/carreta não é automóvel e a FIPE não cobre. Sem esta
  // linha eles caíam no fallback 'carros' e o matcher tentaria casá-los
  // com um carro de nome parecido — preço errado alimentando o ranking.
  if (/semi[- ]?reboque|reboque|carreta|carroceria/.test(t)) return 'implementos rod.';
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

  // ano, em três formatos que convivem na mesma listagem:
  //   "1980/1980"                    → fabricação/modelo
  //   "ANO 2013" / "ano de fab. 2013"
  //   "Monza Hatch, 1982, placa ..." → ano sozinho entre vírgulas
  // O terceiro exige que os 4 dígitos sejam o campo INTEIRO entre vírgulas;
  // sem isso "Fusca 1300" viraria ano. A faixa plausível de anoOk é a
  // segunda barreira.
  const parAnos = t.match(/(\d{4})\s*\/\s*(\d{4})/);
  const anoRotulado = t.match(/ano(?:\s+de\s+fabrica[çc][ãa]o)?\s*:?\s*(\d{4})/i);
  const anoIsolado = t.match(/(?:^|,)\s*(\d{4})\s*(?=,|\.|$)/);
  const anoFab = parAnos
    ? Number(parAnos[1])
    : anoRotulado
      ? Number(anoRotulado[1])
      : anoIsolado
        ? Number(anoIsolado[1])
        : undefined;
  const anoModelo = parAnos ? Number(parAnos[2]) : anoFab;

  // marca/modelo: o padrão "MARCA/MODELO" aparece em todos os formatos.
  // Recorta até a próxima vírgula, que é onde o modelo termina.
  //
  // O ponto NÃO pode entrar no corte: excluí-lo truncava a motorização
  // ("UNO VIVACE 1.0" virava "UNO VIVACE 1"), e é justamente esse token
  // que o matcher da FIPE usa. Então cortamos só por vírgula/ponto-e-
  // vírgula e depois limpamos o ponto que não for decimal (o final de
  // frase em "placas BUT-9876.").
  const limpar = (v?: string) =>
    v?.replace(/\.(?!\d)/g, ' ').replace(/\s+/g, ' ').trim() || undefined;

  let marca: string | undefined;
  let modelo: string | undefined;

  // Formato A ("Carro, MARCA/MODELO, cor ..."): o veículo é o campo
  // seguinte ao tipo. Ler POSIÇÃO aqui é mais seguro do que caçar a
  // primeira barra do texto — havia descrições com "ano/modelo
  // 2013/2013", e a barra dessa expressão virava marca "ano" e modelo
  // "modelo 2013/2013" em 12 dos 36 lotes elegíveis.
  const campos = t.split(',').map((x) => x.trim());
  if (campos.length > 1 && /^(carro|motocicleta|moto|caminh|ve[íi]culo)/i.test(campos[0])) {
    const veic = campos[1];
    const barra = veic.indexOf('/');
    if (barra > 0) {
      marca = veic.slice(0, barra).trim().split(/\s+/).pop();
      modelo = limpar(veic.slice(barra + 1));
      // "Fiat Palio ELX/FLEX 1.4": a marca é a 1ª palavra, e o que vem
      // antes da barra faz parte do modelo.
      const antes = veic.slice(0, barra).trim().split(/\s+/);
      if (antes.length > 1) {
        marca = antes[0];
        modelo = limpar(`${antes.slice(1).join(' ')}/${veic.slice(barra + 1)}`);
      }
    } else {
      const palavras = veic.split(/\s+/);
      marca = palavras[0];
      modelo = limpar(palavras.slice(1).join(' '));
    }
  }

  // Formato B ("LOTE 3: VEÍCULO VW GOL 1.0 GIV, PLACA ..."):
  // o que vem depois de "VEÍCULO".
  if (!marca || !modelo) {
    const apos = t.match(/ve[íi]culo\s+([A-Za-zÀ-ÿ]{2,})\s+([^,;]{2,60})/i);
    if (apos) {
      marca = apos[1];
      modelo = limpar(apos[2]);
    }
  }

  // Último recurso: primeira barra do texto, ignorando rótulos que não
  // são marca ("ano/modelo", "marca/modelo").
  if (!marca || !modelo) {
    const ROTULO = /^(ano|anos|modelo|marca|tipo|cor|km|placa|chassi|fab)$/i;
    for (const m of t.matchAll(/([A-Za-zÀ-ÿ]{2,})\s*\/\s*([^,;]{2,60})/g)) {
      if (ROTULO.test(m[1])) continue;
      marca = m[1];
      modelo = limpar(m[2]);
      break;
    }
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
  // Mesma regra do Mega: quando há 2ª praça publicada é ela o lance
  // mínimo relevante (é onde entra o deságio); a 1ª fica como avaliação.
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
