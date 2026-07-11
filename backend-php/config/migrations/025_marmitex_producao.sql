-- PedidoPro ERP — Baixa de estoque do Marmitex pela ficha técnica.
-- Ponte catálogo -> produto: cada tamanho/proteína/acompanhamento pode apontar para um
-- `products`. Ao FECHAR A PRODUÇÃO do pedido do dia, a receita desse produto é explodida
-- (recursivamente) e os insumos sofrem saída de estoque. Item sem product_id não
-- movimenta estoque (a UI sinaliza).
-- `marmitex_orders.status` ganha o valor 'produced' (era 'submitted' | 'cancelled');
-- produced_at é a guarda de idempotência (lida com FOR UPDATE na transação da baixa).
-- Aplicada pelo runner (config/migrate.php), uma vez.
SET NAMES utf8mb4;

ALTER TABLE marmitex_sizes
  ADD COLUMN product_id INT NULL AFTER price,
  ADD CONSTRAINT fk_marmitex_sizes_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL;

ALTER TABLE marmitex_proteins
  ADD COLUMN product_id INT NULL AFTER name,
  ADD CONSTRAINT fk_marmitex_proteins_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL;

ALTER TABLE marmitex_sides
  ADD COLUMN product_id INT NULL AFTER name,
  ADD CONSTRAINT fk_marmitex_sides_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL;

ALTER TABLE marmitex_orders
  ADD COLUMN produced_at TIMESTAMP NULL AFTER status,
  ADD COLUMN produced_by INT NULL AFTER produced_at;
