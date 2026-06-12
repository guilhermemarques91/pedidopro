# PedidoPro — Guia de Desenvolvimento com Claude Code

> App de gestão de pedidos a fornecedores · Node.js + React + PostgreSQL · Evolution API
>
> **Ambiente:** Desenvolvimento no Windows 11 · Evolution API no Windows 10 (servidor local)

---

## Visão geral do ambiente

| Máquina | Sistema | Função |
|---------|---------|--------|
| Seu PC de trabalho | Windows 11 | Desenvolvimento com Claude Code |
| Servidor local | Windows 10 | Roda a Evolution API + PostgreSQL via Docker |

A comunicação entre o app e a Evolution API acontece pela rede local (IP fixo do servidor Win10).

---

## Parte A — Configurar o servidor Windows 10 (Evolution API)

### A1 — Instalar o Docker Desktop no Windows 10

1. Acesse [docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop)
2. Baixe a versão para **Windows**
3. Durante a instalação, mantenha marcado **"Use WSL 2 instead of Hyper-V"**
4. Reinicie o computador quando solicitado
5. Abra o Docker Desktop e aguarde o ícone na barra de tarefas ficar verde

Verifique:
```powershell
docker --version
docker compose version
```

### A2 — Criar a pasta da Evolution API

Abra o PowerShell e execute:

```powershell
mkdir C:\evolution-api
cd C:\evolution-api
```

### A3 — Criar o arquivo docker-compose.yml

Crie o arquivo `C:\evolution-api\docker-compose.yml` com o conteúdo abaixo.
Substitua `SUA_SENHA_AQUI` e `SUA_API_KEY_AQUI` por valores próprios:

```yaml
version: '3.9'

services:
  postgres:
    image: postgres:16
    container_name: evolution_postgres
    restart: always
    environment:
      POSTGRES_USER: evolution
      POSTGRES_PASSWORD: SUA_SENHA_AQUI
      POSTGRES_DB: evolution
    volumes:
      - evolution_postgres:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U evolution"]
      interval: 10s
      timeout: 5s
      retries: 5

  evolution-api:
    image: atendai/evolution-api:v2.1.1
    container_name: evolution_api
    restart: always
    ports:
      - "8080:8080"
    env_file:
      - .env
    volumes:
      - evolution_instances:/evolution/instances
    depends_on:
      postgres:
        condition: service_healthy

volumes:
  evolution_postgres:
  evolution_instances:
```

### A4 — Criar o arquivo .env da Evolution API

Crie o arquivo `C:\evolution-api\.env`:

```env
# URL de acesso (use o IP da máquina na rede local)
SERVER_URL=http://IP_DO_SERVIDOR_WIN10:8080

# Chave de autenticação da API — gere uma senha forte
AUTHENTICATION_API_KEY=SUA_API_KEY_AQUI

# Banco de dados (aponta para o container postgres acima)
DATABASE_ENABLED=true
DATABASE_CONNECTION_URI=postgresql://evolution:SUA_SENHA_AQUI@postgres:5432/evolution
DATABASE_CONNECTION_CLIENT_NAME=evolution_api

# Sessão
QRCODE_LIMIT=10
CONFIG_SESSION_PHONE_CLIENT=PedidoPro

# Redis (opcional mas recomendado para persistência de sessão)
CACHE_REDIS_ENABLED=false
```

> Para descobrir o IP do servidor Win10 na rede local: abra o CMD e digite `ipconfig`.
> Anote o valor de **"Endereço IPv4"** (ex: 192.168.1.50). Use esse IP no `SERVER_URL`.

### A5 — Subir a Evolution API

No PowerShell dentro de `C:\evolution-api`:

```powershell
docker compose up -d
```

Aguarde os containers iniciarem e verifique:

```powershell
# Deve retornar: {"status":200,"message":"Welcome to the Evolution API..."}
curl http://localhost:8080
```

### A6 — Configurar inicialização automática

Para a Evolution API subir automaticamente com o Windows:

1. Pressione `Win + R`, digite `shell:startup` e pressione Enter
2. Crie um arquivo `evolution-start.bat` com o conteúdo:

```bat
@echo off
cd /d C:\evolution-api
docker compose up -d
```

3. Salve o arquivo na pasta que abriu

### A7 — Criar a instância e escanear o QR Code

