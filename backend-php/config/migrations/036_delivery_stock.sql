-- Baixa de estoque por ficha técnica nos pedidos de delivery.
-- Carimbo de idempotência: NULL = ainda não baixou; preenchido = já baixou (não repete).
-- O estorno (cancelamento) devolve os insumos e volta a coluna para NULL.
ALTER TABLE delivery_orders ADD COLUMN stock_consumed_at TIMESTAMP NULL;
