import {
  LayoutDashboard, Tags, Truck, Package, FileSpreadsheet,
  ClipboardList, ShoppingCart, Inbox, ListChecks, Users,
  Bike, Plug, Building2, BookOpen, FileText, Receipt, BarChart3, UtensilsCrossed, Store as StoreIcon, MapPin,
  ScrollText, Palette, ShoppingBag, Armchair,
  ClipboardCheck, SlidersHorizontal, Layers, MessageCircle, Wallet,
  PackageCheck, ArrowDownUp,
} from 'lucide-react';

export type NavItem = {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  end?: boolean;
  perm?: string;
  children?: NavItem[];
  /** Termos extras que levam a esta tela na busca (sinônimos do dia a dia). */
  keywords?: string;
};
export type NavGroup = { title?: string; items: NavItem[] };

/**
 * Registro ÚNICO de navegação — consumido pelo menu lateral, pela barra inferior
 * do celular e pela busca global (Ctrl+K). Antes vivia dentro do Layout, o que
 * fazia toda tela nova precisar ser cadastrada em dois lugares (e ficar de fora
 * da busca quando alguém esquecia do segundo).
 *
 * `perm` ausente = visível a qualquer autenticado; senão exige a permissão que a
 * tela realmente usa (ver App\Core\Permissions no backend).
 *
 * `keywords` existe porque o rótulo do menu nem sempre é a palavra que a pessoa
 * pensa: quem quer o painel do delivery digita "ifood", não "painel de pedidos".
 */
