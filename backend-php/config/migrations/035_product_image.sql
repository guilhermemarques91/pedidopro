-- Foto do produto no cadastro central (Itens & Produtos).
-- Mesma abordagem do cardápio (034_menu_media): guardamos a imagem enviada como
-- data URL (base64) direto na coluna. O cliente REDUZ a imagem para um thumbnail
-- leve antes de enviar, então ela trafega inline na lista e nos cards do PDV sem
-- precisar de endpoint dedicado. Serve também de fallback para a foto do item do
-- cardápio quando este é mapeado a um produto (menu_items.erp_product_id) e não
-- tem imagem própria.
ALTER TABLE products ADD COLUMN image_data MEDIUMTEXT NULL;
