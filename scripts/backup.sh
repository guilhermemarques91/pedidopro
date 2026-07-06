#!/bin/bash
# Backup do banco do PedidoPro ERP (stack Docker local).
#
#   ./scripts/backup.sh                 # gera backups/pedidopro-AAAA-MM-DD-HHMM.sql.gz
#   BACKUP_DIR=/outra/pasta ./scripts/backup.sh
#
# Mantém os últimos N dumps (RETENTION, padrão 14). Agende no host:
#   - Linux (cron):  0 3 * * *  cd /caminho/pedidos-erp && ./scripts/backup.sh
#   - Windows (Agendador de Tarefas): bash.exe -lc "cd /d/pedidos-erp && ./scripts/backup.sh"
# Cópia off-site (nuvem): sincronize a pasta backups/ (rclone/Drive/etc).
set -euo pipefail

cd "$(dirname "$0")/.."
BACKUP_DIR="${BACKUP_DIR:-backups}"
RETENTION="${RETENTION:-14}"
DB_NAME="${DB_NAME:-pedidopro}"
STAMP=$(date +%Y-%m-%d-%H%M)
OUT="$BACKUP_DIR/pedidopro-$STAMP.sql.gz"

mkdir -p "$BACKUP_DIR"
docker compose exec -T db sh -c 'exec mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction --routines "'"$DB_NAME"'"' \
  | gzip > "$OUT"

SIZE=$(du -h "$OUT" | cut -f1)
echo "backup ok: $OUT ($SIZE)"

# Retenção: apaga os mais antigos além de N.
ls -1t "$BACKUP_DIR"/pedidopro-*.sql.gz 2>/dev/null | tail -n +$((RETENTION + 1)) | while read -r f; do
  rm -f "$f" && echo "removido (retenção): $f"
done