Com a API rodando, crie a instância pelo PowerShell (ou use o Postman):

```powershell
# Substitua SUA_API_KEY_AQUI pela chave definida no .env
curl -X POST http://localhost:8080/instance/create `
  -H "Content-Type: application/json" `
  -H "apikey: SUA_API_KEY_AQUI" `
  -d '{"instanceName": "pedidopro", "qrcode": true}'
```

Para ver o QR Code, acesse no navegador do servidor:
```
http://localhost:8080/instance/connect/pedidopro?apikey=SUA_API_KEY_AQUI
```

Escaneie com o WhatsApp do número que vai enviar os pedidos.
**Isso só precisa ser feito uma vez** — a sessão fica salva no volume Docker.

---

## Parte B — Configurar o Windows 11 para desenvolvimento

### B1 — Instalar o Git for Windows

1. Acesse [gitforwindows.org](https://gitforwindows.org) e baixe o instalador
2. Durante a instalação, nas opções de PATH, escolha:
   **"Git from the command line and also from 3rd-party software"**
3. Mantenha as demais opções padrão
4. Conclua a instalação

Verifique:
```powershell
git --version
```

### B2 — Instalar o Node.js no Windows 11

1. Acesse [nodejs.org](https://nodejs.org) e baixe a versão **LTS (v20+)**
2. Execute o instalador com as opções padrão
3. Reinicie o PowerShell após a instalação

Verifique:
```powershell
node -v   # deve mostrar v20.x.x ou superior
npm -v    # deve mostrar v10.x.x ou superior
```

### B3 — Instalar o Claude Code no Windows 11

Abra o **PowerShell como Administrador** (clique direito no menu Iniciar → Terminal (Admin)):

```powershell
irm https://claude.ai/install.ps1 | iex
```

Após a instalação, adicione ao PATH se o comando `claude` não for reconhecido:

```powershell
setx PATH "%PATH%;C:\Users\SEU_USUARIO\.local\bin"
```

Feche e reabra o PowerShell, depois verifique:

```powershell
claude --version
```

> **Dica:** Instale o **Windows Terminal** pela Microsoft Store para ter uma experiência melhor
> com abas, Git Bash e PowerShell no mesmo lugar.

---

## Parte C — Criar e configurar o projeto

### C1 — Criar o repositório no GitHub

1. Acesse [github.com/new](https://github.com/new)
2. Nome: `pedidopro`
3. Visibilidade: **Private**
4. Marque **"Add a README file"**
5. Clique em **Create repository**

### C2 — Clonar e abrir no Claude Code

Abra o PowerShell (ou Git Bash) no Windows 11:

```powershell
git clone https://github.com/SEU_USUARIO/pedidopro.git
cd pedidopro
claude
```

---

## Parte D — Prompts para o Claude Code

Execute cada etapa em ordem. Cole o prompt no Claude Code e aguarde a conclusão antes de prosseguir.

### D1 — Estrutura de pastas

```
Crie a estrutura completa de pastas para um monorepo com:

- /backend → API REST em Node.js + Express + TypeScript
- /frontend → React + Vite + TailwindCSS

Estrutura esperada do backend:
src/
  config/         → variáveis de ambiente, conexão DB
  modules/        → cada módulo com controller, service, routes, dto
    auth/
    categories/
    suppliers/
    items/
    quotations/
    orders/
    whatsapp/
    import/
  shared/
    middlewares/
    utils/
    types/
  app.ts
  server.ts

Estrutura esperada do frontend:
src/
  components/     → componentes reutilizáveis
  pages/          → uma pasta por tela
    Dashboard/
    Suppliers/
    Categories/
    Quotations/
    Orders/
    Import/
  services/       → chamadas à API
  hooks/
  store/          → estado global (Zustand)
  types/
  utils/
  App.tsx
  main.tsx

Crie também na raiz:
- .env.example
- .gitignore adequado para Node + React no Windows (inclua node_modules, dist, .env, *.local)

Não crie código de implementação ainda — só a estrutura de pastas e arquivos
vazios com comentário TODO no topo de cada um.
```

### D2 — Schema do banco de dados

```
Crie o arquivo backend/src/config/schema.sql com o schema completo
do PostgreSQL para o sistema PedidoPro.

Tabelas necessárias:

users
  id, name, email, password_hash, role (admin|buyer|approver), active, created_at

