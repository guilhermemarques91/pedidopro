#!/bin/bash
# Smoke tests do PedidoPro ERP — roda contra o stack Docker local.
#
#   ./scripts/smoke.sh            # usa http://127.0.0.1:8090
#   BASE=http://host:porta ./scripts/smoke.sh
#
# Valida: health, login por username, guards de permissão (403/200 por papel e
# por override), isolamento entre organizações (org 2 não vê dados da org 1) e
# migrations em dia. Cria dados de teste idempotentes (usuários smoke_*, org 2).
# Requer: curl; docker compose (para o passo de org 2 e migrate --status).
set -u

BASE="${BASE:-http://127.0.0.1:8090}"
API="$BASE/api"
ADMIN_USER="${ADMIN_USER:-admin}"
ADMIN_PASS="${ADMIN_PASS:-admin123}"
PASS=0; FAIL=0

say()  { printf '%s\n' "$*"; }
ok()   { PASS=$((PASS+1)); say "  ✔ $1"; }
bad()  { FAIL=$((FAIL+1)); say "  ✘ $1"; }
check(){ # check <descricao> <esperado> <obtido>
  if [ "$2" = "$3" ]; then ok "$1 ($3)"; else bad "$1 (esperado $2, obtido $3)"; fi
}
code(){ curl -s -o /dev/null -w '%{http_code}' "$@"; }
JH='Content-Type: application/json'

token(){ # token <user> <pass> -> imprime o token (vazio se falhou)
  curl -s -X POST "$API/auth/login" -H "$JH" -d "{\"username\":\"$1\",\"password\":\"$2\"}" \
    | sed -En 's/.*"token":"([^"]+)".*/\1/p'
}

say "== Saúde e autenticação =="
check "GET /health" 200 "$(code "$API/health")"
AT=$(token "$ADMIN_USER" "$ADMIN_PASS")
[ -n "$AT" ] && ok "login admin" || bad "login admin"
AH="Authorization: Bearer $AT"
check "login com senha errada -> 401" 401 "$(code -X POST "$API/auth/login" -H "$JH" -d '{"username":"admin","password":"errada"}')"
check "GET /users sem token -> 401" 401 "$(code "$API/users")"

say "== Guards por permissão (usuário só-leitura via override) =="
# cria (ou reutiliza) usuário buyer com override só compras:read
curl -s -o /dev/null -X POST "$API/users" -H "$AH" -H "$JH" \
  -d '{"name":"Smoke ReadOnly","username":"smoke_ro","password":"smoke123","role":"buyer","permissions":["compras:read"]}'
RT=$(token smoke_ro smoke123)
[ -n "$RT" ] && ok "login smoke_ro" || bad "login smoke_ro"
RH="Authorization: Bearer $RT"
check "smoke_ro GET /suppliers -> 200" 200 "$(code "$API/suppliers" -H "$RH")"
check "smoke_ro POST /suppliers -> 403 (override tirou write)" 403 "$(code -X POST "$API/suppliers" -H "$RH" -H "$JH" -d '{}')"
check "smoke_ro GET /users -> 403" 403 "$(code "$API/users" -H "$RH")"
check "smoke_ro GET /audit -> 403" 403 "$(code "$API/audit" -H "$RH")"
check "smoke_ro GET /delivery/orders -> 403 (sem delivery:operate)" 403 "$(code "$API/delivery/orders" -H "$RH")"
check "admin GET /audit -> 200" 200 "$(code "$API/audit" -H "$AH")"

say "== Isolamento entre organizações =="
# org 2 + usuário da org 2 direto no banco (não há API de orgs ainda)
HASH=$(docker compose exec -T app php -r "echo password_hash('smoke123', PASSWORD_BCRYPT);" 2>/dev/null)
docker compose exec -T db mysql -uroot -p"${DB_ROOT_PASS:-root_pedidopro}" "${DB_NAME:-pedidopro}" 2>/dev/null <<SQL
INSERT INTO organizations (id, name, slug) VALUES (2, 'Org Smoke', 'org-smoke')
  ON DUPLICATE KEY UPDATE name = VALUES(name);
INSERT INTO users (name, username, password_hash, role, org_id)
  SELECT 'Smoke Org2', 'smoke_org2', '$HASH', 'buyer', 2
  WHERE NOT EXISTS (SELECT 1 FROM users WHERE username = 'smoke_org2');
SQL
if [ $? -ne 0 ]; then
  bad "preparar org 2 no banco (docker compose exec db)"
else
  O2=$(token smoke_org2 smoke123)
  [ -n "$O2" ] && ok "login smoke_org2 (org 2)" || bad "login smoke_org2 (org 2)"
  OH="Authorization: Bearer $O2"
  # garante ao menos 1 categoria na org 1 e captura o id
  curl -s -o /dev/null -X POST "$API/categories" -H "$AH" -H "$JH" -d '{"name":"Smoke Cat"}'
  CAT_ID=$(curl -s "$API/categories" -H "$AH" | sed -En 's/.*"id":([0-9]+),"name":"Smoke Cat".*/\1/p' | head -1)
  ORG1_COUNT=$(curl -s "$API/suppliers" -H "$AH" | grep -o '"id":' | wc -l | tr -d ' ')
  ORG2_SUP=$(curl -s "$API/suppliers" -H "$OH")
  [ "$ORG2_SUP" = "[]" ] && ok "org 2 vê 0 fornecedores (org 1 tem $ORG1_COUNT)" || bad "org 2 NÃO deveria ver fornecedores: $ORG2_SUP"
  ORG2_CATS=$(curl -s "$API/categories" -H "$OH")
  [ "$ORG2_CATS" = "[]" ] && ok "org 2 vê 0 categorias" || bad "org 2 NÃO deveria ver categorias: $ORG2_CATS"
  if [ -n "${CAT_ID:-}" ]; then
    check "org 2 GET categoria da org 1 -> 404" 404 "$(code "$API/categories/$CAT_ID" -H "$OH")"
  fi
  ORG2_PROD=$(curl -s "$API/products" -H "$OH")
  [ "$ORG2_PROD" = "[]" ] && ok "org 2 vê 0 produtos" || bad "org 2 NÃO deveria ver produtos: ${ORG2_PROD:0:120}"
fi

say "== Migrations =="
PEND=$(docker compose exec -T app php /var/www/html/api/config/migrate.php --status 2>/dev/null | sed -En 's/^Pendentes \(([0-9]+)\).*/\1/p')
check "migrations pendentes = 0" 0 "${PEND:-erro}"

say ""
say "Resultado: $PASS ok, $FAIL falha(s)"
[ "$FAIL" -eq 0 ]
