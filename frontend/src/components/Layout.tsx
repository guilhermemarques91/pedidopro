import { useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  LayoutDashboard, Tags, Truck, Package, FileSpreadsheet,
  ClipboardList, ShoppingCart, LogOut, Inbox, ListChecks, Users, Menu, X,
  Bike, Plug, Building2, BookOpen, FileText, Receipt, BarChart3, UtensilsCrossed, Store as StoreIcon, MapPin,
  ChevronDown, ChevronRight, PanelLeftClose, PanelLeft,
} from 'lucide-react';
import { useAuth } from '../store/auth.store';
import { inboxApi } from '../services/resources';
import type { UserRole } from '../types';
import { APP_NAME, Logo } from '../config/brand';

type NavItem = {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  end?: boolean;
  roles?: UserRole[];
  children?: NavItem[];
};
type NavGroup = { title?: string; items: NavItem[] };

// `roles` ausente = visível a todos os papéis autenticados.
// Menu agrupado por área. Grupos com título recolhem (accordion) e o menu
// inteiro pode virar um trilho só de ícones (ver estado `collapsed`).
const navGroups: NavGroup[] = [
  { items: [{ to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true }] },
  { title: 'Delivery', items: [
    { to: '/delivery', label: 'Painel de Pedidos', icon: Bike, roles: ['admin', 'buyer', 'approver'] },
    { to: '/relatorios', label: 'Relatórios', icon: BarChart3, roles: ['admin', 'buyer', 'approver'] },
    { to: '/delivery/mapa', label: 'Mapa & Distâncias', icon: MapPin, roles: ['admin', 'buyer', 'approver'] },
    { to: '/cardapio', label: 'Cardápio', icon: BookOpen, roles: ['admin', 'buyer'] },
    { to: '/loja', label: 'Loja', icon: StoreIcon, roles: ['admin', 'buyer'] },
    { to: '/integrations', label: 'Integrações', icon: Plug, roles: ['admin'] },
  ] },
  { title: 'Compras', items: [
    { to: '/inbox', label: 'Caixa de entrada', icon: Inbox, roles: ['admin', 'buyer'] },
    { to: '/quotations', label: 'Cotações', icon: ClipboardList, roles: ['admin', 'buyer'] },
    { to: '/requests', label: 'Lista de compras', icon: ListChecks },
    { to: '/orders', label: 'Pedidos a fornecedores', icon: ShoppingCart, roles: ['admin', 'buyer', 'approver'] },
  ] },
  { title: 'Clientes Empresariais', items: [
    { to: '/marmitex/companies', label: 'Empresas/Clientes', icon: Building2, roles: ['admin'] },
    { to: '/marmitex/catalog', label: 'Cardápio', icon: BookOpen, roles: ['admin'] },
    { to: '/marmitex', label: 'Pedidos do dia', icon: UtensilsCrossed, roles: ['admin', 'company'], end: true },
    { to: '/marmitex/report', label: 'Relatório / NF-e', icon: FileText, roles: ['admin'] },
    { to: '/marmitex/invoices', label: 'Faturamentos', icon: Receipt, roles: ['admin'] },
  ] },
  { title: 'Cadastros', items: [
    { to: '/suppliers', label: 'Fornecedores', icon: Truck, roles: ['admin', 'buyer'] },
    { to: '/categories', label: 'Categorias', icon: Tags, roles: ['admin', 'buyer'] },
    { to: '/items', label: 'Itens/Produtos', icon: Package, roles: ['admin', 'buyer'], children: [
      { to: '/items', label: 'Itens', icon: Package, roles: ['admin', 'buyer'], end: true },
      { to: '/products', label: 'Produtos', icon: Package, roles: ['admin', 'buyer'] },
    ] },
    { to: '/import', label: 'Importação', icon: FileSpreadsheet, roles: ['admin', 'buyer'] },
  ] },
  { title: 'Admin', items: [
    { to: '/users', label: 'Usuários', icon: Users, roles: ['admin'] },
  ] },
];

