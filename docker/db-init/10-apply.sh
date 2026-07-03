#!/bin/bash
# Inicialização do banco no PRIMEIRO boot do container MySQL:
# aplica o schema e depois as migrations em ordem numérica.
# (Roda apenas quando o volume de dados está vazio — comportamento padrão do
#  entrypoint oficial do MySQL via /docker-entrypoint-initdb.d.)
#
# NOTA: isto cobre o bootstrap inicial. A Etapa 0 do roadmap troca isto por um
# runner de migrations no lado da aplicação (tabela schema_migrations), que
# aplica incrementos em bancos já existentes.
set -euo pipefail

SRC=/opt/dbsrc
DB="${MYSQL_DATABASE}"
MYSQL=(mysql --protocol=socket -uroot -p"${MYSQL_ROOT_PASSWORD}" "${DB}")

# 1) Schema consolidado (estrito: precisa aplicar limpo num banco novo).
echo "[init] aplicando schema consolidado..."
"${MYSQL[@]}" < "${SRC}/schema.mysql.sql"

# 2) Migrations. O schema.mysql.sql já embute a maior parte delas; num banco novo
#    só faltam as tabelas do módulo delivery (004/005/006). As demais colidem com
#    objetos que já existem (ex.: ADD COLUMN duplicado) — erro BENIGNO.
#    Usamos `--force` (segue apesar de erros) + `|| true` para não abortar o init.
#    NOTA: bootstrap pragmático; a Etapa 0 do roadmap troca por um runner com
#    tabela schema_migrations (aplica cada migration UMA vez, na ordem certa).
echo "[init] aplicando migrations idempotentes (erros de 'já existe' são ignorados)..."
for f in $(ls "${SRC}/migrations"/*.sql | sort); do
    echo "[init]   - $(basename "$f")"
    "${MYSQL[@]}" --force < "$f" 2>&1 | grep -vE "Duplicate (column|key|foreign key)|already exists" || true
done

echo "[init] concluído."
