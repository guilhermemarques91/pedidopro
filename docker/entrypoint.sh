#!/bin/bash
# Entrypoint do container do app: aplica as migrations pendentes e sobe o Apache.
#
# O compose já espera o banco ficar `healthy` (depends_on) antes de subir o app,
# então aqui o MySQL costuma estar pronto. Ainda assim tentamos algumas vezes:
# num banco recém-criado o schema (db-init) pode estar terminando de aplicar.
set -e

APP=/var/www/html/api

echo "[entrypoint] aplicando migrations (config/migrate.php)..."
attempt=1
until php "${APP}/config/migrate.php"; do
    if [ "${attempt}" -ge 10 ]; then
        echo "[entrypoint] migrations falharam após ${attempt} tentativas; abortando." >&2
        exit 1
    fi
    echo "[entrypoint] banco indisponível/instável — nova tentativa em 3s (${attempt}/10)..."
    attempt=$((attempt + 1))
    sleep 3
done

echo "[entrypoint] iniciando Apache..."
exec apache2-foreground
