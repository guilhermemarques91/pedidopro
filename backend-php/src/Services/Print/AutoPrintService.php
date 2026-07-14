<?php

namespace App\Services\Print;

use App\Core\Db;
use App\Core\Env;

/**
 * Impressão automática da comanda, rodando no poller local (bin/poll.php --loop) —
 * SEM depender do painel estar aberto no navegador. Substitui o antigo gatilho no
 * frontend (Delivery/index.tsx), que só disparava enquanto a aba estava aberta.
 *
 * Reivindica cada pedido via UPDATE ... WHERE printed_at IS NULL (mesma trava atômica
 * que o endpoint POST /delivery/orders/:id/printed já usava) — evita imprimir 2x se o
 * poller reiniciar no meio de um lote.
 */
final class AutoPrintService
{
    private const AUTOPRINT_STATUS = ['placed', 'confirmed', 'preparing'];

    /** Roda uma passada: imprime a comanda de todo pedido pendente. Retorna quantos imprimiu. */
    public static function run(): int
    {
        $kitchen = trim((string) Env::get('PRINTER_KITCHEN', ''));
        $counter = trim((string) Env::get('PRINTER_COUNTER', ''));
        if ($kitchen === '' && $counter === '') {
            return 0; // sem impressora configurada — nada a fazer
        }

        $placeholders = implode(',', array_fill(0, count(self::AUTOPRINT_STATUS), '?'));
        $pending = Db::query(
            "SELECT id FROM delivery_orders WHERE printed_at IS NULL AND status IN ({$placeholders}) ORDER BY created_at",
            self::AUTOPRINT_STATUS
        );
        if (!$pending) {
            return 0;
        }

        $certPath = Env::get('QZ_CERT_PATH');
        $keyPath = Env::get('QZ_PRIVATE_KEY_PATH');
        $cert = $certPath && is_readable($certPath) ? (string) file_get_contents($certPath) : null;
        $key = $keyPath && is_readable($keyPath) ? (string) file_get_contents($keyPath) : null;

        $qz = new QzTrayClient(privateKeyPem: $key, certPem: $cert);
        $qz->connect();

        $printed = 0;
        try {
            foreach ($pending as $row) {
                $id = (int) $row['id'];
                // Reivindica ANTES de imprimir (mesma semântica do endpoint HTTP): evita
                // reimpressão em corrida com o painel aberto em outra tela.
                $claimed = Db::execute('UPDATE delivery_orders SET printed_at = NOW() WHERE id = ? AND printed_at IS NULL', [$id]) > 0;
                if (!$claimed) {
                    continue;
                }
                try {
                    $order = self::loadOrder($id);
                    if ($kitchen !== '') {
                        $qz->printHtml($kitchen, ReceiptRenderer::html($order, 'kitchen'), ReceiptRenderer::PAPER_WIDTH_MM);
                    }
                    if ($counter !== '') {
                        $qz->printHtml($counter, ReceiptRenderer::html($order, 'counter'), ReceiptRenderer::PAPER_WIDTH_MM);
                    }
                    $printed++;
                } catch (\Throwable $e) {
                    // Falhou no QZ (impressora offline etc.) — libera pra tentar de novo no próximo loop.
                    Db::execute('UPDATE delivery_orders SET printed_at = NULL WHERE id = ?', [$id]);
                    echo '[' . date('Y-m-d H:i:s') . "] [autoprint] pedido {$id} falhou: " . $e->getMessage() . "\n";
                }
            }
        } finally {
            $qz->close();
        }
        return $printed;
    }

    private static function loadOrder(int $id): array
    {
        $order = Db::queryOne('SELECT * FROM delivery_orders WHERE id = ?', [$id]);
        if (isset($order['delivery_address']) && is_string($order['delivery_address'])) {
            $decoded = json_decode($order['delivery_address'], true);
            $order['delivery_address'] = is_array($decoded) ? $decoded : null;
        }
        $items = Db::query('SELECT * FROM delivery_order_items WHERE order_id = ? ORDER BY id', [$id]);
        foreach ($items as &$it) {
            if (isset($it['options']) && is_string($it['options'])) {
                $decoded = json_decode($it['options'], true);
                $it['options'] = is_array($decoded) ? $decoded : null;
            }
        }
        unset($it);
        $order['items'] = $items;
        return $order;
    }
}
