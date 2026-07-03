# Rodar o PedidoPro local na rede (Docker)

Roda igual em **Zorin OS** e **Windows** (Docker Engine / Docker Desktop). Reproduz o layout
da HostGator dentro de containers: **frontend em `/`** e **API em `/api`**, mesma origem
(sem CORS), funcionando offline contra um MySQL local.

## Subir

```bash
# 1. (opcional) configurar variáveis
cp .env.docker.example .env      # ajuste senhas/porta

# 2. buildar e subir
docker compose up -d --build

# 3. criar o usuário admin inicial (só na primeira vez)
docker compose exec app php /var/www/html/api/config/seed.php
#   -> admin@pedidopro.local / admin123  (troque depois de logar)
```

Acesse: **http://127.0.0.1:8090** (ou a porta em `APP_PORT`).

> **Windows/Docker Desktop:** use `127.0.0.1` (e não `localhost`) — o `localhost` pode
> resolver para IPv6 (`::1`) e a conexão fica pendurada. Pela LAN (IP IPv4) não há esse problema.
> A porta padrão é **8090** porque a 8080 costuma estar ocupada pela Evolution API (WhatsApp).

## Acessar de outro PC/tablet na LAN

1. Descubra o IP do PC-servidor (ex.: `192.168.0.10`). Recomenda-se **IP fixo** (reserva DHCP).
2. No tablet/PC, abra `http://192.168.0.10:8090`.
3. Libere a porta no firewall do SO servidor, se necessário.

## Comandos úteis

```bash
docker compose logs -f app        # logs da aplicação
docker compose logs -f db         # logs do banco
docker compose down               # parar (mantém os dados no volume db_data)
docker compose down -v            # parar e APAGAR o banco (reinit no próximo up)
docker compose exec db mysql -upedidopro -p pedidopro   # abrir o MySQL
```

## Como o banco é inicializado

Duas etapas, com responsabilidades separadas:

1. **Schema base** — no **primeiro** boot (volume vazio), o container do MySQL
   aplica `backend-php/config/schema.mysql.sql` via `docker/db-init/10-apply.sh`.
   (Esse container é a imagem `mysql`, sem PHP — por isso só cuida do schema.)
2. **Migrations** — a cada boot, o container do **app** roda o runner
   `backend-php/config/migrate.php` (via `docker/entrypoint.sh`, antes do Apache).
   Cada migration de `backend-php/config/migrations/` roda **uma vez**, na ordem,
   registrada na tabela `schema_migrations`.

O runner "adota" o baseline: o schema consolidado já embute várias migrations
(001-003, 005_marmitex, 007_item_suppliers), então na primeira execução ele
marca essas como aplicadas (e sonda as tabelas de delivery, cobrindo volumes
legados) e aplica só o que falta. Comandos úteis:

```bash
docker compose exec app php /var/www/html/api/config/migrate.php            # aplica pendentes
docker compose exec app php /var/www/html/api/config/migrate.php --status   # aplicadas x pendentes
docker compose exec app php /var/www/html/api/config/migrate.php --baseline # adoção manual (não roda DDL)
```

Nova migration = adicionar `NNN_descricao.sql` em `backend-php/config/migrations/`
(número maior que o último) e reiniciar o app (`docker compose up -d`) ou rodar o
comando acima. Para reaplicar tudo do zero: `docker compose down -v && docker compose up -d`.

## Backup (esboço — Etapa 0B)

```bash
docker compose exec db sh -c 'mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"' > backup.sql
```

Automatizar via cron do host + cópia off-site (nuvem) quando houver internet.

## Acesso remoto pela internet

Expor via **Cloudflare Tunnel** apontando para `http://localhost:8080` (mesma URL pública
já usada no ambiente). Protege atrás de **Cloudflare Access** ou VPN (Tailscale).
