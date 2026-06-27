<?php

namespace App\Core;

/** Representa a requisição: params da rota, query, corpo JSON, arquivo e usuário autenticado. */
final class Request
{
    /** @var array<string,string> */
    public array $params = [];
    /** @var array<string,mixed> */
    public array $body = [];
    /** @var array{id:int,email:string,role:string,company_id:?int}|null */
    public ?array $user = null;

    public static function capture(): self
    {
        $req = new self();
        $raw = file_get_contents('php://input');
        if ($raw !== '' && $raw !== false) {
            $decoded = json_decode($raw, true);
            if (is_array($decoded)) {
                $req->body = $decoded;
            }
        }
        // Fallback para form-data (uploads usam $_POST além do arquivo).
        if (!$req->body && !empty($_POST)) {
            $req->body = $_POST;
        }
        return $req;
    }

    public function param(string $key): ?string
    {
        return $this->params[$key] ?? null;
    }

    public function intParam(string $key): int
    {
        $v = $this->params[$key] ?? null;
        if ($v === null || !ctype_digit((string) $v) || (int) $v <= 0) {
            throw HttpError::badRequest('ID inválido');
        }
        return (int) $v;
    }

    public function query(string $key, ?string $default = null): ?string
    {
        $v = $_GET[$key] ?? null;
        return ($v === null || $v === '') ? $default : (string) $v;
    }

    public function input(): Input
    {
        return new Input($this->body);
    }

    public function userId(): int
    {
        return (int) ($this->user['id'] ?? 0);
    }

    public function role(): string
    {
        return (string) ($this->user['role'] ?? '');
    }

    public function isAdmin(): bool
    {
        return $this->role() === 'admin';
    }

    public function isCompany(): bool
    {
        return $this->role() === 'company';
    }

    /** Empresa-cliente vinculada ao login (apenas para role 'company'); null para staff. */
    public function companyId(): ?int
    {
        $v = $this->user['company_id'] ?? null;
        return $v === null ? null : (int) $v;
    }

    /** @return array{name:string,type:string,tmp_name:string,size:int}|null */
    public function file(string $field = 'file'): ?array
    {
        if (empty($_FILES[$field]) || ($_FILES[$field]['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
            return null;
        }
        return $_FILES[$field];
    }
}
