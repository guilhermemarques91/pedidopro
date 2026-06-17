# PedidoPro — Backend PHP (HostGator)

Porte do backend Node/Express + PostgreSQL para **PHP 8.1 + MySQL**, para rodar
na HostGator (shared cPanel). Mantém o mesmo contrato de API do backend original,
então o frontend React continua igual (só muda `VITE_API_URL`).

- **PHP puro + PDO** (sem framework), roteador próprio em `src/Core/Router.php`.
- Publica em `pedidos.guimarques.dev.br/api` (mesma origem do frontend → sem CORS).
- **Evolution API** (WhatsApp) e **Ollama** (IA de extração) continuam no PC,
  acessados por HTTPS via Cloudflare tunnel (`evolution.*` e `ollama.*`).

## Estrutura
```
index.php            front controller (webroot da API = pasta /api)
.htaccess            roteamento + bloqueio de src/config/bin/vendor/.env
src/Core/            Router, Db (PDO), Auth (JWT), Http, Input, Env, HttpError, Request
src/Modules/<X>/     um controller por módulo (mesmas rotas do Node)
src/Services/        Evolution, Ollama, AiExtractor, Pdf, QuotationWriter, WhatsappSync
config/schema.mysql.sql   schema do banco (importar no phpMyAdmin)
config/seed.php           cria o usuário admin
bin/sync-inbox.php        CLI do cron (sync diário do WhatsApp)
```

## Passo a passo de produção (cPanel)

1. **PHP 8.1+**: MultiPHP Manager → selecionar o domínio → PHP 8.1+. Garanta as
   extensões `pdo_mysql, mbstring, curl, json, gd, zip, fileinfo`.
2. **Banco MySQL**: cPanel → "MySQL Databases" → crie o banco e um usuário, dê
   todas as permissões. Anote nome/usuário/senha (formato `cpaneluser_xxx`).
3. **Schema**: phpMyAdmin → selecione o banco → Import → `config/schema.mysql.sql`.
4. **`.env`**: copie `.env.example` para `.env` (na pasta `/api`, fora do alcance
   web pelo `.htaccess`) e preencha DB_*, `JWT_SECRET`, `EVOLUTION_*`, `OLLAMA_URL`.
5. **Deploy**: o workflow `deploy-backend.yml` roda `composer install` e envia
   `backend-php/` para a subpasta `api/` por FTP (mesmos secrets do frontend).
   Alternativa manual: rode `composer install --no-dev` localmente e suba a pasta
   inteira (com `vendor/`) por FTP para `.../pedidos.guimarques.dev.br/api`.
6. **Admin**: no servidor (Terminal do cPanel ou cron único) rode
   `php /caminho/api/config/seed.php` → cria `admin@pedidopro.local` / `admin123`
   (troque a senha após o 1º login).
7. **Cron (sync WhatsApp)**: cPanel → Cron Jobs → adicione
   `0 7 * * * /usr/local/bin/php /home1/espac793/pedidos.guimarques.dev.br/api/bin/sync-inbox.php`
   (ajuste o caminho do PHP/CLI conforme o cPanel informar).
8. **Cloudflare (Ollama)**: no tunnel existente, adicione o public hostname
   `ollama.guimarques.dev.br → http://127.0.0.1:11434` (preservando as rotas
   atuais e o catch-all 404) e o CNAME proxied. Recomendado proteger com
   Cloudflare Access (service token) e preencher `OLLAMA_CF_ACCESS_CLIENT_*` no `.env`.

## Teste local
Requer PHP 8.1+ e um MySQL local com o schema aplicado.
```bash
composer install
cp .env.example .env   # ajuste DB_* para o MySQL local
php config/seed.php
php -S localhost:8000 index.php           # front controller como router
# frontend: VITE_API_URL=http://localhost:8000 npm run dev  (chama /api relativo)
curl -s localhost:8000/api/health
curl -s -X POST localhost:8000/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"admin@pedidopro.local","password":"admin123"}'
```
Antes de subir, valide a sintaxe: `find src -name '*.php' -print0 | xargs -0 -n1 php -l`.

## Notas de porte (PostgreSQL → MySQL)
- `RETURNING` → `lastInsertId()` + `SELECT` (helper `Db::insertReturning`).
- `= ANY($1::int[])` → `IN (?, ?, ...)` (`Db::inClause`).
- `COUNT(...) FILTER (WHERE i.active)` → `SUM(i.active = 1)`.
- `ORDER BY ... NULLS LAST` → `ORDER BY (col IS NULL), col`.
- `$1,$2` → `?`; `subtotal` continua coluna gerada (`AS (...) STORED`).
- Booleans voltam como 0/1 (PDO nativo); datetimes são convertidos para ISO na
  resposta JSON (`Http::normalize`) para o `new Date()` do frontend.
