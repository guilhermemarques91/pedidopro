import { NavLink } from 'react-router-dom';
import { Menu } from 'lucide-react';
import { MOBILE_TABS } from '../config/nav';
import { useAuth } from '../store/auth.store';

/**
 * Barra de abas do celular — só as telas de SERVIÇO, sempre a um toque.
 *
 * O menu lateral é uma gaveta: trocar de tela custava dois toques (abrir, escolher)
 * com a mão ocupada no meio do almoço. Aqui é um. O botão "Menu" abre a gaveta para
 * todo o resto, que é consulta e configuração — não tem pressa.
 *
 * Some no desktop (`md:hidden`), onde o trilho lateral já está sempre visível.
 */
export function BottomNav({ onOpenMenu }: { onOpenMenu: () => void }) {
  const permissions = useAuth((s) => s.permissions);
  const tabs = MOBILE_TABS.filter((t) => !t.perm || permissions.includes(t.perm));

  // Com 0 ou 1 tela de serviço a barra não paga o espaço que ocupa na tela.
  if (tabs.length < 2) return null;

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 flex border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] shadow-[0_-2px_8px_rgba(15,23,42,0.06)] md:hidden"
      aria-label="Navegação rápida"
    >
      {tabs.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            `flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors ${
              isActive ? 'text-emerald-600' : 'text-slate-500'
            }`
          }
        >
          {({ isActive }) => (
            <>
              {/* Traço no topo em vez de só cor: a aba ativa continua legível para
                  quem não distingue bem verde de cinza. */}
              <span className={`h-0.5 w-8 rounded-full ${isActive ? 'bg-emerald-500' : 'bg-transparent'}`} />
              <Icon size={20} />
              <span>{label}</span>
            </>
          )}
        </NavLink>
      ))}
      <button
        type="button"
        onClick={onOpenMenu}
        className="flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium text-slate-500"
      >
        <span className="h-0.5 w-8 rounded-full bg-transparent" />
        <Menu size={20} />
        <span>Menu</span>
      </button>
    </nav>
  );
}
