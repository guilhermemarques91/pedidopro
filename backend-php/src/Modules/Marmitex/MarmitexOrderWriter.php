<?php

namespace App\Modules\Marmitex;

use App\Core\Db;
use App\Core\HttpError;
use PDO;

/**
 * Gravação do pedido do dia, sem HTTP. Existe para que o worker do WhatsApp e o
 * controller usem EXATAMENTE o mesmo caminho de escrita — o worker não faz
 * requisição para si mesmo.
 *
 * `saveDay()` é um upsert DESTRUTIVO por (empresa, data): apaga as marmitas do dia
 * e reinsere. Quem chama precisa mandar o conjunto completo do dia, não um delta.
 * Em compensação, aplicar duas vezes o mesmo conjunto dá o mesmo resultado.
 *
 * As colunas `source`/`wa_draft_id` registram quem escreveu o dia: é o que impede
 * a automação de apagar por cima de uma edição manual do operador.
 *
 * O horário de corte NÃO é checado aqui — é regra de quem chama (vale só para o
 * login 'company'; admin e automação lançam a qualquer hora).
 */
final class MarmitexOrderWriter
{
    /**
     * @param array<int,array{person_name?:?string,size_id:int,protein_id?:?int,protein2_id?:?int,side_ids?:int[],observation?:?string}> $marmitas
     * @return int id do pedido
     */
    public static function saveDay(
        int $companyId,
        string $serviceDate,
        array $marmitas,
        ?string $notes,
        ?int $userId,
        string $source = 'manual',
        ?int $waDraftId = null
    ): int {
        $parsed = self::parseMarmitas($marmitas, $companyId);

        return Db::transaction(function (PDO $pdo) use ($companyId, $serviceDate, $notes, $parsed, $userId, $source, $waDraftId) {
            $find = $pdo->prepare('SELECT id, status FROM marmitex_orders WHERE company_id = ? AND service_date = ?');
            $find->execute([$companyId, $serviceDate]);
            $existing = $find->fetch();

            if ($existing) {
                $orderId = (int) $existing['id'];
                if ($existing['status'] === 'produced') {
                    throw HttpError::badRequest('Produção já fechada: reabra o pedido para alterá-lo');
                }
                $billed = $pdo->prepare('SELECT COUNT(*) AS n FROM marmitex_marmitas WHERE order_id = ? AND billed_invoice_id IS NOT NULL');
                $billed->execute([$orderId]);
                if ((int) $billed->fetch()['n'] > 0) {
                    throw HttpError::badRequest('Pedido já faturado não pode ser alterado');
                }
                $pdo->prepare("UPDATE marmitex_orders SET notes = ?, status = 'submitted', source = ?, wa_draft_id = ? WHERE id = ?")
                    ->execute([$notes, $source, $waDraftId, $orderId]);
                $pdo->prepare('DELETE FROM marmitex_marmitas WHERE order_id = ?')->execute([$orderId]);
            } else {
                $pdo->prepare('INSERT INTO marmitex_orders (company_id, service_date, notes, created_by, source, wa_draft_id) VALUES (?, ?, ?, ?, ?, ?)')
                    ->execute([$companyId, $serviceDate, $notes, $userId, $source, $waDraftId]);
                $orderId = (int) $pdo->lastInsertId();
            }
            self::insertMarmitas($pdo, $orderId, $companyId, $serviceDate, $parsed);
            return $orderId;
        });
    }

