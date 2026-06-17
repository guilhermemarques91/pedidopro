<?php

namespace App\Services;

use App\Core\Db;
use PDO;

/** Grava linhas extraídas por IA como itens de cotação (find-or-create do item). */
final class QuotationWriter
{
    /**
     * @param array<int,array{name:string,unit:string,price:?float,quantity:?float,notes:?string}> $rows
     * @return array<int,int> ids das linhas inseridas em quotation_items
     */
    public static function addExtracted(int $quotationId, int $supplierId, array $rows, string $source): array
    {
        return Db::transaction(function (PDO $pdo) use ($quotationId, $supplierId, $rows, $source) {
            $out = [];
            foreach ($rows as $row) {
                $find = $pdo->prepare('SELECT id FROM items WHERE supplier_id = ? AND LOWER(name) = LOWER(?) LIMIT 1');
                $find->execute([$supplierId, $row['name']]);
                $existing = $find->fetch();
                if ($existing) {
                    $itemId = (int) $existing['id'];
                } else {
                    $pdo->prepare('INSERT INTO items (supplier_id, name, unit, base_price) VALUES (?, ?, ?, ?)')
                        ->execute([$supplierId, $row['name'], $row['unit'], $row['price']]);
                    $itemId = (int) $pdo->lastInsertId();
                }
                $pdo->prepare(
                    'INSERT INTO quotation_items
                        (quotation_id, item_id, supplier_id, price, quantity, notes, source, extracted_by_ai, reviewed)
                     VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0)'
                )->execute([$quotationId, $itemId, $supplierId, $row['price'], $row['quantity'], $row['notes'], $source]);
                $out[] = (int) $pdo->lastInsertId();
            }
            return $out;
        });
    }
}
