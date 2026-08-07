<?php

namespace App\Modules\Financeiro;

use App\Core\Db;
use App\Core\Http;
use App\Core\HttpError;
use App\Core\Request;
use App\Modules\Financeiro\Parsers\AllfoodApParser;
use App\Modules\Financeiro\Parsers\AllfoodDreParser;
use App\Modules\Financeiro\Parsers\AllfoodFichaParser;
use App\Modules\Financeiro\Parsers\IfoodQualityParser;
use App\Modules\Financeiro\Parsers\IfoodSalesParser;
use App\Modules\Financeiro\Parsers\NinetyNineDailyParser;
use App\Modules\Financeiro\Parsers\SheetHelper;
use App\Modules\Financeiro\Parsers\SourceDetector;
use PDO;

/**
 * Importação das planilhas financeiras. Mesmo desenho em duas fases dos outros
 * importadores do ERP (App\Modules\Import): `preview` só lê e mostra o que vai
 * acontecer; `commit` reprocessa o arquivo reenviado e grava tudo numa transação.
 * O arquivo em si não é armazenado — só o registro em fin_imports.
 *
 * A FONTE é detectada pelo conteúdo (SourceDetector), então o usuário sobe
 * qualquer um dos relatórios sem precisar dizer qual é.
 */
final class FinImportController
{
    public static function preview(Request $req): void
    {
        [$path, $filename] = self::file($req);
        [$source, $parsed] = self::analyze($req, $path, $filename);

        Http::json([
            'filename' => $filename,
            'source' => $source,
            'sourceLabel' => SourceDetector::LABELS[$source] ?? $source,
            'meta' => $parsed['meta'],
            'totalRows' => $parsed['totalRows'],
            'validRows' => count($parsed['valid']),
            'errorRows' => count($parsed['errors']),
            'errors' => array_slice($parsed['errors'], 0, 50),
            'sample' => self::sample($source, $parsed['valid']),
            'replaces' => self::replaces($req->orgId(), $source, $parsed),
        ]);
    }

    public static function commit(Request $req): void
    {
        [$path, $filename] = self::file($req);
        [$source, $parsed] = self::analyze($req, $path, $filename);

        if (!$parsed['valid']) {
            throw HttpError::badRequest('A planilha não tem nenhuma linha aproveitável.');
        }

        $orgId = $req->orgId();
        $result = Db::transaction(function (PDO $pdo) use ($orgId, $source, $parsed, $filename, $req) {
            $meta = $parsed['meta'];
            $pdo->prepare(
                'INSERT INTO fin_imports
                   (org_id, source, filename, ref_month, period_start, period_end,
                    total_rows, imported_rows, error_rows, error_log, created_by)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
            )->execute([
                $orgId, $source, $filename,
                $meta['ref_month'] ?? null, $meta['period_start'] ?? null, $meta['period_end'] ?? null,
                $parsed['totalRows'], count($parsed['valid']), count($parsed['errors']),
                $parsed['errors'] ? json_encode($parsed['errors'], JSON_UNESCAPED_UNICODE) : null,
                $req->userId(),
            ]);
            $importId = (int) $pdo->lastInsertId();

            $stats = FinWriter::write($pdo, $orgId, $source, $parsed, $importId);

            return array_merge([
                'importId' => $importId,
                'source' => $source,
                'sourceLabel' => SourceDetector::LABELS[$source] ?? $source,
                'filename' => $filename,
                'totalRows' => $parsed['totalRows'],
                'importedRows' => count($parsed['valid']),
                'errorRows' => count($parsed['errors']),
            ], $stats, ['errors' => array_slice($parsed['errors'], 0, 50)]);
        });

        Http::json($result, 201);
    }

