-- Rastreabilidade do "Conferir resto": distinguir contagem digitada de saldo do
-- sistema aceito em massa. Antes os dois caiam no mesmo counted_qty e ficavam
-- indistinguiveis depois de salvo — quem olhasse o historico nao tinha como saber
-- se aquele numero foi contado de verdade ou so aceito sem conferir a prateleira.
--
-- NOTA: o runner (config/migrate.php) quebra o arquivo em `;` e so descarta
-- comentarios de LINHA INTEIRA — nada de comentario depois do ponto e virgula.
SET NAMES utf8mb4;

ALTER TABLE stock_count_items
  ADD COLUMN counted_via ENUM('manual','sistema') NOT NULL DEFAULT 'manual' AFTER counted_qty;
