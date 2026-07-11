-- PedidoPro — Módulo Delivery: observações do pedido + controle de impressão.
-- 1) customer_notes: observação em nível de PEDIDO (ex.: "cliente precisa de talheres",
--    "cancelar apenas o que está em falta") — hoje só sobrevive crua em `raw`.
-- 2) printed_at: carimbo de impressão da comanda (evita reimpressão/duplicidade quando
--    o painel dispara a impressão automática nas 2 impressoras).
-- Idempotente: ADD COLUMN IF NOT EXISTS (MariaDB do cPanel/HostGator suporta).
SET NAMES utf8mb4;

ALTER TABLE delivery_orders
  ADD COLUMN IF NOT EXISTS customer_notes TEXT NULL AFTER customer_phone,
  ADD COLUMN IF NOT EXISTS printed_at     TIMESTAMP NULL AFTER concluded_at;
