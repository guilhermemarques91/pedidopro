import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  LayoutDashboard, Tags, Truck, Package, FileSpreadsheet,
  ClipboardList, ShoppingCart, LogOut, Inbox,
} from 'lucide-react';
import { useAuth } from '../store/auth.store';
import { inboxApi } from '../services/resources';

const nav = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/inbox', label: 'Caixa de entrada', icon: Inbox },
  { to: '/categories', label: 'Categorias', icon: Tags },
  { to: '/suppliers', label: 'Fornecedores', icon: Truck },
  { to: '/items', label: 'Itens', icon: Package },
  { to: '/import', label: 'Importação', icon: FileSpreadsheet },
  { to: '/quotations', label: 'Cotações', icon: ClipboardList },
  { to: '/orders', label: 'Pedidos', icon: ShoppingCart },
];

export function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
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
      <aside className="flex w-60 flex-col border-r border-slate-200 bg-white">
        <div className="flex items-center gap-2 px-6 py-5">
          <ShoppingCart className="text-emerald-600" size={26} />
          <span className="text-xl font-bold text-slate-800">PedidoPro</span>
        </div>
        <nav className="flex-1 space-y-1 px-3">
          {nav.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
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
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl p-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
