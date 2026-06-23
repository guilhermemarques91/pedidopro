-- Migração: guarda o item de catálogo escolhido pelo funcionário numa linha da lista de compras.
-- Sem isso, um item ainda NÃO agrupado (sem product_id) era salvo só como texto livre e perdia o
-- vínculo com o fornecedor — na aprovação não aparecia oferta nenhuma.
-- Rode UMA VEZ no banco existente (phpMyAdmin do cPanel) ANTES de subir o backend novo.
-- O schema.mysql.sql é destrutivo e não deve ser usado em produção.

ALTER TABLE purchase_request_items
  ADD COLUMN source_item_id INT NULL AFTER product_id,
  ADD CONSTRAINT fk_preq_items_source FOREIGN KEY (source_item_id) REFERENCES items(id) ON DELETE SET NULL;
