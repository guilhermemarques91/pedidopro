# Cutover: HostGator → ERP local (Docker)

Runbook para desligar o PedidoPro hospedado (pedidos.guimarques.dev.br) e operar
**só pelo ERP local** (`D:\pedidos-erp`, Docker na LAN, porta 8090).

Estado ao escrever (2026-07-19): código 100% integrado (branch `integ/delivery-merge`
contém todo o `main` e todo o `erp-local`); banco local **sem** os dados de produção
(canais, cardápio, histórico); ferramentas de migração prontas (`scripts/import-prod.sh`
+ `backend-php/bin/import-prod-data.php`); serviço `poller` no compose; `.env` local
com `INTEGRATIONS_MOCK=0`.

## Visão geral

| Função no HostGator            | Substituto local                                          |
|--------------------------------|-----------------------------------------------------------|
| Painel/API (pedidos.guimarques.dev.br) | Docker `:8090` na LAN (+ Cloudflare Tunnel p/ acesso externo) |
| Cron `poll.php` (iFood polling + reconciliação 99Food) | serviço `poller` do docker-compose (já sobe junto) |
| Webhook 99Food (`/api/webhooks/99food`) | mesmo endpoint local, exposto por hostname do Cloudflare Tunnel |
| Cron `geocode-backfill.php`    | agendar no host (Task Scheduler) ou botão "Atualizar localizações" na tela Mapa |
| Login das empresas do Marmitex | mesmo hostname do tunnel (o domínio de acesso MUDA para elas) |

## Fase 1 — Dados (HostGator ainda no ar)

1. **Backup completo** do MySQL no phpMyAdmin do cPanel (guardar o arquivo).
2. **Export para migração**: mesmas telas, mas **desmarcar "Add CREATE DATABASE / USE"**
   (o dump deve ter só CREATE TABLE/INSERT). Pode exportar o banco inteiro — o
   importador só lê as tabelas de delivery/marmitex/cardápio.
3. No PC, com o stack de pé:
   ```bash
   scripts/import-prod.sh caminho/do/dump.sql --dry-run   # confere o plano
   scripts/import-prod.sh caminho/do/dump.sql             # importa de fato
   ```
   O que ele faz: carrega o dump numa base auxiliar `pedidopro_prod`, copia por
   interseção de colunas (org_id etc. ficam com DEFAULT 1) as tabelas de canais,
   pedidos de delivery, cardápio mestre, loja/geocode e Marmitex (incl. logins
   `role=company`; username sintetizado do e-mail — **avisar as empresas**).
   O que ele NÃO migra (proposital): compras/produtos/usuários internos — o
   catálogo local (AllFood) é a fonte da verdade; histórico fica no backup.
4. Conferir no painel local: Integrações (2 canais), Cardápio (7 cat/32 itens),
   Delivery (histórico), Marmitex (empresas). Depois remover a base auxiliar
   (o importador imprime o comando).

## Fase 2 — Rota pública (webhook 99Food + acesso externo)

1. No Cloudflare Tunnel (já roda neste PC): criar/reapontar um hostname para
   `http://localhost:8090`. **Decidir**: reusar `pedidopro-api.guimarques.dev.br`
   (confirmar que nada mais depende dele) ou criar `erp.guimarques.dev.br`.
2. Testar de fora: `https://<hostname>/api/webhooks/99food` deve responder
   (POST vazio dá 40x — ok, o endpoint existe).
3. **Portal 99Food**: trocar o *Callback address* do app para
   `https://<hostname>/api/webhooks/99food`.
4. iFood não precisa de URL (polling) — o `poller` local já cobre, com as
   credenciais que vieram na tabela `channels`.

## Fase 3 — Validação em paralelo (os dois no ar)

Rodar 1+ dia com ambos ativos. O ingest é idempotente (platform+order_id), MAS:
**operar (confirmar/despachar) só num painel** — o local. No HostGator, desligar
o cron do `poll.php` e o auto_confirm dos canais (senão os dois confirmam).

Checklist de validação no local:
- [ ] Pedido real do 99Food entra via webhook (ver `docker compose logs -f app`)
- [ ] Pedido real do iFood entra via poller (`docker compose logs -f poller`)
- [ ] Confirmar/despachar/concluir funcionam (comandos chegam na plataforma)
- [ ] Localizador + endereço no card; mapa geocodifica
- [ ] Empresa do Marmitex consegue logar pelo hostname novo

## Fase 4 — Desligar o HostGator

1. cPanel: **desativar os crons** (`poll.php`, `geocode-backfill.php`).
2. Desativar os workflows de deploy (`deploy.yml`/`deploy-backend.yml`) ou
   arquivar — push no `main` não deve mais publicar nada.
3. Deixar o site no ar por ~2 semanas como contingência (ou colocar uma página
   "mudamos de endereço" p/ as empresas do Marmitex).
4. Endurecer o local: no `.env` da raiz, descomentar `APP_ENV=production` +
   `JWT_SECRET` forte (+ senhas de DB), `docker compose up -d` — todo mundo
   reloga. Agendar `scripts/backup.sh` no host + cópia off-site.

## Pendências conhecidas

- Impressão de comanda (QZ Tray) ficou fora do merge — reativar depois adaptada
  ao runtime local (o poller local pode voltar a chamar AutoPrintService).
- `marmitex_orders.created_by` importado guarda ids de usuário antigos
  (informativo, sem FK — não quebra nada).
- Dep `textalk/websocket` órfã no composer (era do QZ) — remover quando mexer no lock.
