#!/usr/bin/env bash
# Importa o dump do MySQL de produção (HostGator) para o ERP local.
#
#   scripts/import-prod.sh caminho/do/dump.sql [--dry-run]
#
# Fluxo: carrega o dump numa base auxiliar `pedidopro_prod` no MySQL do Docker,
# dá SELECT ao usuário do app e roda bin/import-prod-data.php (interseção de
# colunas → org_id e colunas novas do ERP ficam com DEFAULT). A base auxiliar
# fica no ar depois, para conferência; o transformador imprime como removê-la.
#
# IMPORTANTE (export no phpMyAdmin): desmarque "Add CREATE DATABASE / USE" —
# o dump deve conter só CREATE TABLE/INSERT, sem trocar de banco no meio.
set -euo pipefail

cd "$(dirname "$0")/.."

DUMP="${1:?uso: scripts/import-prod.sh caminho/do/dump.sql [--dry-run]}"
shift || true
[ -f "$DUMP" ] || { echo "ERRO: arquivo não encontrado: $DUMP" >&2; exit 1; }

ROOT_PASS="${DB_ROOT_PASS:-root_pedidopro}"
APP_USER="${DB_USER:-pedidopro}"
AUX_DB=pedidopro_prod

# Dump não pode trocar de banco (senão os dados iriam parar fora da base auxiliar).
if grep -qiE '^\s*(USE\s|CREATE\s+DATABASE)' "$DUMP"; then
  echo "ERRO: o dump contém 'USE'/'CREATE DATABASE' — re-exporte sem essas opções (phpMyAdmin: desmarcar 'Add CREATE DATABASE / USE')." >&2
  exit 1
fi

echo "[1/3] criando base auxiliar ${AUX_DB}..."
docker compose exec -T db mysql -uroot -p"$ROOT_PASS" -e \
  "DROP DATABASE IF EXISTS ${AUX_DB}; CREATE DATABASE ${AUX_DB} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; GRANT SELECT ON ${AUX_DB}.* TO '${APP_USER}'@'%'; FLUSH PRIVILEGES;"

echo "[2/3] carregando dump ($(du -h "$DUMP" | cut -f1)) em ${AUX_DB}..."
docker compose exec -T db mysql -uroot -p"$ROOT_PASS" --default-character-set=utf8mb4 "$AUX_DB" < "$DUMP"

echo "[3/3] copiando dados para o ERP local..."
# Via `sh -c` para o Git Bash do Windows não reescrever o path /var/... (MSYS).
docker compose exec -T app sh -c "php /var/www/html/api/bin/import-prod-data.php --source='$AUX_DB' $*"
