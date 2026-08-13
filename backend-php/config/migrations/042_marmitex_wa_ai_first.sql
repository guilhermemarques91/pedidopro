-- Leitura por IA como caminho principal, por empresa.
--
-- As regras do MarmitexWaParser leem bem a empresa que manda a lista numerada:
-- posição fixa, mesma pessoa digitando todo dia. Não leem a empresa em que cada
-- funcionário escreve do seu jeito — nome na primeira linha, na última, no meio do
-- texto. Ali a heurística de posição erra, e erra CALADA: leitura ruim não devolve
-- "não entendi", devolve um nome plausível que ninguém confere.
--
-- Isto é por empresa e não por variável de ambiente porque as duas leituras são
-- certas, cada uma no seu grupo: trocar a regra da lista numerada por IA seria
-- trocar acerto determinístico e de graça por palpite de modelo.
--
-- NOTA: o runner (config/migrate.php) quebra o arquivo em `;` e só descarta
-- comentários de LINHA INTEIRA — nada de comentário depois do ponto e vírgula.
SET NAMES utf8mb4;

ALTER TABLE marmitex_wa_configs ADD COLUMN ai_first TINYINT(1) NOT NULL DEFAULT 0 AFTER mode;