export const navGroups: NavGroup[] = [
  { items: [{ to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true, keywords: 'inicio home visao geral' }] },
  { title: 'Vendas', items: [
    { to: '/vendas', label: 'Painel', icon: ShoppingBag, perm: 'vendas:operate', end: true, keywords: 'pdv balcao caixa venda comanda' },
    { to: '/vendas/estacoes', label: 'Mesas & Comandas', icon: Armchair, perm: 'vendas:admin', keywords: 'mesa comanda estacao' },
  ] },
  { title: 'Delivery', items: [
    { to: '/delivery', label: 'Painel de Pedidos', icon: Bike, perm: 'delivery:operate', keywords: 'ifood 99food entrega pedidos kanban' },
    { to: '/delivery/mapa', label: 'Mapa & Distâncias', icon: MapPin, perm: 'delivery:operate', keywords: 'mapa distancia raio entregador' },
    { to: '/relatorios', label: 'Relatórios', icon: BarChart3, perm: 'delivery:operate', keywords: 'relatorio vendas desempenho clientes' },
    { to: '/cardapio', label: 'Cardápio', icon: BookOpen, perm: 'delivery:admin', end: true, keywords: 'menu itens preco' },
    { to: '/cardapio/complementos', label: 'Complementos', icon: Layers, perm: 'delivery:admin', keywords: 'adicional opcional grupo' },
    { to: '/loja', label: 'Loja (iFood)', icon: StoreIcon, perm: 'delivery:operate', keywords: 'abrir fechar loja pausa horario' },
    { to: '/integrations', label: 'Integrações', icon: Plug, perm: 'delivery:admin', keywords: 'canal token integracao api' },
  ] },
  { title: 'Financeiro', items: [
    { to: '/financeiro', label: 'Relatórios & DRE', icon: Wallet, perm: 'financeiro:read', keywords: 'dre margem custo lucro faturamento cmv' },
  ] },
  { title: 'Compras', items: [
    { to: '/estoque/entradas', label: 'Entradas de mercadoria', icon: PackageCheck, perm: 'estoque:read', keywords: 'recebimento receber nota fiscal nfe conferencia entrada fornecedor' },
    { to: '/estoque/movimentacoes', label: 'Movimentações', icon: ArrowDownUp, perm: 'estoque:read', keywords: 'extrato kardex perda quebra vencimento consumo saida entrada historico' },
    { to: '/estoque/contagem', label: 'Contagem de estoque', icon: ClipboardCheck, perm: 'estoque:read', keywords: 'inventario contar prateleira saldo' },
    { to: '/estoque/parametros', label: 'Parâmetros de reposição', icon: SlidersHorizontal, perm: 'estoque:read', keywords: 'estoque minimo maximo embalagem reposicao' },
    { to: '/inbox', label: 'Caixa de entrada', icon: Inbox, perm: 'compras:write', keywords: 'entrada importacao pendente' },
    { to: '/quotations', label: 'Cotações', icon: ClipboardList, perm: 'compras:write', keywords: 'cotacao orcamento preco fornecedor' },
    { to: '/requests', label: 'Lista de compras', icon: ListChecks, perm: 'compras:requests', keywords: 'requisicao lista comprar' },
    { to: '/orders', label: 'Pedidos a fornecedores', icon: ShoppingCart, perm: 'compras:read', keywords: 'pedido compra fornecedor' },
  ] },
  { title: 'Clientes Empresariais', items: [
    { to: '/marmitex/companies', label: 'Empresas/Clientes', icon: Building2, perm: 'marmitex:admin', keywords: 'empresa cliente contrato marmitex' },
    { to: '/marmitex/catalog', label: 'Cardápio', icon: BookOpen, perm: 'marmitex:admin', keywords: 'marmitex catalogo tamanho proteina' },
    { to: '/marmitex', label: 'Pedidos do dia', icon: UtensilsCrossed, perm: 'marmitex:order', end: true, keywords: 'marmitex pedido dia quentinha' },
    { to: '/marmitex/whatsapp', label: 'WhatsApp (revisão)', icon: MessageCircle, perm: 'marmitex:order', keywords: 'whatsapp zap revisao grupo' },
    { to: '/marmitex/report', label: 'Relatório / NF-e', icon: FileText, perm: 'marmitex:admin', keywords: 'nota fiscal nfe faturar relatorio' },
    { to: '/marmitex/invoices', label: 'Faturamentos', icon: Receipt, perm: 'marmitex:admin', keywords: 'fatura cobranca nota' },
  ] },
  { title: 'Cadastros', items: [
    { to: '/suppliers', label: 'Fornecedores', icon: Truck, perm: 'compras:write', keywords: 'fornecedor distribuidora' },
    { to: '/categories', label: 'Categorias', icon: Tags, perm: 'compras:write', keywords: 'categoria classe' },
    { to: '/products', label: 'Itens & Produtos', icon: Package, perm: 'compras:write', keywords: 'produto item cadastro ficha tecnica insumo' },
    { to: '/import', label: 'Importação', icon: FileSpreadsheet, perm: 'compras:write', keywords: 'importar planilha xlsx xml nfe' },
  ] },
  { title: 'Admin', items: [
    { to: '/users', label: 'Usuários', icon: Users, perm: 'users:manage', keywords: 'usuario papel permissao acesso senha' },
    { to: '/audit', label: 'Auditoria', icon: ScrollText, perm: 'system:audit', keywords: 'auditoria log historico' },
    { to: '/personalizacao', label: 'Personalização', icon: Palette, perm: 'system:admin', keywords: 'marca logo cor tema' },
  ] },
];

/** Achata os grupos em telas visíveis para quem tem estas permissões. */
export function visibleScreens(can: (perm: string) => boolean): (NavItem & { group?: string })[] {
  const out: (NavItem & { group?: string })[] = [];
  for (const g of navGroups) {
    for (const item of g.items) {
      const kids = item.children ?? [item];
      for (const it of kids) {
        if (!it.perm || can(it.perm)) out.push({ ...it, group: g.title });
      }
    }
  }
  return out;
}

/**
 * Atalho do celular: as telas de SERVIÇO, na ordem em que o dia acontece.
 * Só entram as que a pessoa tem permissão de operar; a barra some se sobrar
 * menos de duas (aí o menu lateral já resolve).
 */
export const MOBILE_TABS: NavItem[] = [
  { to: '/vendas', label: 'Vendas', icon: ShoppingBag, perm: 'vendas:operate', end: true },
  { to: '/delivery', label: 'Delivery', icon: Bike, perm: 'delivery:operate' },
  { to: '/marmitex', label: 'Marmitex', icon: UtensilsCrossed, perm: 'marmitex:order', end: true },
  { to: '/estoque/contagem', label: 'Estoque', icon: ClipboardCheck, perm: 'estoque:read' },
];
