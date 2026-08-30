import express from 'express';
import cors from 'cors';
import { z } from 'zod';
import { listaLotesSchema, idSchema } from './schemas';
import { listarLotes, buscarLote, estatisticas } from './queries';
import { pool } from './db';

const app = express();
const PORT = Number(process.env.PORT ?? 3001);

/**
 * Origens liberadas. Local: 5173 do Vite. Em producao a URL do front na
 * Vercel muda por projeto/preview, entao vem de CORS_ORIGINS (lista
 * separada por virgula). Previews da Vercel (*.vercel.app) sao aceitos
 * por padrao para nao ter que recadastrar a cada deploy.
 */
const ORIGENS_LOCAIS = ['http://localhost:5173', 'http://127.0.0.1:5173'];
const ORIGENS_ENV = (process.env.CORS_ORIGINS ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, cb) {
      // requisicoes sem Origin (curl, health check) passam
      if (!origin) return cb(null, true);
      const liberado =
        ORIGENS_LOCAIS.includes(origin) ||
        ORIGENS_ENV.includes(origin) ||
        /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin);
      // origem não liberada: responde SEM o header e deixa o browser
      // bloquear. Lançar Error aqui viraria 500 no lugar de um CORS limpo.
      cb(null, liberado);
    },
  }),
);
app.use(express.json());

/** erro de validação vira 400 com detalhe; o resto vira 500 */
function comErro(fn: express.RequestHandler): express.RequestHandler {
  return async (req, res, next) => {
    try {
      await fn(req, res, next);
    } catch (e) {
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
