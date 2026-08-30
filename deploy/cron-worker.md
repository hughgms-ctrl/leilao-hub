# Worker por cron no VPS (Ubuntu 24.04)

O worker roda `scrape` + `normalize` a cada 6 horas. Ele **não** serve HTTP —
só escreve no banco da Supabase. API e frontend ficam na Vercel.

Usa `DIRECT_DATABASE_URL` (Supabase porta **5432**, conexão direta), não o
pooler: são processos longos, com transações e milhares de INSERTs.

---

## 1. Node 22

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v   # deve mostrar v22.x
```

## 2. Dependências de sistema do Chromium

O scraper abre um Chromium real uma vez por execução para passar pelo
Azion Bot Manager e pegar os cookies de sessão. Sem isso a API do
leiloeiro devolve 403.

```bash
sudo apt-get update
sudo apt-get install -y git unzip ca-certificates
```

## 3. Clonar o repositório

```bash
cd ~
git clone https://github.com/<SEU_USUARIO>/<SEU_REPO>.git leilao-hub
cd leilao-hub
npm ci
```

> Use `npm ci` sem `--omit=dev`: o runner roda via `tsx`, que é devDependency.

## 4. Instalar o Chromium do Playwright

```bash
cd ~/leilao-hub
npx playwright install --with-deps chromium
```

`--with-deps` instala as libs de sistema (libnss3, libatk, etc.) via apt —
por isso pede sudo. Em Ubuntu 24.04 headless elas não vêm por padrão.

## 5. Configurar o `.env`

```bash
cd ~/leilao-hub
cat > .env <<'EOF'
DIRECT_DATABASE_URL=postgresql://postgres.<ref>:<senha>@aws-0-<regiao>.pooler.supabase.com:5432/postgres?sslmode=require
EOF
chmod 600 .env
```

A senha vai em texto plano no arquivo — `chmod 600` deixa legível só para o
seu usuário. O `.env` está no `.gitignore`; nunca comite.

## 6. Testar manualmente ANTES de agendar

```bash
cd ~/leilao-hub
./deploy/run-pipeline.sh
tail -f ~/leilao-logs/pipeline-*.log
```

O que esperar:
- `705 lotes coletados` (o número varia com o estoque do leiloeiro)
- `salvo em raw_scrapes`
- `[normalizer] raw N: 705 lotes processados, ~390 com FIPE`

A primeira execução do normalize demora **~10 minutos** por causa do rate
limit da FIPE (600 ms por chamada). Isso é intencional — não reduza.

Se aparecer `DIRECT_DATABASE_URL ausente`, o `.env` não foi lido: confira o
caminho e se o arquivo está na raiz do repo.

## 7. Agendar no cron

```bash
crontab -e
```

Adicione:

```cron
# Leilão Hub — scrape + normalize a cada 6 horas
0 */6 * * * /home/SEU_USUARIO/leilao-hub/deploy/run-pipeline.sh
```

Substitua `SEU_USUARIO`. Use caminho absoluto: o cron roda com um PATH
mínimo e sem o seu shell interativo.

Se `node`/`npm` não forem encontrados pelo cron, adicione no topo do crontab:

```cron
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
```

## 8. Lock e logs

O `run-pipeline.sh` já cuida dos dois:

- **Lock** (`flock -n`): se a execução anterior ainda estiver rodando, a nova
  sai imediatamente e registra em `~/leilao-logs/skips.log`. Sem isso, duas
  instâncias bateriam no site em paralelo — o oposto do que o `DELAY_MS` de
  2 s existe para garantir.
- **Log por execução**: `~/leilao-logs/pipeline-AAAAMMDD-HHMMSS.log`.
- **Rotação**: descarta logs com mais de 14 dias. Ajuste com
  `RETENCAO_DIAS=30 ./deploy/run-pipeline.sh` ou editando o default.

Comandos úteis:

```bash
ls -lt ~/leilao-logs | head          # execuções mais recentes
tail -f ~/leilao-logs/pipeline-*.log # acompanhar a atual
cat ~/leilao-logs/skips.log          # sobreposições evitadas pelo lock
grep -c "FIPE falhou" ~/leilao-logs/pipeline-*.log
```

## 9. Atualizar o worker depois de um push

```bash
cd ~/leilao-hub
git pull
npm ci
```

Se mudou algo em `src/adapters/`, rode `./deploy/run-pipeline.sh` uma vez na
mão antes de confiar no cron.

---

## Regras que não mudam com o deploy

- `DELAY_MS` do scraper (2 s) e `FIPE_DELAY_MS` (600 ms) são pisos, nunca tetos.
- Nada de paralelizar requisições ao leiloeiro.
- O normalize é idempotente e pode rodar quantas vezes quiser; o scrape não —
  cada execução é uma batida no site.
