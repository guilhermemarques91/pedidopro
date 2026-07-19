-- PedidoPro — Módulo Delivery: observações do pedido + controle de impressão.
-- 1) customer_notes: observação em nível de PEDIDO (ex.: "cliente precisa de talheres",
--    "cancelar apenas o que está em falta") — hoje só sobrevive crua em `raw`.
-- 2) printed_at: carimbo de impressão da comanda (evita reimpressão/duplicidade quando
--    o painel dispara a impressão automática nas 2 impressoras).
-- NÃO idempotente: o MySQL da HostGator não aceita "ADD COLUMN IF NOT EXISTS"
-- (dá erro de sintaxe). Rode os comandos abaixo UMA vez. Se alguma coluna já existir,
-- pule a linha correspondente (erro "Duplicate column name").
SET NAMES utf8mb4;

ALTER TABLE delivery_orders ADD COLUMN customer_notes TEXT NULL AFTER customer_phone;
ALTER TABLE delivery_orders ADD COLUMN printed_at     TIMESTAMP NULL AFTER concluded_at;
