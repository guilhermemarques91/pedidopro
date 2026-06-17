<?php

namespace App\Core;

/** Erro HTTP com status e mensagem — equivalente aos helpers http-error do backend Node. */
class HttpError extends \RuntimeException
{
    /** @var array<int,array{message:string}>|null */
    public ?array $details;

    public function __construct(int $status, string $message, ?array $details = null)
    {
        parent::__construct($message, $status);
        $this->details = $details;
    }

    public static function badRequest(string $msg = 'Requisição inválida', ?array $details = null): self
    {
        return new self(400, $msg, $details);
    }

    public static function unauthorized(string $msg = 'Não autenticado'): self
    {
        return new self(401, $msg);
    }

    public static function forbidden(string $msg = 'Sem permissão para esta ação'): self
    {
        return new self(403, $msg);
    }

    public static function notFound(string $msg = 'Não encontrado'): self
    {
        return new self(404, $msg);
    }

    public static function unprocessable(string $msg = 'Não foi possível processar'): self
    {
        return new self(422, $msg);
    }
}
