# PedidoPro — runtime local/LAN (multiplataforma: roda igual em Zorin e Windows).
# Reproduz o layout da HostGator dentro de um container: frontend em `/` e API em `/api`.

# ---- Stage 1: build do frontend (Vite) ----
FROM node:22-alpine AS frontend
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci || npm install
COPY frontend/ ./
RUN npm run build

# ---- Stage 2: dependências PHP (Composer) ----
FROM composer:2 AS vendor
WORKDIR /app
COPY backend-php/composer.json backend-php/composer.lock* ./
# Ignora platform reqs (ext-gd/zip/...) aqui: as extensões existem no estágio de runtime.
RUN composer install --no-dev --optimize-autoloader --no-interaction --no-scripts \
    --ignore-platform-reqs

# ---- Stage 3: runtime (PHP + Apache) ----
FROM php:8.3-apache AS runtime

# Extensões exigidas pelo backend e pelo phpspreadsheet (gd/zip) + pdo_mysql/mbstring.
RUN apt-get update && apt-get install -y --no-install-recommends \
        libonig-dev libzip-dev libpng-dev libjpeg-dev libfreetype6-dev \
    && docker-php-ext-configure gd --with-freetype --with-jpeg \
    && docker-php-ext-install -j"$(nproc)" pdo_mysql mbstring gd zip \
    && a2enmod rewrite headers \
    && rm -rf /var/lib/apt/lists/*

# Permite que os .htaccess (rewrite do SPA e da API) funcionem.
COPY docker/apache-override.conf /etc/apache2/conf-available/pedidopro.conf
RUN a2enconf pedidopro

# API em /api (front controller + código + vendor); frontend estático em /.
COPY backend-php/ /var/www/html/api/
COPY --from=vendor /app/vendor/ /var/www/html/api/vendor/
COPY --from=frontend /app/dist/ /var/www/html/
COPY docker/web-root.htaccess /var/www/html/.htaccess

RUN chown -R www-data:www-data /var/www/html

# Healthcheck simples: a API responde em /api/health.
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
    CMD php -r '$c=@file_get_contents("http://127.0.0.1/api/health");exit($c && strpos($c,"ok")!==false?0:1);' || exit 1
