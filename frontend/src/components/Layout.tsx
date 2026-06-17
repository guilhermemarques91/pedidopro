import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  LayoutDashboard, Tags, Truck, Package, Combine, FileSpreadsheet,
  ClipboardList, ShoppingCart, LogOut, Inbox, ListChecks, Users, Menu, X,
} from 'lucide-react';
import { useAuth } from '../store/auth.store';
import { inboxApi } from '../services/resources';
import type { UserRole } from '../types';

// `roles` ausente = visível a todos os papéis autenticados.
const nav: { to: string; label: string; icon: typeof LayoutDashboard; end?: boolean; roles?: UserRole[] }[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/requests', label: 'Lista de compras', icon: ListChecks },
  { to: '/inbox', label: 'Caixa de entrada', icon: Inbox, roles: ['admin', 'buyer'] },
  { to: '/categories', label: 'Categorias', icon: Tags, roles: ['admin', 'buyer'] },
  { to: '/suppliers', label: 'Fornecedores', icon: Truck, roles: ['admin', 'buyer'] },
  { to: '/items', label: 'Itens', icon: Package, roles: ['admin', 'buyer'] },
  { to: '/products', label: 'Produtos', icon: Combine, roles: ['admin', 'buyer'] },
  { to: '/import', label: 'Importação', icon: FileSpreadsheet, roles: ['admin', 'buyer'] },
  { to: '/quotations', label: 'Cotações', icon: ClipboardList, roles: ['admin', 'buyer'] },
  { to: '/orders', label: 'Pedidos', icon: ShoppingCart, roles: ['admin', 'buyer', 'approver'] },
  { to: '/users', label: 'Usuários', icon: Users, roles: ['admin'] },
];

export function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const visibleNav = nav.filter((n) => !n.roles || (user && n.roles.includes(user.role)));
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

  return (
    <div className="flex h-screen bg-slate-50">
      {/* Backdrop no mobile quando o menu está aberto */}
      {menuOpen && (
        <div className="fixed inset-0 z-30 bg-black/40 md:hidden" onClick={() => setMenuOpen(false)} />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-slate-200 bg-white transition-transform duration-200 md:static md:translate-x-0 ${
          menuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between px-6 py-5">
          <div className="flex items-center gap-2">
            <ShoppingCart className="text-emerald-600" size={26} />
            <span className="text-xl font-bold text-slate-800">PedidoPro</span>
          </div>
          <button onClick={() => setMenuOpen(false)} className="text-slate-400 hover:text-slate-700 md:hidden" aria-label="Fechar menu">
            <X size={22} />
          </button>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto px-3">
          {visibleNav.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={() => setMenuOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                  isActive ? 'bg-emerald-50 text-emerald-700' : 'text-slate-600 hover:bg-slate-100'
                }`
              }
            >
              <Icon size={18} />
              <span className="flex-1">{label}</span>
              {to === '/inbox' && inboxCount ? (
                <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-xs font-semibold text-white">{inboxCount}</span>
              ) : null}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-slate-200 p-3">
          <div className="px-3 py-2">
            <p className="text-sm font-medium text-slate-800">{user?.name}</p>
            <p className="text-xs capitalize text-slate-500">{user?.role}</p>
          </div>
          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100"
          >
            <LogOut size={18} />
            Sair
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
            <ShoppingCart className="text-emerald-600" size={22} />
            <span className="text-lg font-bold text-slate-800">PedidoPro</span>
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