    /** Histórico de importações (aba Importações). */
    public static function history(Request $req): void
    {
        $limit = max(1, min((int) ($req->query('limit') ?? 50), 200));
        $rows = Db::query(
            "SELECT i.id, i.source, i.filename, i.ref_month, i.period_start, i.period_end,
                    i.total_rows, i.imported_rows, i.error_rows, i.created_at, u.name AS created_by_name
               FROM fin_imports i
               LEFT JOIN users u ON u.id = i.created_by
              WHERE i.org_id = ?
              ORDER BY i.created_at DESC, i.id DESC
              LIMIT {$limit}",
            [$req->orgId()]
        );
        foreach ($rows as &$r) {
            $r['source_label'] = SourceDetector::LABELS[$r['source']] ?? $r['source'];
        }
        Http::json(['imports' => $rows]);
    }

    /** Desfaz uma importação: apaga as linhas que ela gravou e o próprio registro. */
    public static function destroy(Request $req): void
    {
        $id = $req->intParam('id');
        $orgId = $req->orgId();
        $import = Db::queryOne('SELECT id, source FROM fin_imports WHERE id = ? AND org_id = ?', [$id, $orgId]);
        if (!$import) {
            throw HttpError::notFound('Importação não encontrada');
        }

        $removed = Db::transaction(function (PDO $pdo) use ($id, $orgId) {
            $counts = [];
            foreach (['fin_dre_lines', 'fin_expenses', 'fin_platform_daily', 'fin_platform_monthly', 'fin_product_components', 'fin_product_costs'] as $table) {
                $stmt = $pdo->prepare("DELETE FROM {$table} WHERE org_id = ? AND import_id = ?");
                $stmt->execute([$orgId, $id]);
                if ($stmt->rowCount() > 0) {
                    $counts[$table] = $stmt->rowCount();
                }
            }
            $pdo->prepare('DELETE FROM fin_imports WHERE id = ? AND org_id = ?')->execute([$id, $orgId]);
            return $counts;
        });

        Http::json(['deleted' => true, 'rows' => $removed]);
    }

    // ---- helpers ----

    /** @return array{0:string,1:string} caminho temporário + nome original */
    private static function file(Request $req): array
    {
        $f = $req->file('file');
        if (!$f) {
            throw HttpError::badRequest('Envie a planilha no campo "file"');
        }
        return [$f['tmp_name'], $f['name']];
    }

    /**
     * Detecta a fonte e roda o parser correspondente.
     * @return array{0:string,1:array}
     */
    private static function analyze(Request $req, string $path, string $filename): array
    {
        try {
            $rows = SheetHelper::rows($path);
        } catch (\Throwable $e) {
            throw HttpError::badRequest('Não foi possível ler a planilha: ' . $e->getMessage());
        }

        // O usuário pode forçar a fonte se a detecção errar.
        $source = $req->body['source'] ?? null;
        if (!is_string($source) || !isset(SourceDetector::LABELS[$source])) {
            $source = SourceDetector::detect($rows);
        }
        if ($source === null) {
            throw HttpError::badRequest(
                'Não reconheci este relatório. Aceito: DRE, Contas a pagar e Ficha técnica (AllFood), '
                . 'Dados da loja (99Food) e Qualidade da operação (iFood).'
            );
        }

        $parsed = match ($source) {
            SourceDetector::ALLFOOD_DRE => AllfoodDreParser::parse($path),
            SourceDetector::ALLFOOD_AP => AllfoodApParser::parse($path),
            SourceDetector::ALLFOOD_FICHA => AllfoodFichaParser::parse($path, self::fichaHint($req, $filename)),
            SourceDetector::NINETYNINE_DAILY => NinetyNineDailyParser::parse($path),
            SourceDetector::IFOOD_QUALITY => IfoodQualityParser::parse($path, self::yearHint($req)),
            SourceDetector::IFOOD_SALES => IfoodSalesParser::parse($path),
            default => throw HttpError::badRequest(
                'O extrato financeiro do iFood ainda não tem leitor — envie um exemplo do arquivo para habilitar.'
            ),
        };

        return [$source, $parsed];
    }

