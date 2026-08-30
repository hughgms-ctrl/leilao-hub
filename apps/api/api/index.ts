/**
 * Entrypoint serverless da Vercel.
 *
 * A Vercel trata cada arquivo em /api como uma function. Aqui só
 * reexportamos o app Express inteiro: o vercel.json manda TODAS as rotas
 * para cá, então o roteamento continua sendo do Express — a app roda igual
 * local e em produção, sem duas versões de rota para manter em sincronia.
 */
export { default } from '../src/index';
