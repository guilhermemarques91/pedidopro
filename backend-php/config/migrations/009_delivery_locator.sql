-- PedidoPro — Módulo Delivery: localizador do pedido (código curto da plataforma).
-- 99Food: receive_address.locator. iFood: localizer/pickupCode (a confirmar no raw real).
-- MySQL da HostGator não aceita "ADD COLUMN IF NOT EXISTS": rode uma vez.
SET NAMES utf8mb4;

ALTER TABLE delivery_orders ADD COLUMN locator VARCHAR(40) NULL AFTER display_id;