    /**
     * Data do snapshot da ficha técnica: o usuário manda, senão tenta o nome do
     * arquivo ("...Ficha Técni #30-05-2026..."). O parser ainda prefere a linha
     * "Emissão:" quando a planilha traz o bloco de metadados.
     */
    private static function fichaHint(Request $req, string $filename): ?string
    {
        $informed = $req->body['snapshot_date'] ?? null;
        if (is_string($informed) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $informed)) {
            return $informed;
        }
        return AllfoodFichaParser::dateFromFilename($filename);
    }

    /** Ano do relatório de qualidade do iFood (o arquivo não traz o ano). */
    private static function yearHint(Request $req): ?int
    {
        $y = $req->body['year'] ?? null;
        if (is_numeric($y) && (int) $y >= 2000 && (int) $y <= 2100) {
            return (int) $y;
        }
        return null;
    }

    /** Amostra para a pré-visualização, com as colunas que importam de cada fonte. */
    private static function sample(string $source, array $valid): array
    {
        $slice = array_slice($valid, 0, 10);
        if ($source === SourceDetector::ALLFOOD_FICHA) {
            // A composição inteira deixaria a resposta enorme — manda só a contagem.
            return array_map(static function (array $i) {
                $i['component_count'] = count($i['components']);
                unset($i['components']);
                return $i;
            }, $slice);
        }
        return $slice;
    }

    /**
     * Quantas linhas já existentes o commit vai substituir — o usuário vê isso
     * antes de confirmar (ex.: "31 dias já importados serão atualizados").
     */
    private static function replaces(int $orgId, string $source, array $parsed): int
    {
        $meta = $parsed['meta'];
        return match ($source) {
            SourceDetector::ALLFOOD_DRE => isset($meta['ref_month'])
                ? self::count('SELECT COUNT(*) AS n FROM fin_dre_lines WHERE org_id = ? AND ref_month = ?', [$orgId, $meta['ref_month']])
                : 0,
            SourceDetector::ALLFOOD_FICHA => isset($meta['snapshot_date'])
                ? self::count('SELECT COUNT(*) AS n FROM fin_product_costs WHERE org_id = ? AND snapshot_date = ?', [$orgId, $meta['snapshot_date']])
                : 0,
            SourceDetector::ALLFOOD_AP => self::countPairs(
                'fin_expenses',
                'ext_id',
                'installment',
                $orgId,
                array_map(static fn ($e) => [$e['ext_id'], $e['installment']], $parsed['valid'])
            ),
            SourceDetector::IFOOD_SALES => self::countPairs(
                'fin_platform_monthly',
                'platform',
                'ref_month',
                $orgId,
                array_map(static fn ($m) => [$m['platform'], $m['ref_month']], $parsed['valid'])
            ),
            default => self::countPairs(
                'fin_platform_daily',
                'platform',
                'stat_date',
                $orgId,
                array_map(static fn ($d) => [$d['platform'], $d['stat_date']], $parsed['valid'])
            ),
        };
    }

    private static function count(string $sql, array $params): int
    {
        $row = Db::queryOne($sql, $params);
        return (int) ($row['n'] ?? 0);
    }

    /**
     * Conta quantas das chaves compostas já existem, numa consulta só — o
     * contas a pagar traz ~170 lançamentos e uma query por linha seria absurdo.
     * @param array<int,array{0:mixed,1:mixed}> $keys
     */
    private static function countPairs(string $table, string $colA, string $colB, int $orgId, array $keys): int
    {
        if (!$keys) {
            return 0;
        }
        $tuples = implode(', ', array_fill(0, count($keys), '(?, ?)'));
        $params = [$orgId];
        foreach ($keys as $k) {
            $params[] = $k[0];
            $params[] = $k[1];
        }
        return self::count(
            "SELECT COUNT(*) AS n FROM {$table} WHERE org_id = ? AND ({$colA}, {$colB}) IN ({$tuples})",
            $params
        );
    }
}