    /** Valida cada marmita contra o cardápio EFETIVO da empresa (contrato aplicado) e gera o snapshot. */
    public static function parseMarmitas(array $raw, int $companyId): array
    {
        if (!$raw) {
            throw HttpError::badRequest('Inclua ao menos uma marmita');
        }
        // Contrato: itens ocultos não valem; preço do tamanho pode ser o do contrato.
        $hidden = MarmitexContract::hidden($companyId);
        $prices = MarmitexContract::prices($companyId);
        $sizes = [];
        foreach (Db::query('SELECT id, name, price FROM marmitex_sizes WHERE active = 1') as $s) {
            $sid = (int) $s['id'];
            if (isset($hidden['sizes'][$sid])) {
                continue;
            }
            if (isset($prices[$sid])) {
                $s['price'] = $prices[$sid];
            }
            $sizes[$sid] = $s;
        }
        $proteins = [];
        foreach (Db::query('SELECT id, name FROM marmitex_proteins WHERE active = 1') as $p) {
            if (!isset($hidden['proteins'][(int) $p['id']])) {
                $proteins[(int) $p['id']] = $p['name'];
            }
        }
        $sidesCat = [];
        foreach (Db::query('SELECT id, name FROM marmitex_sides WHERE active = 1') as $s) {
            if (!isset($hidden['sides'][(int) $s['id']])) {
                $sidesCat[(int) $s['id']] = $s['name'];
            }
        }

        $out = [];
        foreach ($raw as $r) {
            $sizeId = isset($r['size_id']) ? (int) $r['size_id'] : 0;
            if (!isset($sizes[$sizeId])) {
                throw HttpError::badRequest('Selecione um tamanho válido em cada marmita');
            }
            $size = $sizes[$sizeId];

            $proteinId = isset($r['protein_id']) && $r['protein_id'] ? (int) $r['protein_id'] : null;
            $protein2Id = isset($r['protein2_id']) && $r['protein2_id'] ? (int) $r['protein2_id'] : null;
            // Só a segunda preenchida: ela é a proteína da marmita, não a "segunda".
            // Senão o relatório contaria a marmita como sem proteína.
            if ($proteinId === null && $protein2Id !== null) {
                $proteinId = $protein2Id;
                $protein2Id = null;
            }
            if ($protein2Id === $proteinId) {
                $protein2Id = null; // a mesma proteína duas vezes é uma só
            }
            $proteinName = self::proteinName($proteinId, $proteins);
            $protein2Name = self::proteinName($protein2Id, $proteins);

            $sides = [];
            $sideIds = isset($r['side_ids']) && is_array($r['side_ids']) ? $r['side_ids'] : [];
            foreach ($sideIds as $sid) {
                $sid = (int) $sid;
                if (!isset($sidesCat[$sid])) {
                    throw HttpError::badRequest('Acompanhamento inválido em uma das marmitas');
                }
                $sides[] = ['id' => $sid, 'name' => $sidesCat[$sid]];
            }

            $person = isset($r['person_name']) && is_string($r['person_name']) ? trim($r['person_name']) : '';
            $obs = isset($r['observation']) && is_string($r['observation']) ? trim($r['observation']) : '';

            $out[] = [
                'person_name' => $person !== '' ? $person : null,
                'size_id' => $sizeId,
                'size_name' => $size['name'],
                'protein_id' => $proteinId,
                'protein_name' => $proteinName,
                'protein2_id' => $protein2Id,
                'protein2_name' => $protein2Name,
                'sides_json' => json_encode($sides, JSON_UNESCAPED_UNICODE),
                'observation' => $obs !== '' ? $obs : null,
                'unit_price' => (float) $size['price'],
            ];
        }
        return $out;
    }

    /** Nome de snapshot da proteína, validado contra o cardápio efetivo. @param array<int,string> $proteins */
    private static function proteinName(?int $id, array $proteins): ?string
    {
        if ($id === null) {
            return null;
        }
        if (!isset($proteins[$id])) {
            throw HttpError::badRequest('Proteína inválida em uma das marmitas');
        }
        return $proteins[$id];
    }

    private static function insertMarmitas(PDO $pdo, int $orderId, int $companyId, string $serviceDate, array $marmitas): void
    {
        $stmt = $pdo->prepare(
            'INSERT INTO marmitex_marmitas
               (order_id, company_id, service_date, person_name, size_id, size_name, protein_id, protein_name,
                protein2_id, protein2_name, sides_json, observation, unit_price)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        foreach ($marmitas as $m) {
            $stmt->execute([
                $orderId, $companyId, $serviceDate, $m['person_name'], $m['size_id'], $m['size_name'],
                $m['protein_id'], $m['protein_name'], $m['protein2_id'], $m['protein2_name'],
                $m['sides_json'], $m['observation'], $m['unit_price'],
            ]);
        }
    }
}