categories
  id, name, color, icon, active, created_at

suppliers
  id, name, contact_name, phone, email, category_id (FK),
  order_type (portal|whatsapp), portal_url, whatsapp_number,
  notes, active, created_at

items
  id, supplier_id (FK), name, unit, package_size, package_unit,
  base_price, active, created_at

quotations
  id, title, status (draft|active|closed), created_by (FK users),
  created_at, closed_at

quotation_items
  id, quotation_id (FK), item_id (FK), supplier_id (FK),
  price, quantity, notes, source (manual|excel|pdf|image|whatsapp),
  extracted_by_ai (boolean), reviewed (boolean), created_at

price_history
  id, item_id (FK), supplier_id (FK), price, quotation_id (FK),
  recorded_at

orders
  id, supplier_id (FK), quotation_id (FK, nullable),
  status (draft|pending_approval|approved|sent|received|cancelled),
  total_amount, notes, created_by (FK users),
  approved_by (FK users, nullable), approved_at,
  sent_at, received_at, created_at

order_items
  id, order_id (FK), item_id (FK), quantity, unit_price, subtotal, notes

order_approvals
  id, order_id (FK), action (approved|rejected), user_id (FK),
  comment, created_at

imports
  id, filename, status (pending|processing|done|error),
  total_rows, imported_rows, error_rows, error_log (jsonb),
  created_by (FK users), created_at

Inclua índices nas FKs e campos de busca frequente.
Use DEFAULT NOW() nos timestamps e soft delete via campo active.
```

### D3 — Variáveis de ambiente

```
Crie o arquivo .env.example com todas as variáveis necessárias,
incluindo comentários explicativos:

# Servidor
PORT=3001
NODE_ENV=development

# Banco de dados (PostgreSQL local para dev)
DATABASE_URL=postgresql://user:password@localhost:5432/pedidopro_dev

# Auth
JWT_SECRET=
JWT_EXPIRES_IN=7d

# Evolution API — servidor Windows 10 na rede local
EVOLUTION_API_URL=http://192.168.1.50:8080
EVOLUTION_API_KEY=
EVOLUTION_INSTANCE=pedidopro

# Claude API (extração de preços por IA)
ANTHROPIC_API_KEY=

# Frontend
VITE_API_URL=http://localhost:3001

Depois crie backend/src/config/env.ts que faz parse e validação dessas
variáveis com zod, lançando erro claro se alguma obrigatória estiver faltando.
```

### D4 — Instalar dependências

```
Configure e instale as dependências do projeto:

Backend (backend/package.json):
Produção: express, cors, helmet, compression, pg, jsonwebtoken,
bcryptjs, zod, multer, xlsx, pdf-parse, @anthropic-ai/sdk, axios, dotenv

Dev: typescript, ts-node-dev, @types/node, @types/express,
@types/jsonwebtoken, @types/bcryptjs, @types/multer,
@types/cors, @types/compression, @types/pg

Scripts:
  dev: ts-node-dev --respawn --transpile-only src/server.ts
  build: tsc
  start: node dist/server.js

Crie também o tsconfig.json adequado para Node 20 com
outDir: ./dist e rootDir: ./src.

Frontend (frontend/):
Inicialize com Vite + React + TypeScript + TailwindCSS.
Dependências adicionais: axios, react-router-dom, zustand,
@tanstack/react-query, recharts, react-hook-form, zod, lucide-react

Instale tudo com npm install em cada pasta.
```

### D5 — Módulo de autenticação

```
Implemente o módulo de autenticação completo no backend:

1. backend/src/config/database.ts
   - Pool de conexão com pg usando DATABASE_URL
   - Função query<T>() helper tipada

2. backend/src/modules/auth/auth.routes.ts
   - POST /api/auth/login
   - GET  /api/auth/me (protegida)

3. backend/src/modules/auth/auth.controller.ts
4. backend/src/modules/auth/auth.service.ts
   - login: busca user por email, compara hash bcrypt, gera JWT
   - getMe: retorna dados do usuário autenticado

5. backend/src/shared/middlewares/auth.middleware.ts
   - Valida JWT no header Authorization: Bearer <token>
   - Injeta req.user com id, email, role

6. backend/src/app.ts e src/server.ts funcionais

