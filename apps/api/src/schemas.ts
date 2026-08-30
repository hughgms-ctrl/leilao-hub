import { z } from 'zod';

/** número vindo de query string ("" e ausente viram undefined) */
const num = z.coerce.number().optional();
const str = z
  .string()
  .trim()
  .min(1)
  .optional()
  .transform((v) => (v === '' ? undefined : v));

export const ORDER_COLS = ['score', 'preco', 'ano'] as const;
export const ORDER_DIRS = ['asc', 'desc'] as const;
export const SCORE_TIPOS = ['confirmado', 'especulativo', 'todos'] as const;

export const listaLotesSchema = z.object({
  preco_min: num,
  preco_max: num,
  ano_min: num,
  ano_max: num,
  score_min: num,
  uf: str,
  tipo: str,
  condicao: str,
  origem: str,
  status: str,
  marca: str,
  leiloeiro: str,
  busca: str,
  score_tipo: z.enum(SCORE_TIPOS).optional(),
  // querystring nao tem boolean: aceita 'true'/'false' e converte
  financiavel: z.enum(['true', 'false']).optional(),
  parcelamento: z.enum(['true', 'false']).optional(),
  judicial: z.enum(['true', 'false']).optional(),
  order: z.enum(ORDER_COLS).optional().default('score'),
  dir: z.enum(ORDER_DIRS).optional().default('desc'),
  page: z.coerce.number().int().min(1).optional().default(1),
  per_page: z.coerce.number().int().min(1).max(50).optional().default(24),
});

export type ListaLotesQuery = z.infer<typeof listaLotesSchema>;

export const idSchema = z.coerce.number().int().positive();
