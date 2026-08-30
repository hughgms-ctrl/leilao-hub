# Leilão Hub

Coleta lotes de veículos em leilão, casa cada um com a tabela FIPE e calcula
um score de oportunidade (quanto o custo total fica abaixo do valor de
mercado ajustado). Fonte atual: **Sodré Santoro**.

## Os três apps

| Pasta | O que é | Onde roda |
|---|---|---|
| `src/` | Scraper + normalizer + matcher FIPE + score | VPS, por cron (6/6h) |
| `apps/api/` | API REST (Express + zod + pg, sem ORM) | Vercel (serverless) |
| `apps/web/` | Dashboard (React + Vite + Tailwind + shadcn/ui) | Vercel (estático) |

## O fluxo

```
scrape ──► raw_scrapes ──► normalize ──► lotes ──► api ──► web
 (site)     (staging)      (+FIPE,        (banco)
                            +score)
```

1. **scrape** — pagina a API interna do leiloeiro e grava o JSON **bruto** em
   `raw_scrapes`. Não interpreta nada: se o parser mudar, dá para reprocessar
   sem bater no site de novo.
2. **normalize** — lê o staging pendente, faz upsert em `leiloes`/`lotes`,
   guarda imagens e histórico de lances, casa com a FIPE e calcula o score.
   É idempotente: pode rodar quantas vezes precisar.
3. **api** — expõe `/api/lotes`, `/api/lotes/:id`, `/api/oportunidades`,
   `/api/stats`.
4. **web** — dashboard com filtros, ranking e link para o lote no leiloeiro.

## Score: confirmado vs especulativo

O score compara o **lance de referência** (o maior entre lance inicial e
lance atual) com a FIPE ajustada por condição e origem.

- **confirmado** — o leiloeiro publicou lance inicial, então existe piso real
  de preço.
- **especulativo** — só há lance corrente de um pregão recém-aberto. O
  desconto parece muito maior do que é; o dashboard mostra separado e filtra
  por `confirmado` por padrão.

Toda a calibração (multiplicadores de condição, taxas, piso de sanidade,
confiança mínima do match FIPE) está num arquivo só: `src/config.ts`.

## Rodando local

Precisa de um Postgres. Rode `db/000_supabase.sql` nele — o script é
idempotente e já cria tudo, inclusive o seed obrigatório do leiloeiro.

```bash
npm install
npx playwright install chromium
```

```bash
DIRECT_DATABASE_URL='postgresql://...' npm run scrape
```

```bash
DIRECT_DATABASE_URL='postgresql://...' npm run normalize
```

```bash
cd apps/api && DATABASE_URL='postgresql://...' npm run dev
```

```bash
cd apps/web && npm run dev
```

Para iterar no parser **sem** bater no site, use o fixture versionado:

```bash
npx tsx src/show-sample.ts
```

## Variáveis de ambiente

| Variável | Quem usa | Qual conexão |
|---|---|---|
| `DIRECT_DATABASE_URL` | scraper, normalizer | Supabase **direta**, porta 5432 |
| `DATABASE_URL` | apps/api | Supabase **pooler**, porta 6543 |
| `CORS_ORIGINS` | apps/api | origens extras liberadas (lista por vírgula) |
| `VITE_API_URL` | apps/web | URL pública da API |

Processo longo com transações usa a conexão direta; serverless usa o pooler,
senão estoura o limite de conexões. Ver `.env.example`.

## Deploy

- **Banco**: `db/000_supabase.sql` no SQL Editor da Supabase.
- **API e web**: Vercel, um projeto para cada (`apps/api`, `apps/web`).
- **Worker**: `deploy/cron-worker.md` — VPS Ubuntu com cron + `flock`.
- **Plano B**: `.github/workflows/scrape.yml` (desativado; só manual).

## Regras que não se negociam

O site tem Azion Bot Manager e bloqueia IP.

- `DELAY_MS` (2 s entre páginas) e o bootstrap via Playwright são pisos.
- `FIPE_DELAY_MS` (600 ms) idem.
- Nada de paralelizar requisições ao leiloeiro.
- Ao mexer no parser, itere sobre `sample-response.json`, não re-scrapeando.
