<?php

namespace App\Core;

/**
 * Validação/coerção leve do corpo da requisição (equivalente prático ao zod).
 * Lança HttpError::badRequest com a primeira mensagem de erro encontrada.
 */
final class Input
{
    public function __construct(private array $data)
    {
    }

    public function has(string $key): bool
    {
        return array_key_exists($key, $this->data);
    }

    public function raw(string $key): mixed
    {
        return $this->data[$key] ?? null;
    }

    public function requireString(string $key, int $min = 1, ?int $max = null): string
    {
        $v = $this->data[$key] ?? null;
        if (!is_string($v) || trim($v) === '' && $min > 0) {
            throw HttpError::badRequest("Campo '{$key}' é obrigatório");
        }
        $v = trim($v);
        if (strlen($v) < $min) {
            throw HttpError::badRequest("Campo '{$key}' muito curto");
        }
        if ($max !== null && mb_strlen($v) > $max) {
            throw HttpError::badRequest("Campo '{$key}' excede o tamanho máximo");
        }
        return $v;
    }

    public function string(string $key, ?string $default = null): ?string
    {
        $v = $this->data[$key] ?? null;
        if ($v === null) {
            return $default;
        }
        if (!is_string($v)) {
            return $default;
        }
        $v = trim($v);
        return $v === '' ? $default : $v;
    }

    public function email(string $key): string
    {
        $v = $this->requireString($key);
        if (!filter_var($v, FILTER_VALIDATE_EMAIL)) {
            throw HttpError::badRequest('E-mail inválido');
        }
        return $v;
    }

    public function enum(string $key, array $allowed, bool $required = false, ?string $default = null): ?string
    {
        $v = $this->data[$key] ?? null;
        if ($v === null || $v === '') {
            if ($required) {
                throw HttpError::badRequest("Campo '{$key}' é obrigatório");
            }
            return $default;
        }
        if (!in_array($v, $allowed, true)) {
            throw HttpError::badRequest("Valor inválido para '{$key}'");
        }
        return (string) $v;
    }

    /** Número (int/float/string numérica pt ou en). Retorna float|int|null. */
    public function number(string $key, bool $required = false): int|float|null
    {
        $v = $this->data[$key] ?? null;
        if ($v === null || $v === '') {
            if ($required) {
                throw HttpError::badRequest("Campo '{$key}' é obrigatório");
            }
            return null;
        }
        if (is_int($v) || is_float($v)) {
            return $v;
        }
        if (is_string($v) && is_numeric($v)) {
            return $v + 0;
        }
        throw HttpError::badRequest("Campo '{$key}' deve ser numérico");
    }

    public function integer(string $key, bool $required = false): ?int
    {
        $n = $this->number($key, $required);
        return $n === null ? null : (int) $n;
    }

    public function boolean(string $key, ?bool $default = null): ?bool
    {
        $v = $this->data[$key] ?? null;
        if ($v === null) {
            return $default;
        }
        if (is_bool($v)) {
            return $v;
        }
        if (is_int($v)) {
            return $v !== 0;
        }
        if (is_string($v)) {
            return in_array(strtolower($v), ['1', 'true', 'yes', 'on'], true);
        }
        return $default;
    }

    /** @return array<int,mixed> */
    public function array(string $key, bool $required = false): array
    {
        $v = $this->data[$key] ?? null;
        if ($v === null) {
            if ($required) {
                throw HttpError::badRequest("Campo '{$key}' é obrigatório");
            }
            return [];
        }
        if (!is_array($v)) {
            throw HttpError::badRequest("Campo '{$key}' deve ser uma lista");
        }
        return $v;
    }

    /** Lista de inteiros (ex.: item_ids). */
    public function intArray(string $key, bool $required = false): array
    {
        $arr = $this->array($key, $required);
        return array_values(array_map(static fn ($x) => (int) $x, $arr));
    }
}
