-- Segunda proteína na mesma marmita ("Costelinha e omelete").
--
-- Existia como remendo: a segunda proteína ia para a OBSERVAÇÃO, com um "+" na
-- frente. Saía na etiqueta, então parecia resolvido — mas observação é texto livre,
-- e isso custava três coisas de verdade:
--   · a ficha técnica não baixava o estoque da segunda proteína (Production só olha
--     protein_id), então a cozinha consumia omelete que o sistema nunca deu saída;
--   · o relatório e a fatura mostravam a marmita como se fosse só de costelinha;
--   · a etiqueta misturava proteína com recado de cozinha na mesma linha.
--
-- Duas colunas e não uma lista JSON (como sides_json) porque proteína é o eixo do
-- relatório e do faturamento — `GROUP BY protein_name` continua valendo, e a segunda
-- entra ao lado. Uma lista obrigaria a reescrever agregação, fatura e etiqueta para
-- ganhar um terceiro slot que ninguém pede.
--
-- NOTA: o runner (config/migrate.php) quebra o arquivo em `;` e só descarta
-- comentários de LINHA INTEIRA — nada de comentário depois do ponto e vírgula.
SET NAMES utf8mb4;

ALTER TABLE marmitex_marmitas ADD COLUMN protein2_id INT NULL AFTER protein_name;

ALTER TABLE marmitex_marmitas ADD COLUMN protein2_name VARCHAR(120) NULL AFTER protein2_id;

ALTER TABLE marmitex_marmitas ADD CONSTRAINT fk_marmitas_protein2 FOREIGN KEY (protein2_id) REFERENCES marmitex_proteins(id) ON DELETE SET NULL;

ALTER TABLE marmitex_wa_draft_lines ADD COLUMN protein2_id INT NULL AFTER protein_id;
