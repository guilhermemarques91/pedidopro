-- Migração: adiciona o código do fornecedor aos itens.
-- Rode UMA VEZ no banco existente (phpMyAdmin do cPanel ou linha de comando).
-- Não roda automaticamente — o schema.mysql.sql é destrutivo e não deve ser usado em produção.

ALTER TABLE items ADD COLUMN supplier_code VARCHAR(50) NULL AFTER name;
