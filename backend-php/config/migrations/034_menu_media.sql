-- Foto local (data URL base64) para itens e complementos do cardapio mestre.
-- Requisito da homologacao do modulo Catalog do iFood: item e cada complemento
-- precisam ter foto. Guardamos a imagem enviada aqui (data URL) e, no publish, ela
-- sobe para a plataforma. image_url segue existindo para URLs ja hospedadas.
-- Obs.: nao usar ponto-e-virgula em comentario de fim de linha (o runner quebra o statement).
ALTER TABLE menu_items ADD COLUMN image_data MEDIUMTEXT NULL AFTER image_url;
ALTER TABLE menu_options ADD COLUMN image_data MEDIUMTEXT NULL AFTER description;
