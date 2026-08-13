/**
 * Tipos de produto que se COMPRAM de fornecedor — os que entram em contagem de
 * estoque e em parâmetros de reposição.
 *
 * ESPELHO de `App\Services\Replenishment::COUNTABLE_TIPOS` (backend-php/src/Services/
 * Replenishment.php), que é a fonte da verdade. Antes esta lista estava copiada em
 * quatro arquivos e incluir um tipo novo exigia lembrar de todos.
 */
export const COUNTABLE_TIPOS = ['Mercadoria', 'Matéria-prima', 'Uso e consumo', 'Item intermediário'] as const;
