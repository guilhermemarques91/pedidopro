#!/bin/bash
# Inicialização do banco no PRIMEIRO boot do container MySQL: aplica o schema
# consolidado. (Roda apenas quando o volume de dados está vazio — comportamento
# padrão do entrypoint oficial do MySQL via /docker-entrypoint-initdb.d.)
#
# As MIGRATIONS não são aplicadas aqui: quem cuida delas é o runner PHP
# (`config/migrate.php`), executado pelo entrypoint do container do app — este
# container (imagem mysql) não tem PHP. O runner registra cada migration em
# `schema_migrations` e aplica só as pendentes (adota o baseline do schema).
set -euo pipefail

SRC=/opt/dbsrc
DB="${MYSQL_DATABASE}"
MYSQL=(mysql --protocol=socket -uroot -p"${MYSQL_ROOT_PASSWORD}" "${DB}")

echo "[init] aplicando schema consolidado..."
"${MYSQL[@]}" < "${SRC}/schema.mysql.sql"

echo "[init] schema aplicado. Migrations pendentes serão aplicadas pelo app (config/migrate.php)."
