<?php

namespace App\Core;

use PDO;

/**
 * Camada de acesso ao MySQL via PDO. Equivalente aos helpers de
 * backend/src/config/database.ts (query / queryOne / withTransaction),
 * mais utilitários para os padrões portados do PostgreSQL:
 *  - insertReturning(): substitui `RETURNING` em INSERT.
 *  - updateReturning(): substitui `RETURNING` em UPDATE (re-SELECT por id).
 *  - inClause(): expande `IN (?, ?, ...)` (substitui `= ANY($1::int[])`).
 *
 * Placeholders: usar `?` posicional (não `$1`).
 */
final class Db
{
    private static ?PDO $pdo = null;

    public static function pdo(): PDO
    {
        if (self::$pdo === null) {
            $host = Env::get('DB_HOST', '127.0.0.1');
            $port = Env::get('DB_PORT', '3306');
            $name = Env::get('DB_NAME', '');
            $dsn = "mysql:host={$host};port={$port};dbname={$name};charset=utf8mb4";
            self::$pdo = new PDO($dsn, Env::get('DB_USER', ''), Env::get('DB_PASS', ''), [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                // Prepares nativos: INT/TINYINT voltam como int (booleans = 0/1),
                // DECIMAL/TIMESTAMP como string (igual ao driver pg do Node).
                PDO::ATTR_EMULATE_PREPARES => false,
                PDO::ATTR_STRINGIFY_FETCHES => false,
            ]);
        }
        return self::$pdo;
    }

    /** @return array<int,array<string,mixed>> */
    public static function query(string $sql, array $params = []): array
    {
        $stmt = self::pdo()->prepare($sql);
        $stmt->execute($params);
        return $stmt->fetchAll();
    }

    /** @return array<string,mixed>|null */
    public static function queryOne(string $sql, array $params = []): ?array
    {
        $stmt = self::pdo()->prepare($sql);
        $stmt->execute($params);
        $row = $stmt->fetch();
        return $row === false ? null : $row;
    }

    /** Executa um comando e retorna o nº de linhas afetadas. */
    public static function execute(string $sql, array $params = []): int
    {
        $stmt = self::pdo()->prepare($sql);
        $stmt->execute($params);
        return $stmt->rowCount();
    }

    public static function lastInsertId(): int
    {
        return (int) self::pdo()->lastInsertId();
    }

    /**
     * INSERT + re-SELECT da linha criada (substitui `RETURNING`).
     * @return array<string,mixed>
     */
    public static function insertReturning(string $insertSql, array $params, string $table): array
    {
        self::execute($insertSql, $params);
        $id = self::lastInsertId();
        $row = self::queryOne("SELECT * FROM {$table} WHERE id = ?", [$id]);
        return $row ?? ['id' => $id];
    }

    /**
     * Executa o callback dentro de uma transação (BEGIN/COMMIT/ROLLBACK).
     * @template T
     * @param callable(PDO):T $fn
     * @return T
     */
    public static function transaction(callable $fn): mixed
    {
        $pdo = self::pdo();
        $pdo->beginTransaction();
        try {
            $result = $fn($pdo);
            $pdo->commit();
            return $result;
        } catch (\Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $e;
        }
    }

    /** Gera "?, ?, ?" para um IN(...) a partir de uma lista de valores. */
    public static function inClause(array $values): string
    {
        return implode(', ', array_fill(0, max(count($values), 1), '?'));
    }
}
