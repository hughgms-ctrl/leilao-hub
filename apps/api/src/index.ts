import express from 'express';
import cors from 'cors';
import { z } from 'zod';
import { listaLotesSchema, idSchema } from './schemas.js';
import { listarLotes, buscarLote, estatisticas } from './queries.js';
import { pool } from './db.js';
import { limitePorIp, cacheDeBorda } from './protecao.js';

const app = express();
const PORT = Number(process.env.PORT ?? 3001);

/**
 * CORS aberto — e tem que ser, por causa do cache de borda.
 *
 * Antes havia uma allowlist de origens (localhost:5173 + *.vercel.app).
 * Com allowlist a resposta muda conforme o header `Origin`, e a única
 * forma de a CDN não misturar as variantes é `Vary: Origin`. O Express
 * mandava o Vary certinho, mas a CDN da Vercel NÃO usa Vary como chave de
 * cache: ela guarda uma variante só. Bastou uma requisição sem `Origin`
 * (crawler, health check, curl) chegar primeiro para a CDN guardar a
 * resposta sem `Access-Control-Allow-Origin` — e passar a servir essa
 * cópia para o browser de todo mundo. Resultado: o site inteiro caiu com
 * "Failed to fetch" por CORS, com a API respondendo 200.
 *
 * `*` gera uma resposta idêntica para qualquer origem, então a cópia da
 * CDN vale para todos. Não perdemos proteção: são só rotas GET de catálogo
 * público, sem cookie e sem credencial — quem quisesse os dados já pegava
 * com um curl, que CORS nunca impediu. CORS defende sessão de usuário, e
 * aqui não existe sessão.
 *
 * Se um dia entrar rota autenticada, ela NÃO pode ficar sob esta política
 * nem sob o cache de borda.
 */
app.use(cors({ origin: '*', methods: ['GET'] }));
app.use(express.json());
app.use(limitePorIp);
app.use(cacheDeBorda);

/**
 * Erro de validação vira 400 com detalhe; o resto vira 500.
 *
 * `cacheDeBorda` já carimbou `s-maxage=300` na resposta antes de a rota
 * rodar, então sem o `no-store` aqui uma falha momentânea do banco ficaria
 * grudada na CDN por 5 minutos (mais 10 de stale-while-revalidate) depois
 * de o banco já ter voltado. Erro não se cacheia.
 */
function comErro(fn: express.RequestHandler): express.RequestHandler {
  return async (req, res, next) => {
    try {
      await fn(req, res, next);
    } catch (e) {
      res.setHeader('Cache-Control', 'no-store');
      if (e instanceof z.ZodError) {
        res.status(400).json({ erro: 'parametros invalidos', detalhes: e.issues });
        return;
      }
      console.error('[api] erro:', e);
      res.status(500).json({ erro: 'erro interno' });
    }
  };
}

app.get('/api/health', comErro(async (_req, res) => {
  await pool.query('SELECT 1');
  res.json({ ok: true });
}));

app.get('/api/stats', comErro(async (_req, res) => {
  res.json(await estatisticas());
}));

app.get('/api/lotes', comErro(async (req, res) => {
  const q = listaLotesSchema.parse(req.query);
  res.json(await listarLotes(q));
}));

/**
 * Atalho do dashboard: só lote pontuado, confirmado por padrão.
 * Sem o default em 'confirmado' o ranking é dominado por lance de
 * abertura de pregão (score especulativo).
 */
app.get('/api/oportunidades', comErro(async (req, res) => {
  const q = listaLotesSchema.parse({
    score_tipo: 'confirmado',
    order: 'score',
    dir: 'desc',
    ...req.query,
  });
  res.json(await listarLotes(q, { apenasComScore: true }));
}));

app.get('/api/lotes/:id', comErro(async (req, res) => {
  const id = idSchema.parse(req.params.id);
  const lote = await buscarLote(id);
  if (!lote) {
    // idem: lote some e volta entre ciclos do worker; 404 na CDN por 5min
    // deixaria um lote válido inacessível depois de ele já ter voltado
    res.setHeader('Cache-Control', 'no-store');
    res.status(404).json({ erro: 'lote nao encontrado' });
    return;
  }
  res.json(lote);
}));

/**
 * Na Vercel o handler serverless importa `app` e a plataforma cuida do
 * socket — chamar listen() ali quebraria o deploy. Local (tsx/node) a
 * variavel VERCEL nao existe, entao subimos o servidor normalmente.
 */
if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`[api] ouvindo em http://localhost:${PORT}`);
  });
}

export default app;
