<?php

namespace App\Modules\Stock;

use App\Core\Db;
use App\Core\Http;
use App\Core\HttpError;
use App\Core\Request;
use App\Services\Replenishment;
use PDO;

/**
 * Parâmetros de reposição (min_stock / max_stock / pack_size) em lote.
 *
 * Cadastrar isso produto a produto pela tela de Itens & Produtos é inviável com
 * 200 itens. Aqui vem a grade filtrável com o consumo já calculado ao lado, para
 * o número ser decidido olhando o histórico — e não no chute.
 */
final class ParamsController
{
    /** Mesmo recorte da folha de contagem: só o que se compra tem reposição. */
    private const COUNTABLE_TIPOS = ['Mercadoria', 'Matéria-prima', 'Uso e consumo', 'Item intermediário'];

    /**
     * GET /stock/replenishment?q=&tipo=&category_id=&type_id=&only_missing=1
     * Lista os produtos compráveis com os parâmetros atuais + consumo médio diário.
     */
    public static function list(Request $req): void
    {
        $where = ['p.org_id = ?', 'p.active = 1'];
        $params = [$req->orgId()];

        $tipo = $req->query('tipo');
        if ($tipo !== null && $tipo !== '') {
            if (!in_array($tipo, self::COUNTABLE_TIPOS, true)) {
                throw HttpError::badRequest('Tipo não tem reposição por compra');
            }
            $where[] = 'p.tipo = ?';
            $params[] = $tipo;
        } else {
            $where[] = 'p.tipo IN (' . Db::inClause(self::COUNTABLE_TIPOS) . ')';
            $params = array_merge($params, self::COUNTABLE_TIPOS);
        }
        if (($q = $req->query('q')) !== null) {
            $where[] = 'p.name LIKE ?';
            $params[] = '%' . $q . '%';
        }
        if (($cat = $req->query('category_id')) !== null && ctype_digit($cat)) {
            $where[] = 'p.category_id = ?';
            $params[] = (int) $cat;
        }
        if (($typeId = $req->query('type_id')) !== null && ctype_digit($typeId)) {
            $where[] = 'p.type_id = ?';
            $params[] = (int) $typeId;
        }
        // Atalho para o cadastro inicial: só o que ainda não tem alvo definido.
        if ($req->query('only_missing') !== null) {
            $where[] = 'p.max_stock IS NULL';
        }

        $rows = Db::query(
            'SELECT p.id, p.name, p.tipo, p.unit, p.purchase_unit, p.stock_qty,
                    p.min_stock, p.max_stock, p.pack_size, p.avg_cost, p.cost_price,
                    c.name AS category_name, t.name AS type_name
               FROM products p
               LEFT JOIN categories c ON c.id = p.category_id
               LEFT JOIN product_types t ON t.id = p.type_id
              WHERE ' . implode(' AND ', $where) . '
              ORDER BY p.name',
            $params
        );
        if (!$rows) {
            Http::json([]);
            return;
        }

        // Consumo médio diário ao lado de cada linha: é o número que embasa o mín/máx.
        $usage = Replenishment::dailyUsage($req->orgId(), array_map(static fn ($r) => (int) $r['id'], $rows));
        foreach ($rows as &$r) {
            $daily = $usage[(int) $r['id']] ?? null;
            $r['daily_usage'] = $daily !== null ? round($daily, 3) : null;
            $r['unit_cost'] = $r['avg_cost'] ?? $r['cost_price'];
        }
        unset($r);
        Http::json($rows);
    }

    /**
     * PUT /stock/replenishment { items: [{ product_id, min_stock?, max_stock?, pack_size? }] }
     * Grava só os produtos enviados; campo ausente na linha fica como está, null limpa.
     */
    public static function save(Request $req): void
    {
        $items = $req->input()->array('items', true);
        if (!$items) {
            throw HttpError::badRequest('Nada para salvar');
        }

        $saved = Db::transaction(function (PDO $pdo) use ($items, $req) {
            $check = $pdo->prepare('SELECT id FROM products WHERE id = ? AND org_id = ?');
            $n = 0;
            foreach ($items as $row) {
                $id = isset($row['product_id']) ? (int) $row['product_id'] : 0;
                if ($id <= 0) {
                    throw HttpError::badRequest('Linha sem produto');
                }
                $check->execute([$id, $req->orgId()]);
                if (!$check->fetch()) {
                    throw HttpError::notFound("Produto {$id} não encontrado");
                }
                $fields = [];
                $values = [];
                foreach (['min_stock', 'max_stock', 'pack_size'] as $col) {
                    if (array_key_exists($col, $row)) {
                        $fields[] = "{$col} = ?";
                        $values[] = self::qty($row[$col], $col);
                    }
                }
                if (!$fields) {
                    continue;
                }
                $values[] = $id;
                $pdo->prepare('UPDATE products SET ' . implode(', ', $fields) . ' WHERE id = ?')->execute($values);
                $n++;
            }
            return $n;
        });
        Http::json(['ok' => true, 'saved' => $saved]);
    }

    /** Quantidade opcional: null/'' limpa o parâmetro; negativo é erro. */
    private static function qty(mixed $v, string $col): ?float
    {
        if ($v === null || $v === '') {
            return null;
        }
        if (!is_numeric($v) || (float) $v < 0) {
            throw HttpError::badRequest("Valor inválido em {$col}");
        }
        return (float) $v;
    }
}
