# PedidoPro

App de gestão de pedidos a fornecedores — comparação de preços, geração de pedidos, aprovação e envio por WhatsApp.

**Stack:** Node.js + Express + TypeScript · React + Vite + TailwindCSS · PostgreSQL · Evolution API (WhatsApp) · Claude API (extração de preços).

## Estrutura

```
backend/    API REST (Express + TypeScript, SQL puro com pg)
frontend/   SPA React (Vite + Tailwind 4)
```

## Setup local (Windows)

### Pré-requisitos
- Node.js 20+
- PostgreSQL 14+ rodando localmente

### 1. Banco de dados
```powershell
# Cria o banco e aplica o schema
& "C:\Program Files\PostgreSQL\14\bin\psql.exe" -U postgres -h localhost -c "CREATE DATABASE pedidopro_dev"
& "C:\Program Files\PostgreSQL\14\bin\psql.exe" -U postgres -h localhost -d pedidopro_dev -f backend/src/config/schema.sql
```

### 2. Backend
```powershell
cd backend
copy ..\.env.example .env   # preencha os valores (DATABASE_URL, JWT_SECRET, etc.)
npm install
npm run seed                # cria usuário admin de teste
npm run dev                 # http://localhost:3001
```

Usuário admin padrão (dev): `admin@pedidopro.local` / `admin123`

### 3. Frontend
```powershell
cd frontend
npm install
npm run dev                 # http://localhost:5173
```

## Variáveis de ambiente

Veja [.env.example](.env.example). Obrigatórias: `DATABASE_URL`, `JWT_SECRET`, `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`, `ANTHROPIC_API_KEY`.

## Módulos da API

| Endpoint base | Módulo | Status |
|---|---|---|
| `/api/auth` | Autenticação (JWT) | ✅ |
| `/api/categories` | Categorias | ✅ |
| `/api/suppliers` | Fornecedores | ✅ |
| `/api/whatsapp` | Integração Evolution API | ✅ (aguarda config Evolution) |
| `/api/items` | Itens por fornecedor | ⏳ |
| `/api/import` | Importação de planilhas | ⏳ |
| `/api/quotations` | Cotações | ⏳ |
| `/api/orders` | Pedidos + aprovação | ⏳ |

## Deploy

CI/CD via GitHub Actions ([.github/workflows/deploy.yml](.github/workflows/deploy.yml)) — deploy por SSH a cada push na `main`. Process manager: PM2 ([ecosystem.config.js](ecosystem.config.js)).

Secrets necessários no repositório: `HOSTGATOR_HOST`, `HOSTGATOR_USER`, `HOSTGATOR_SSH_KEY`, `HOSTGATOR_PORT`.