Use bcryptjs e jsonwebtoken. SQL direto com pg, sem ORM.
Retorne erros HTTP adequados (400, 401, 403, 404).
```

### D6 — Integração com Evolution API

```
Implemente o módulo WhatsApp no backend:

backend/src/modules/whatsapp/whatsapp.service.ts

M�todos necessários:
1. sendMessage(to: string, message: string): Promise<void>
   - Faz POST para EVOLUTION_API_URL/message/sendText/EVOLUTION_INSTANCE
   - Header: { apikey: EVOLUTION_API_KEY }
   - Body: { number: to, text: message }
   - Lança erro claro se a API retornar falha

2. formatOrderMessage(order: Order, items: OrderItem[]): string
   - Monta a mensagem de pedido formatada para WhatsApp
   - Exemplo de formato:
     🛒 *Pedido #123 — PedidoPro*
     📅 Data: 11/06/2026
     
     • 5x Frango (kg) — R$ 12,90/un
     • 10x Embalagem 500ml — R$ 0,85/un
     
     *Total: R$ 73,00*
     
     Confirmar recebimento respondendo esta mensagem.

3. checkConnection(): Promise<boolean>
   - Verifica se a instância está conectada
   - GET EVOLUTION_API_URL/instance/connectionState/EVOLUTION_INSTANCE

Crie também backend/src/modules/whatsapp/whatsapp.routes.ts com:
   - POST /api/whatsapp/test → envia mensagem de teste (admin only)
   - GET  /api/whatsapp/status → retorna status da conexão
```

### D7 — CI/CD para HostGator

```
Crie .github/workflows/deploy.yml para deploy automático
via SSH a cada push na branch main.

O pipeline deve:
1. Checkout do código
2. Setup Node 20
3. Build do backend (npm ci + tsc)
4. Build do frontend (npm ci + vite build)
5. SSH no servidor usando secrets:
   HOSTGATOR_HOST, HOSTGATOR_USER, HOSTGATOR_SSH_KEY, HOSTGATOR_PORT
6. No servidor:
   - git pull origin main
   - npm ci --omit=dev no backend
   - cp frontend/dist para pasta pública
   - pm2 restart pedidopro || pm2 start ecosystem.config.js

Crie também ecosystem.config.js na raiz:
  name: pedidopro
  script: backend/dist/server.js
  instances: 1
  watch: false
  env_production: { NODE_ENV: production }

Adicione README.md com instruções de setup local e deploy.
```

---

## Ordem de implementação dos módulos

Após o setup inicial funcionando:

| # | Módulo | Descrição |
|---|--------|-----------|
| 1 | **Auth** | Login, JWT, middleware (feito no D5) |
| 2 | **Categories** | CRUD simples |
| 3 | **Suppliers** | Cadastro com tipo portal/whatsapp |
| 4 | **Items** | Itens por fornecedor |
| 5 | **Import** | Upload .xlsx, preview, gravação |
| 6 | **Quotations** | Criação e entrada de preços (manual) |
| 7 | **Price extraction** | Upload PDF/imagem → Claude API |
| 8 | **Orders** | Geração, aprovação, histórico |
| 9 | **WhatsApp** | Formatação + envio via Evolution API (feito no D6) |
| 10 | **Dashboard** | Gráficos de preço e volume de pedidos |

---

## Dicas para trabalhar com o Claude Code no Windows

- **Use o Windows Terminal** — melhor que o PowerShell padrão; abas, Git Bash e PowerShell juntos
- **Abra sempre na pasta do projeto** — `cd pedidopro` antes de digitar `claude`
- **Seja específico por módulo** — peça um módulo por vez
- **Revise e teste antes de continuar** — rode `npm run dev` após cada etapa
- **Use `/clear` ao trocar de módulo** — limpa o contexto para focar no que importa
- **Commit a cada módulo funcional** — facilita rollback e mantém histórico limpo
- **Para erros**: cole a mensagem de erro exata — o Claude Code resolve na hora

---

## Referências

- [Documentação Evolution API v2](https://doc.evolution-api.com/v2/pt/get-started/introduction)
- [Docker Desktop para Windows](https://www.docker.com/products/docker-desktop)
- [Claude Code — Setup no Windows](https://code.claude.com/docs/pt/setup)
- [Git for Windows](https://gitforwindows.org)
- [PM2 — Process Manager](https://pm2.keymetrics.io/docs/usage/quick-start/)
