<?php

namespace App\Core;

/**
 * Permissões por módulo (Etapa 0 do roadmap ERP).
 *
 * Capacidades granulares no formato `modulo:acao`. Os PAPÉIS são dados (tabela
 * `roles`) e cada usuário pode ter um override (`users.permissions_json`). A
 * resolução efetiva (papel + override) é feita aqui, lendo do banco e memoizada
 * por request. `admin` é superusuário: sempre todas as permissões.
 */
final class Permissions
{
    /**
     * Catálogo agrupado por módulo — fonte para os checkboxes da UI e para validar
     * o que pode ser atribuído. Ordem/labels aparecem na tela.
     * @var array<string,array{label:string,items:array<string,string>}>
     */
    public const CATALOG = [
        'compras' => [
            'label' => 'Compras & Cadastros',
            'items' => [
                'compras:read' => 'Ver cadastros, cotações e pedidos',
                'compras:write' => 'Criar / editar (fornecedores, itens, cotações, pedidos)',
                'compras:approve' => 'Aprovar / recusar pedidos',
                'compras:requests' => 'Requisições (listas de compra)',
                'compras:admin' => 'Excluir e administrar (categorias, alocação)',
            ],
        ],
        'estoque' => [
            'label' => 'Estoque',
            'items' => [
                'estoque:read' => 'Ver saldo e movimentações',
                'estoque:mover' => 'Lançar entrada / saída / ajuste',
                'estoque:contagem' => 'Fazer contagem de estoque (corrige o saldo)',
            ],
        ],
        'delivery' => [
            'label' => 'Delivery (iFood + 99Food)',
            'items' => [
                'delivery:operate' => 'Operar o painel de pedidos',
                'delivery:admin' => 'Configurar canais / integrações',
            ],
        ],
        'marmitex' => [
            'label' => 'Marmitex (catering B2B)',
            'items' => [
                'marmitex:order' => 'Enviar pedidos (fluxo da empresa)',
                'marmitex:admin' => 'Gerenciar catálogo, empresas e faturamento',
            ],
        ],
        'vendas' => [
            'label' => 'Vendas (Balcão, Mesas e Comandas)',
            'items' => [
                'vendas:operate' => 'Lançar pedidos, mover o painel e receber pagamento',
                'vendas:admin' => 'Cadastrar mesas/comandas e cancelar pedidos',
            ],
        ],
        'financeiro' => [
            'label' => 'Financeiro (relatórios e análises)',
            'items' => [
                'financeiro:read' => 'Ver DRE, margens e análises',
                'financeiro:admin' => 'Importar planilhas e configurar o plano de contas',
            ],
        ],
        'whatsapp' => [
            'label' => 'WhatsApp',
            'items' => [
                'whatsapp:chat' => 'Ver e responder conversas pela janela do sistema',
            ],
        ],
        'sistema' => [
            'label' => 'Administração',
            'items' => [
                'users:manage' => 'Gerenciar usuários e papéis',
                'system:audit' => 'Ver a trilha de auditoria',
                'system:admin' => 'Ações de sistema (ex.: teste de WhatsApp)',
            ],
        ],
    ];

    /** Cache por request: userId => permissões efetivas. @var array<int,string[]> */
    private static array $userCache = [];
    /** Cache por request: roleKey => permissões do papel. @var array<string,string[]> */
    private static array $roleCache = [];

    /** Lista plana de todas as permissões conhecidas. @return string[] */
    public static function all(): array
    {
        $out = [];
        foreach (self::CATALOG as $group) {
            foreach ($group['items'] as $key => $_) {
                $out[] = $key;
            }
        }
        return $out;
    }

    /** Filtra uma lista para conter só permissões válidas e sem duplicatas. @return string[] */
    public static function sanitize(array $perms): array
    {
        $valid = self::all();
        $out = [];
        foreach ($perms as $p) {
            if (is_string($p) && in_array($p, $valid, true) && !in_array($p, $out, true)) {
                $out[] = $p;
            }
        }
        return $out;
    }

    /** Permissões concedidas por um papel (pela tabela roles). admin = todas. @return string[] */
    public static function forRoleKey(string $key): array
    {
        if ($key === 'admin') {
            return self::all();
        }
        if (!isset(self::$roleCache[$key])) {
            $row = Db::queryOne('SELECT permissions FROM roles WHERE `key` = ? LIMIT 1', [$key]);
            $perms = $row ? json_decode((string) $row['permissions'], true) : [];
            self::$roleCache[$key] = is_array($perms) ? self::sanitize($perms) : [];
        }
        return self::$roleCache[$key];
    }

    /**
     * Permissões EFETIVAS de um usuário: override individual (se houver) senão as
     * do papel. admin sempre recebe todas. Lê do banco (papel/override atuais) —
     * mudanças valem no próximo request, sem precisar relogar.
     * @return string[]
     */
    public static function effectiveForUser(int $userId): array
    {
        if (!isset(self::$userCache[$userId])) {
            $row = Db::queryOne('SELECT role, permissions_json FROM users WHERE id = ?', [$userId]);
            if (!$row) {
                return self::$userCache[$userId] = [];
            }
            if ($row['role'] === 'admin') {
                return self::$userCache[$userId] = self::all();
            }
            $override = $row['permissions_json'] !== null ? json_decode((string) $row['permissions_json'], true) : null;
            self::$userCache[$userId] = is_array($override)
                ? self::sanitize($override)
                : self::forRoleKey((string) $row['role']);
        }
        return self::$userCache[$userId];
    }

    /** Limpa o cache de um usuário (após editar papel/permissões dele). */
    public static function forget(int $userId): void
    {
        unset(self::$userCache[$userId]);
    }
}
