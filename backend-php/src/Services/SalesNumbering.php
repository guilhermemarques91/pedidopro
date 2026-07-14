<?php

namespace App\Services;

use PDO;

/** Senha sequencial diária (balcão + retirada compartilham a mesma sequência). */
final class SalesNumbering
{
    public static function nextDailyNumber(PDO $pdo, int $orgId): int
    {
        $pdo->prepare(
            'INSERT INTO sales_counters (org_id, counter_date, last_number)
             VALUES (?, CURDATE(), 1)
             ON DUPLICATE KEY UPDATE last_number = last_number + 1'
        )->execute([$orgId]);

        $st = $pdo->prepare('SELECT last_number FROM sales_counters WHERE org_id = ? AND counter_date = CURDATE()');
        $st->execute([$orgId]);
        return (int) $st->fetch()['last_number'];
    }
}