// --- Persistência simples em localStorage (mesmo padrão manual do auth.store) ---
function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function saveJSON(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignora quota/privacidade */
  }
}
const GROUPS_KEY = 'sidebar:groups';
const COLLAPSED_KEY = 'sidebar:collapsed';

/** Item folha ou pai visível para o papel do usuário (filtra `children` recursivamente). */
function filterItem(item: NavItem, role?: UserRole): NavItem | null {
  const visibleSelf = !item.roles || (role && item.roles.includes(role));
  if (item.children) {
    const kids = item.children.map((c) => filterItem(c, role)).filter(Boolean) as NavItem[];
    if (kids.length === 0) return null;
    return { ...item, children: kids };
  }
  return visibleSelf ? item : null;
}

export function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<boolean>(() => loadJSON<boolean>(COLLAPSED_KEY, false));
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => loadJSON<Record<string, boolean>>(GROUPS_KEY, {}));
  const [openSubs, setOpenSubs] = useState<Record<string, boolean>>({});

  const visibleGroups = navGroups
    .map((g) => ({ ...g, items: g.items.map((n) => filterItem(n, user?.role)).filter(Boolean) as NavItem[] }))
    .filter((g) => g.items.length > 0);

  // Contagem de pendentes na caixa de entrada (atualiza a cada 60s).
  const { data: inboxCount } = useQuery({
    queryKey: ['inbox-count'],
    queryFn: inboxApi.count,
    refetchInterval: 60_000,
  });

  function handleLogout() {
    logout();
    navigate('/login');
  }

  // Um grupo está aberto se salvo explicitamente; senão, abre por conter a rota ativa.
  function isGroupOpen(title: string, items: NavItem[]): boolean {
    if (title in openGroups) return openGroups[title];
    return items.some((it) =>
      location.pathname === it.to ||
      (!it.end && it.to !== '/' && location.pathname.startsWith(it.to)) ||
      it.children?.some((c) => location.pathname === c.to || (!c.end && location.pathname.startsWith(c.to))),
    );
  }
  function toggleGroup(title: string, items: NavItem[]) {
    const next = { ...openGroups, [title]: !isGroupOpen(title, items) };
    setOpenGroups(next);
    saveJSON(GROUPS_KEY, next);
  }
  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    saveJSON(COLLAPSED_KEY, next);
  }
  function isSubOpen(item: NavItem): boolean {
    if (item.to in openSubs) return openSubs[item.to];
    return !!item.children?.some((c) => location.pathname === c.to || (!c.end && location.pathname.startsWith(c.to)));
  }

  const navItemClass = (isActive: boolean, extra = '') =>
    `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
      isActive ? 'bg-emerald-50 text-emerald-700' : 'text-slate-600 hover:bg-slate-100'
    } ${extra}`;

  // Renderiza um item folha (NavLink). `depth` controla o recuo dos filhos.
  function renderLeaf(item: NavItem, depth = 0) {
    const { to, label, icon: Icon, end } = item;
    return (
      <NavLink
        key={to + label}
        to={to}
        end={end}
        onClick={() => setMenuOpen(false)}
        title={collapsed ? label : undefined}
        className={({ isActive }) => navItemClass(isActive, collapsed ? 'justify-center px-2' : depth ? 'pl-9' : '')}
      >
        <Icon size={18} className="shrink-0" />
        {!collapsed && <span className="flex-1">{label}</span>}
        {!collapsed && to === '/inbox' && inboxCount ? (
          <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-xs font-semibold text-white">{inboxCount}</span>
        ) : null}
      </NavLink>
    );
  }

  // Item com filhos: no modo expandido vira accordion; no trilho, achata os filhos.
  function renderItem(item: NavItem) {
    if (!item.children) return renderLeaf(item);
    if (collapsed) return <div key={item.to + item.label}>{item.children.map((c) => renderLeaf(c))}</div>;
    const open = isSubOpen(item);
    const { icon: Icon, label, to } = item;
    return (
      <div key={to + label}>
        <button
          type="button"
          onClick={() => setOpenSubs((s) => ({ ...s, [to]: !open }))}
          className={navItemClass(false, 'w-full')}
        >
          <Icon size={18} className="shrink-0" />
          <span className="flex-1 text-left">{label}</span>
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>
        {open && <div className="mt-1 space-y-1">{item.children.map((c) => renderLeaf(c, 1))}</div>}
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-slate-50">
      {/* Backdrop no mobile quando o menu está aberto */}
      {menuOpen && (
        <div className="fixed inset-0 z-30 bg-black/40 md:hidden" onClick={() => setMenuOpen(false)} />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex flex-col border-r border-slate-200 bg-white transition-all duration-200 md:static md:translate-x-0 ${
          collapsed ? 'w-16' : 'w-60'
        } ${menuOpen ? 'w-60 translate-x-0' : '-translate-x-full'}`}
      >
        <div className={`flex items-center py-5 ${collapsed ? 'justify-center px-2' : 'justify-between px-4'}`}>
          {!collapsed && (
            <div className="flex min-w-0 items-center gap-2">
              <Logo size={26} />
              <span className="truncate text-xl font-bold text-slate-800">{APP_NAME}</span>
            </div>
          )}
          {/* Toggle do trilho — só desktop */}
          <button
            onClick={toggleCollapsed}
            className="hidden text-slate-400 hover:text-slate-700 md:block"
            aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}
            title={collapsed ? 'Expandir menu' : 'Recolher menu'}
          >
            {collapsed ? <PanelLeft size={20} /> : <PanelLeftClose size={20} />}
          </button>
          {/* Fechar drawer — só mobile */}
          <button onClick={() => setMenuOpen(false)} className="text-slate-400 hover:text-slate-700 md:hidden" aria-label="Fechar menu">
            <X size={22} />
          </button>
        </div>

        <nav className={`flex-1 space-y-2 overflow-y-auto pb-4 ${collapsed ? 'px-2' : 'px-3'}`}>
          {visibleGroups.map((group, gi) => {
            if (!group.title) {
              return <div key={`g${gi}`} className="space-y-1">{group.items.map((it) => renderItem(it))}</div>;
            }
            const open = collapsed || isGroupOpen(group.title, group.items);
            return (
              <div key={group.title} className="space-y-1">
                {collapsed ? (
                  <div className="my-1 border-t border-slate-100" />
                ) : (
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.title!, group.items)}
                    className="flex w-full items-center justify-between rounded-lg px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-slate-400 hover:text-slate-600"
                  >
                    <span>{group.title}</span>
                    {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </button>
                )}
                {open && <div className="space-y-1">{group.items.map((it) => renderItem(it))}</div>}
              </div>
            );
          })}
        </nav>

        <div className={`border-t border-slate-200 p-3 ${collapsed ? 'px-2' : ''}`}>
          {!collapsed && (
            <div className="px-3 py-2">
              <p className="truncate text-sm font-medium text-slate-800">{user?.name}</p>
              <p className="text-xs capitalize text-slate-500">{user?.role}</p>
            </div>
          )}
          <button
            onClick={handleLogout}
            title={collapsed ? 'Sair' : undefined}
            className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 ${
              collapsed ? 'justify-center px-2' : ''
            }`}
          >
            <LogOut size={18} className="shrink-0" />
            {!collapsed && 'Sair'}
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Barra superior — só no mobile */}
        <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 md:hidden">
          <button onClick={() => setMenuOpen(true)} className="text-slate-600 hover:text-slate-900" aria-label="Abrir menu">
            <Menu size={24} />
          </button>
          <div className="flex items-center gap-2">
            <Logo size={22} />
            <span className="text-lg font-bold text-slate-800">{APP_NAME}</span>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-6xl p-4 sm:p-6 md:p-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
