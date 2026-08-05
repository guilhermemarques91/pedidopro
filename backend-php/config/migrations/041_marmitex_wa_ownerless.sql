-- Itens que não pertencem a uma pessoa (bebida do grupo, sobremesa compartilhada).
--
-- A regra do módulo é que toda marmita tem dono: é o nome da etiqueta, e linha sem
-- nome fica retida para revisão. Isso vale para comida, mas não para o refrigerante
-- que a empresa pede para a mesa — que chega todo dia e travaria o pedido todo dia.
--
-- Em vez de adivinhar pelo formato da linha (uma linha sem proteína pode ser uma
-- marmita mal lida, e transformá-la em "Empresa" faria alguém ficar sem almoço),
-- a empresa declara quais itens do cardápio são compartilhados. Só esses dispensam
-- dono, e a etiqueta sai com o nome da empresa.
--
-- NOTA: o runner (config/migrate.php) quebra o arquivo em `;` e só descarta
-- comentários de LINHA INTEIRA — nada de comentário depois do ponto e vírgula.
SET NAMES utf8mb4;

ALTER TABLE marmitex_wa_configs ADD COLUMN ownerless_size_ids JSON NULL AFTER default_size_id;
