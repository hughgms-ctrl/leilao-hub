# Pipeline: normalizer + FIPE + score

Arquivos NOVOS para adicionar à pasta `scrapers/` existente.
NENHUM arquivo daqui sobrescreve o que o Claude Code já corrigiu.

## Instalação

1. Copie o conteúdo de `src/` para dentro de `scrapers/src/`
   (novas pastas: `normalizer/`, `fipe/`; novos arquivos: `config.ts`,
   `score.ts`, `run-normalizer.ts`)
2. Adicione ao package.json, em "scripts":
   "normalize": "tsx src/run-normalizer.ts"
3. Rode as migrações no Postgres, NESTA ordem:
   - `CREATE EXTENSION IF NOT EXISTS pg_trgm;`
   - `db/schema.sql` (se ainda não rodou)
   - `db/002_ajustes.sql`

## Banco local rápido (docker-compose.yml incluso)

    docker compose up -d
    psql postgresql://leilao:leilao@localhost:5432/leilaohub -c "CREATE EXTENSION IF NOT EXISTS pg_trgm;"
    psql postgresql://leilao:leilao@localhost:5432/leilaohub -f db/schema.sql
    psql postgresql://leilao:leilao@localhost:5432/leilaohub -f db/002_ajustes.sql

## Fluxo completo

    export DATABASE_URL=postgresql://leilao:leilao@localhost:5432/leilaohub
    npm run scrape       # coleta → raw_scrapes
    npm run normalize    # raw_scrapes → lotes + FIPE + score

## Prompt sugerido para o Claude Code

    Integre os arquivos novos (normalizer/, fipe/, config.ts, score.ts,
    run-normalizer.ts) ao projeto. Depois:
    1. Valide os 3 campos marcados [CONFIRMAR] em
       src/normalizer/mappers/sodre.ts contra o sample-response.json
       real da pasta e corrija se necessário
    2. Suba o Postgres do docker-compose.yml, rode as migrações na ordem
       do README e execute npm run scrape + npm run normalize
    3. Me mostre: SELECT marca, modelo, ano_modelo, lance_atual,
       score_oportunidade, fipe_match_score FROM lotes
       WHERE score_oportunidade IS NOT NULL
       ORDER BY score_oportunidade DESC LIMIT 10
    Regras: não reduza FIPE_DELAY_MS nem DELAY_MS do scraper; máximo
    1 execução do scraper (o normalizer pode rodar quantas vezes quiser,
    ele é idempotente e trabalha só no banco).

## O que observar no resultado

- `fipe_match_score` baixo (< 0.65) em lotes do topo do ranking = match
  FIPE duvidoso. Ajuste FIPE_MATCH_MIN_SCORE em config.ts se aparecer lixo.
- Lotes "média monta" dominando o topo = multiplicador 0.65 generoso
  demais; calibre em config.ts.
- Os parâmetros de negócio são TODOS chutes iniciais documentados em
  config.ts — a calibração real vem do histórico de arremates.
