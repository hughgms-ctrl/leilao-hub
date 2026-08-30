/**
 * Entrypoint serverless da Vercel.
 *
 * A Vercel trata cada arquivo em /api como uma function. Aqui só
 * reexportamos o app Express inteiro: o vercel.json manda TODAS as rotas
 * para cá, então o roteamento continua sendo do Express — a app roda igual
 * local e em produção, sem duas versões de rota para manter em sincronia.
 */
// Extensão .js obrigatória: o pacote é ESM ("type": "module") e o Node
// não resolve specifier sem extensão em runtime. O TypeScript mapeia
// o .js de volta para o .ts na hora de checar tipos.
export { default } from '../src/index.js';
