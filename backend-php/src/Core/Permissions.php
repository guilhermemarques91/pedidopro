<?php

namespace App\Core;

/**
 * Permissões por módulo (Etapa 0 do roadmap ERP).
 *
 * Evolui os guards de papel (admin/buyer/approver/…) para capacidades granulares
 * no formato `modulo:acao` (ex.: `compras:write`, `delivery:operate`). O papel do
 * usuário continua sendo a unidade de atribuição — a MATRIX abaixo diz quais
 * permissões cada papel concede. Quando um módulo novo (estoque/financeiro) chegar,
 * basta declarar as permissões dele aqui e usá-las nos guards de Routes.php.
 *
 * `admin` é superusuário: tem TODAS as permissões (não precisa listar na MATRIX).
 */
final class Permissions
{
    /** Catálogo canônico de permissões, agrupado por módulo (para UI/documentação). */
    public const ALL = [
        // Compras & cadastros (fornecedores, itens, produtos, cotações, pedidos, requisições, inbox, import)
        'compras:read',       // ler cadastros/cotações/pedidos/requisições
        'compras:write',      // criar/editar fornecedores, itens, produtos, cotações, pedidos, inbox, import
        'compras:approve',    // aprovar/recusar pedidos
        'compras:requests',   // criar/enviar/cancelar requisições (listas de compra)
        'compras:admin',      // excluir cadastros, alocar requisição, gerar pedidos, gerir categorias
        // Delivery (agregador iFood + 99Food)
        'delivery:operate',   // operar o painel (confirmar/despachar/cancelar, alertas, loja)
        'delivery:admin',     // configurar canais/integrações, sincronização manual
        // Marmitex (catering B2B)
        'marmitex:order',      // fluxo da empresa-cliente (catálogo, própria empresa, pedidos, etiquetas)
        'marmitex:admin',      // catálogo, empresas-cliente, relatórios/faturamento
        // Administração / sistema
        'users:manage',        // CRUD de usuários
        'system:admin',        // ações de sistema (ex.: teste de WhatsApp)
    ];

    /**
     * Papel → permissões concedidas. `admin` fica de fora (superusuário, ver forRole/roleHas).
     * @var array<string,string[]>
     */
    private const MATRIX = [
        'buyer' => [
            'compras:read', 'compras:write', 'compras:requests', 'delivery:operate',
        ],
        'approver' => [
            'compras:read', 'compras:approve', 'delivery:operate',
        ],
        'requester' => [
            'compras:read', 'compras:requests',
        ],
        // Login da empresa-cliente do Marmitex: só o próprio fluxo de pedidos.
        'company' => [
            'marmitex:order',
        ],
    ];

    /** Permissões efetivas de um papel (admin recebe todas). @return string[] */
    public static function forRole(string $role): array
    {
        if ($role === 'admin') {
            return self::ALL;
        }
        return self::MATRIX[$role] ?? [];
    }

    /** O papel concede a permissão? (admin = sempre) */
    public static function roleHas(string $role, string $perm): bool
    {
        if ($role === 'admin') {
            return true;
        }
        return in_array($perm, self::MATRIX[$role] ?? [], true);
    }
}
