#!/usr/bin/env bash
#
# Executa scrape + normalize em sequência, com lock e log rotacionado.
# Chamado pelo cron a cada 6h. Ver deploy/cron-worker.md.
#
set -euo pipefail

REPO_DIR="${REPO_DIR:-$HOME/leilao-hub}"
LOG_DIR="${LOG_DIR:-$HOME/leilao-logs}"
LOCK_FILE="${LOCK_FILE:-/tmp/leilao-pipeline.lock}"
RETENCAO_DIAS="${RETENCAO_DIAS:-14}"

mkdir -p "$LOG_DIR"

# Lock: se a execução anterior ainda roda (scrape+normalize passam de 1h
# quando a FIPE está lenta), esta sai sem fazer nada. Duas instâncias
# simultâneas bateriam no site em paralelo — exatamente o que o
# DELAY_MS de 2s existe para evitar.
exec 200>"$LOCK_FILE"
if ! flock -n 200; then
  echo "[$(date -Is)] execucao anterior ainda em andamento — pulando" >> "$LOG_DIR/skips.log"
  exit 0
fi

LOG="$LOG_DIR/pipeline-$(date +%Y%m%d-%H%M%S).log"

cd "$REPO_DIR"

# O código lê process.env direto (sem dotenv), então o .env precisa ser
# exportado aqui. set -a faz toda variável atribuída virar exportada.
set -a
[ -f .env ] && . ./.env
set +a

{
  echo "=== inicio $(date -Is) ==="
  echo "--- scrape ---"
  npm run scrape
  echo "--- normalize ---"
  npm run normalize
  echo "=== fim $(date -Is) ==="
} >> "$LOG" 2>&1

# Rotação simples: descarta log com mais de RETENCAO_DIAS dias.
find "$LOG_DIR" -name 'pipeline-*.log' -type f -mtime +"$RETENCAO_DIAS" -delete
