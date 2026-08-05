-- Complementos reutilizáveis: a "classe de complementos" (Proteínas, Acompanhamentos)
-- deixa de pertencer a UM item e passa a ser compartilhada por vários.
--
-- Antes: menu_option_groups.item_id — o grupo era propriedade do item, então "Escolha
-- sua Proteína" existia N vezes (uma por prato) e editar a lista de proteínas era um
-- trabalho de N edições, sempre saindo do ar em pratos esquecidos.
--
-- Agora: o grupo é uma CLASSE da org (menu_option_groups.org_id) e o vínculo com os
-- itens vive em menu_item_option_groups. Editar a classe — incluir opção, pausar,
-- mudar preço — vale na hora em todo item que a usa. Excluir o item só desfaz o
-- vínculo; a classe sobrevive para os outros.
--
-- O `sort` da classe deixa de ser global e passa a ser por item (a mesma classe pode
-- ser a 1ª num prato e a 3ª noutro), por isso ele é copiado para o vínculo.
--
-- NOTA: o runner (config/migrate.php) quebra o arquivo em `;` e só descarta
-- comentários de LINHA INTEIRA — nada de comentário depois do ponto e vírgula.
SET NAMES utf8mb4;

ALTER TABLE menu_option_groups ADD COLUMN org_id INT NOT NULL DEFAULT 1 AFTER id;

UPDATE menu_option_groups g JOIN menu_items i ON i.id = g.item_id SET g.org_id = i.org_id;

CREATE TABLE IF NOT EXISTS menu_item_option_groups (
  id       INT AUTO_INCREMENT PRIMARY KEY,
  item_id  INT NOT NULL,
  group_id INT NOT NULL,
  sort     INT NOT NULL DEFAULT 0,
  UNIQUE KEY uq_item_group (item_id, group_id),
  KEY idx_item_groups_group (group_id),
  CONSTRAINT fk_item_groups_item FOREIGN KEY (item_id) REFERENCES menu_items(id) ON DELETE CASCADE,
  CONSTRAINT fk_item_groups_group FOREIGN KEY (group_id) REFERENCES menu_option_groups(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO menu_item_option_groups (item_id, group_id, sort)
  SELECT item_id, id, sort FROM menu_option_groups WHERE item_id IS NOT NULL;

ALTER TABLE menu_option_groups DROP FOREIGN KEY fk_menu_groups_item;

ALTER TABLE menu_option_groups DROP COLUMN item_id;

ALTER TABLE menu_option_groups ADD KEY idx_menu_groups_org (org_id);
