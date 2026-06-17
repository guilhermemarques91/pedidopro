<?php

namespace App\Core;

/**
 * Roteador enxuto. Rotas com params `:id`. Cada rota tem um guard de papéis:
 *   null  → rota pública (sem auth)
 *   []    → qualquer usuário autenticado
 *   [...] → papéis permitidos
 */
final class Router
{
    /** @var array<int,array{method:string,regex:string,keys:string[],handler:callable,roles:?array}> */
    private array $routes = [];

    public function get(string $path, callable $h, ?array $roles = []): void
    {
        $this->add('GET', $path, $h, $roles);
    }

    public function post(string $path, callable $h, ?array $roles = []): void
    {
        $this->add('POST', $path, $h, $roles);
    }

    public function put(string $path, callable $h, ?array $roles = []): void
    {
        $this->add('PUT', $path, $h, $roles);
    }

    public function patch(string $path, callable $h, ?array $roles = []): void
    {
        $this->add('PATCH', $path, $h, $roles);
    }

    public function delete(string $path, callable $h, ?array $roles = []): void
    {
        $this->add('DELETE', $path, $h, $roles);
    }

    private function add(string $method, string $path, callable $h, ?array $roles): void
    {
        $keys = [];
        $regex = preg_replace_callback('#:([a-zA-Z_]+)#', function ($m) use (&$keys) {
            $keys[] = $m[1];
            return '([^/]+)';
        }, $path);
        $this->routes[] = [
            'method' => $method,
            'regex' => '#^' . $regex . '$#',
            'keys' => $keys,
            'handler' => $h,
            'roles' => $roles,
        ];
    }

    public function dispatch(string $method, string $path): void
    {
        $path = rtrim($path, '/');
        if ($path === '') {
            $path = '/';
        }
        $allowed = false;
        foreach ($this->routes as $r) {
            if (!preg_match($r['regex'], $path, $m)) {
                continue;
            }
            $allowed = true;
            if ($r['method'] !== $method) {
                continue;
            }
            $req = Request::capture();
            array_shift($m);
            foreach ($r['keys'] as $i => $key) {
                $req->params[$key] = $m[$i] ?? '';
            }
            if ($r['roles'] !== null) {
                $req->user = Auth::authenticate();
                Auth::authorize($req->user, $r['roles']);
            }
            ($r['handler'])($req);
            return;
        }
        if ($allowed) {
            Http::error(405, 'Método não permitido');
        }
        Http::error(404, 'Rota não encontrada');
    }
}
