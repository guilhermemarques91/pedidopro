# Deploy do PedidoPro na HostGator — passo a passo detalhado

Guia clique-a-clique para colocar a **API PHP + MySQL** no ar na HostGator,
na subpasta `/api` do subdomínio `pedidos.guimarques.dev.br` (mesma origem do
frontend). Faça **na ordem**. A virada final (passo 8) só depois de tudo testado.

> Dados conhecidos do ambiente (da config atual):
> - Document root do subdomínio: `/home1/espac793/pedidos.guimarques.dev.br`
> - Usuário cPanel: `espac793` · FTP de deploy: `deploy@pedidos.guimarques.dev.br` (IP `216.172.172.52`)
> - A pasta da API será `/home1/espac793/pedidos.guimarques.dev.br/api`

---

## 1. PHP 8.1+ no domínio
1. cPanel → seção **Software** → **MultiPHP Manager**.
2. Marque o domínio `pedidos.guimarques.dev.br` na lista.
3. No topo, em **PHP Version**, escolha **8.1** (ou 8.2/8.3) → **Apply**.
4. (Opcional) **MultiPHP INI Editor** → selecione o domínio → confira/ative:
   `upload_max_filesize = 25M`, `post_max_size = 25M`, `max_execution_time = 120`
   (a extração de PDF/planilha grande pode passar dos 30s padrão).
5. Extensões: em planos cPanel padrão já vêm `pdo_mysql, mbstring, curl, json,
   gd, zip, fileinfo`. Se houver **"Select PHP Version" → Extensions**, confirme
   que estão marcadas.

## 2. Criar o banco MySQL
1. cPanel → **Databases** → **MySQL® Databases**.
2. **Create New Database**: nome `pedidopro` → vira `espac793_pedidopro`. Anote.
3. **MySQL Users → Add New User**: usuário `pedidopro`, senha forte (gere e
   guarde) → vira `espac793_pedidopro`. Anote usuário e senha.
4. **Add User To Database**: selecione o usuário + o banco → **Add** →
   marque **ALL PRIVILEGES** → **Make Changes**.

## 3. Importar o schema
1. cPanel → **Databases** → **phpMyAdmin**.
2. No painel esquerdo, clique no banco `espac793_pedidopro`.
3. Aba **Import** (Importar) → **Choose File** → selecione
   `backend-php/config/schema.mysql.sql` (do seu PC) → role até o fim → **Go**.
4. Deve criar 14 tabelas (users, categories, suppliers, products, items,
   quotations, quotation_items, price_history, orders, order_items,
   order_approvals, purchase_requests, purchase_request_items, imports,
   inbox_prices). Se der erro de `CHECK`/`GENERATED`, a versão do MySQL é antiga
   — me avise (há um fallback sem essas cláusulas).

## 4. Subir o código da API
**Opção A — automática (recomendada):** ver passo 6 (GitHub Actions). Na primeira
vez pode subir manualmente para validar.

**Opção B — manual (FTP/Gerenciador de Arquivos):**
1. No seu PC, dentro de `backend-php/`, gere o `vendor/`:
   `composer install --no-dev --optimize-autoloader`
2. cPanel → **Files** → **File Manager** → navegue até
   `pedidos.guimarques.dev.br` → **+ Folder** → crie `api`.
3. Envie para dentro de `api/` **todo** o conteúdo de `backend-php/` EXCETO
   `.env` (NÃO suba o `.env`): `index.php`, `.htaccess`, `src/`, `config/`,
   `bin/`, `vendor/`, `composer.json`. (Por FTP é mais rápido para o `vendor/`.)

## 5. Criar o `.env` no servidor
1. File Manager → entre em `.../api` → **+ File** → nome `.env`.
2. Selecione `.env` → **Edit** → cole o conteúdo abaixo, preenchendo com os
   dados do passo 2 e uma chave JWT longa e aleatória:
   ```
   DB_HOST=localhost
   DB_PORT=3306
   DB_NAME=espac793_pedidopro
   DB_USER=espac793_pedidopro
   DB_PASS=A_SENHA_DO_PASSO_2
   JWT_SECRET=<gere 40+ caracteres aleatórios>
   JWT_EXPIRES_DAYS=7
   EVOLUTION_API_URL=https://evolution.guimarques.dev.br
   EVOLUTION_API_KEY=<chave global da Evolution>
   EVOLUTION_INSTANCE=pedidopro
   OLLAMA_URL=https://ollama.guimarques.dev.br
   OLLAMA_MODEL=qwen2.5:3b
   INBOX_SYNC_DAYS=2
   INBOX_SYNC_ENABLED=true
   CORS_ORIGINS=
   APP_ENV=production
   ```
   > `DB_HOST=localhost` é o normal no cPanel (socket local). O `.htaccess` já
   > bloqueia o acesso web ao `.env`.
3. **Teste rápido:** no navegador, abra `https://pedidos.guimarques.dev.br/api/health`
   → deve responder `{"status":"ok"}`.

## 6. Deploy automático (GitHub Actions) — opcional mas recomendado
Os secrets de FTP já existem (usados pelo frontend). O `deploy-backend.yml` usa
os mesmos e envia para `${FTP_SERVER_DIR}api/`. Como `FTP_SERVER_DIR=/`, ele cai
em `.../api/`. Nada a configurar além do que já existe. A cada push na `main` que
toque `backend-php/**`, ele roda `composer install` e publica (sem o `.env`).

## 7. Criar o usuário admin (seed) e o cron
1. cPanel → **Advanced** → **Terminal** (se disponível) e rode:
   `php /home1/espac793/pedidos.guimarques.dev.br/api/config/seed.php`
   → cria `admin@pedidopro.local` / `admin123` (troque a senha após o 1º login).
   - Sem Terminal: cPanel → **Cron Jobs** → crie um cron "uma vez" (ex.: para
     daqui a 2 min) com o comando acima; depois apague esse cron.
2. **Cron do sync de WhatsApp:** cPanel → **Cron Jobs** → **Add New Cron Job**:
   - Common Settings: **Once Per Day (0 0 * * *)** e ajuste a hora para 07:00
     (Minute `0`, Hour `7`).
   - Command:
     `/usr/local/bin/php /home1/espac793/pedidos.guimarques.dev.br/api/bin/sync-inbox.php`
   - Se `/usr/local/bin/php` não existir, descubra o caminho com um cron único
     `which php` ou veja em MultiPHP; às vezes é `/opt/cpanel/ea-php81/root/usr/bin/php`.

## 8. Virada (cutover) — só depois de tudo acima testado
1. Faça o **merge** da branch `migracao-php-mysql` na `main` (ou push na main).
   Isso dispara os dois workflows: frontend rebuilda chamando `/api` e a API PHP
   é publicada.
2. Abra `https://pedidos.guimarques.dev.br`, faça login com o admin, e teste:
   criar fornecedor/item, uma lista de compras, gerar pedido, enviar WhatsApp.
3. Confirme a caixa de entrada e a extração por IA (depende do passo Cloudflare
   do Ollama — ver `README.md` / o tunnel).
4. Só então **desligue o ingress `pedidopro-api.*`** do tunnel (não precisa mais).
   Mantenha `evolution.*` e `ollama.*`.

## Rollback rápido
Se algo falhar após a virada: reverta o commit de troca do `VITE_API_URL`
(volte para `https://pedidopro-api.guimarques.dev.br`) e rebuild do frontend —
o app volta a usar o backend Node local enquanto você investiga. O backend Node
em `backend/` continua intacto no repositório.
