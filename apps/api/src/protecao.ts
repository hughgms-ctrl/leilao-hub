import type { RequestHandler } from 'express';

/**
 * Proteção da API pública.
 *
 * O dashboard não tem autenticação, então qualquer um pode chamar a API.
 * Não há caminho de escrita (só rotas GET, queries parametrizadas), então
 * o risco não é corromper dado — é consumo: cada chamada vira duas queries
 * no Supabase, e um laço insistente queima invocação da Vercel e conexão
 * do banco até derrubar o plano free.
 *
 * Duas camadas, nesta ordem de importância:
 *
 * 1. CACHE NA BORDA — a real defesa. Com s-maxage, a CDN da Vercel serve
 *    a resposta repetida sem tocar na função nem no banco. Os dados mudam
 *    a cada 6h (ciclo do worker), então cachear por minutos não atrapalha.
 *
 * 2. LIMITE POR IP — rede de proteção para o que fura o cache (querystring
 *    sempre diferente). É em memória e portanto POR INSTÂNCIA: em
 *    serverless não é um limite global exato, e sim um teto por processo.
 *    Serve para conter abuso ingênuo, não um atacante distribuído. O
 *    limite global de verdade só vem com autenticação ou store externo.
 */

const JANELA_MS = 60_000;
const MAX_POR_JANELA = Number(process.env.RATE_LIMIT_POR_MINUTO ?? 120);

const acessos = new Map<string, { inicio: number; n: number }>();

/** Descarta janelas vencidas para o Map não crescer sem limite. */
function limpar(agora: number) {
  for (const [ip, j] of acessos) {
    if (agora - j.inicio > JANELA_MS) acessos.delete(ip);
  }
}

export const limitePorIp: RequestHandler = (req, res, next) => {
  // atrás da CDN da Vercel o IP real vem no x-forwarded-for
  const ip = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim()
    || req.socket.remoteAddress
    || 'desconhecido';

  const agora = Date.now();
  if (acessos.size > 5000) limpar(agora);

  const janela = acessos.get(ip);
  if (!janela || agora - janela.inicio > JANELA_MS) {
    acessos.set(ip, { inicio: agora, n: 1 });
    return next();
  }

  janela.n++;
  if (janela.n > MAX_POR_JANELA) {
    const faltam = Math.ceil((JANELA_MS - (agora - janela.inicio)) / 1000);
    res.setHeader('Retry-After', String(faltam));
    res.status(429).json({
      erro: 'muitas requisições',
      detalhe: `limite de ${MAX_POR_JANELA} por minuto; tente de novo em ${faltam}s`,
    });
    return;
  }
  next();
};

/**
 * Cache na borda. O catálogo muda a cada ciclo de 6h do worker, então
 * 5 min de cache é invisível para quem usa e corta a maior parte da carga.
 * stale-while-revalidate deixa a CDN servir o valor velho enquanto busca
 * o novo, para ninguém pegar latência de banco.
 */
export const cacheDeBorda: RequestHandler = (_req, res, next) => {
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
  next();
};
