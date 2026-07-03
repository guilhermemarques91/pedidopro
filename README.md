# PedidoPro

App de gestão de pedidos a fornecedores — comparação de preços, geração de pedidos, aprovação e envio por WhatsApp. Em evolução para um ERP local abrangente (ver [docker/README.md](docker/README.md)).

**Stack:** PHP 8.3 (puro + PDO) · MySQL 8 · React + Vite + TailwindCSS · Evolution API (WhatsApp) · Ollama/Claude (extração de preços).

## Estrutura

```
backend-php/   API REST (PHP puro + PDO, front controller em index.php)
frontend/      SPA React (Vite + Tailwind 4)
backend/       API Node/TS LEGADA (substituída por backend-php/ — mantida só como referência)
docker/        Runtime local (Compose: app PHP/Apache + MySQL)
```

## Setup local (Docker — recomendado)

Sobe API PHP + MySQL num container só, igual em Windows (Docker Desktop) e Zorin/Linux. As migrations rodam sozinhas no boot ([backend-php/config/migrate.php](backend-php/config/migrate.php), via [docker/entrypoint.sh](docker/entrypoint.sh)).

```powershell
docker compose up -d --build                                            # sobe app + banco
docker compose exec app php /var/www/html/api/config/seed.php           # cria admin inicial (1ª vez)
```

- App/API: `http://127.0.0.1:8090` (API em `/api`). No Windows use `127.0.0.1`, não `localhost`.
- Admin padrão: `admin@pedidopro.local` / `admin123` (troque após logar).
- Detalhes (migrations, backup, acesso remoto): [docker/README.md](docker/README.md).

## Frontend em dev (Vite)

```powershell
cd frontend
npm install
npm run dev                 # http://localhost:5173
```

O Vite faz proxy de `/api` para o backend PHP em `http://127.0.0.1:8090` (ver [frontend/vite.config.ts](frontend/vite.config.ts)). Para apontar a outra porta/host: `API_PROXY_TARGET=http://127.0.0.1:PORTA npm run dev`. Ou seja, **suba o Docker antes** para o login/API funcionarem.

## Variáveis de ambiente

Backend: [backend-php/.env.example](backend-php/.env.example) (no Docker os valores vêm do [docker-compose.yml](docker-compose.yml)). O [.env.example](.env.example) da raiz é do backend Node legado.

## Módulos da API

| Endpoint base | Módulo | Status |
|---|---|---|
| `/api/auth` | Autenticação (JWT) | ✅ |
| `/api/categories` · `/api/suppliers` · `/api/items` · `/api/products` | Cadastros | ✅ |
| `/api/quotations` · `/api/orders` · `/api/requests` | Cotações, pedidos + aprovação, requisições | ✅ |
| `/api/import` | Importação de NF-e (xlsx) | ✅ |
| `/api/whatsapp` | Integração Evolution API | ✅ (aguarda config Evolution) |
| `/api/delivery` · `/api/channels` | Delivery (iFood + 99Food) + Merchant | ✅ |
| `/api/marmitex` | Catering B2B (marmitex) | ✅ |

## Deploy

CI/CD via GitHub Actions ([.github/workflows/deploy.yml](.github/workflows/deploy.yml)) — deploy por SSH a cada push na `main`. Process manager: PM2 ([ecosystem.config.js](ecosystem.config.js)).

Secrets necessários no repositório: `HOSTGATOR_HOST`, `HOSTGATOR_USER`, `HOSTGATOR_SSH_KEY`, `HOSTGATOR_PORT`.
