-- Preco por canal no cardapio mestre.
--
-- Motivacao concreta: menu_items tem UM preco, publicado igual no iFood e no 99Food.
-- Mas o canal cobra comissao (channels.commission_rate, ~23% no iFood), entao o mesmo
-- preco entrega margens diferentes em cada lugar — e hoje nao ha onde registrar o preco
-- que compensa isso sem estragar o preco de balcao.
--
-- A ausencia de linha nesta tabela e o caso normal: o publicador cai no menu_items.price
-- de sempre. So o item com override deliberado publica outro valor. Isso mantem o
-- comportamento atual intacto ate alguem decidir mudar um preco.
--
-- entity_type e local_id espelham menu_channel_links (item|option), de proposito: e o
-- mesmo par que ja identifica a entidade do cardapio nos vinculos com a plataforma.
--
-- NOTA: o runner (config/migrate.php) quebra o arquivo em `;` e so descarta comentarios
-- de LINHA INTEIRA — nada de comentario depois do ponto e virgula.
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS menu_channel_prices (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  channel_id  INT NOT NULL,
  entity_type VARCHAR(10) NOT NULL,
  local_id    INT NOT NULL,
  price       DECIMAL(12,2) NOT NULL,
  updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_menu_channel_prices (channel_id, entity_type, local_id),
  KEY idx_menu_channel_prices_channel (channel_id),
  CONSTRAINT fk_menu_channel_prices_channel FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE channels
  ADD COLUMN price_markup_pct DECIMAL(5,2) NULL AFTER commission_rate;
