import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  LogOut, Menu, X, Search,
  ChevronDown, ChevronRight, PanelLeftClose, PanelLeft,
} from 'lucide-react';
import { useAuth } from '../store/auth.store';
import { inboxApi, marmitexApi, ordersApi } from '../services/resources';
import { AppName, Logo } from '../config/brand';
import { AutoPrint } from './AutoPrint';
import { VersionWatcher } from './VersionWatcher';
import { AppDock } from './AppDock/AppDock';
import { DockLauncher } from './AppDock/DockLauncher';
import { CommandPalette } from './CommandPalette';
import { BottomNav } from './BottomNav';
import { navGroups, type NavItem } from '../config/nav';

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

/** Item folha ou pai visível dadas as permissões (filtra `children` recursivamente). */
function filterItem(item: NavItem, can: (perm: string) => boolean): NavItem | null {
  const visibleSelf = !item.perm || can(item.perm);
  if (item.children) {
    const kids = item.children.map((c) => filterItem(c, can)).filter(Boolean) as NavItem[];
    if (kids.length === 0) return null;
    return { ...item, children: kids };
  }
  return visibleSelf ? item : null;
}

export function Layout() {
  const { user, logout } = useAuth();
  const permissions = useAuth((s) => s.permissions);
  const can = (perm: string) => permissions.includes(perm);
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<boolean>(() => loadJSON<boolean>(COLLAPSED_KEY, false));
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => loadJSON<Record<string, boolean>>(GROUPS_KEY, {}));
  const [openSubs, setOpenSubs] = useState<Record<string, boolean>>({});

  // Modo "trilho" (só ícones) vale apenas no desktop recolhido. No drawer do mobile
  // (menuOpen) sempre mostramos os rótulos — senão fica largo e sem os nomes.
  const rail = collapsed && !menuOpen;

  const visibleGroups = navGroups
    .map((g) => ({ ...g, items: g.items.map((n) => filterItem(n, can)).filter(Boolean) as NavItem[] }))
    .filter((g) => g.items.length > 0);

  // Contagem de pendentes na caixa de entrada (atualiza a cada 60s).
  const { data: inboxCount } = useQuery({
    queryKey: ['inbox-count'],
    queryFn: inboxApi.count,
    refetchInterval: 60_000,
  });
  // Pedidos do WhatsApp esperando revisão (só para quem opera o marmitex).
  const { data: waCount } = useQuery({
    queryKey: ['marmitex-wa-count'],
    queryFn: marmitexApi.whatsapp.count,
    enabled: can('marmitex:order'),
    refetchInterval: 60_000,
  });
  // Pedidos de compra parados esperando aprovação (só quem aprova precisa ver).
  const { data: approvalCount } = useQuery({
    queryKey: ['orders-pending-approval-count'],
    queryFn: ordersApi.pendingApprovalCount,
    enabled: can('compras:approve'),
    refetchInterval: 60_000,
  });
  const badges: Record<string, number | undefined> = {
    '/inbox': inboxCount,
    '/marmitex/whatsapp': waCount,
    '/orders': approvalCount,
  };

  function handleLogout() {
    logout();
    navigate('/login');
  }

  /**
   * Atalho global da busca: Ctrl+K (Cmd+K no Mac) e também "/" — a tecla que a
   * maioria dos apps usa e que sai barata num teclado físico.
   *
   * "/" só vale fora de campo de texto, senão não daria para digitar uma barra
   * em lugar nenhum. Ctrl+K vale sempre, inclusive dentro de um campo.
   */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const k = e.key.toLowerCase();
      const el = document.activeElement as HTMLElement | null;
      const digitando = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
      if ((e.ctrlKey || e.metaKey) && k === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      } else if (k === '/' && !digitando && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        setPaletteOpen(true);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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

  // Item ativo ganha uma barra vertical à esquerda além do fundo: a posição no menu
  // fica legível de relance, sem depender só da diferença de cor (que some para quem
  // tem baixa visão ou daltonismo).
  // Trilho escuro: o item ativo vira uma pílula com tinta da marca e texto branco; os
  // inativos ficam em cinza claro e acendem no hover. A barra vertical à esquerda
  // continua, para a posição não depender só de cor.
  const navItemClass = (isActive: boolean, extra = '') =>
    `group relative flex min-h-[var(--control-h)] items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 ${
      isActive
        ? 'bg-emerald-500/15 text-white before:absolute before:left-0 before:top-1/2 before:h-5 before:w-1 before:-translate-y-1/2 before:rounded-r-full before:bg-emerald-400'
        : 'text-slate-400 hover:bg-white/5 hover:text-white'
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
        title={rail ? label : undefined}
        className={({ isActive }) => navItemClass(isActive, rail ? 'justify-center px-2' : depth ? 'pl-9' : '')}
      >
        {/* Função como filho para o ÍCONE também reagir ao estado ativo (acende em
            emerald), não só o fundo da pílula. */}
        {({ isActive }) => (
          <>
            <Icon size={18} className={`shrink-0 ${isActive ? 'text-emerald-400' : ''}`} />
            {!rail && <span className="flex-1">{label}</span>}
            {!rail && badges[to] ? (
              <span className="rounded-full bg-emerald-500 px-2 py-0.5 text-xs font-semibold text-slate-900">{badges[to]}</span>
            ) : null}
          </>
        )}
      </NavLink>
    );
  }

  // Item com filhos: no modo expandido vira accordion; no trilho, achata os filhos.
  function renderItem(item: NavItem) {
    if (!item.children) return renderLeaf(item);
    if (rail) return <div key={item.to + item.label}>{item.children.map((c) => renderLeaf(c))}</div>;
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
    // Casca escura: o trilho lateral é escuro e o conteúdo vira um painel claro com o
    // canto arredondado por cima dele — a moldura das referências. O fundo da raiz
    // precisa ser escuro para aparecer atrás desse canto arredondado.
    <div className="flex h-screen bg-slate-900">
      {/* Recarrega a aba quando sai versão nova (evita bundle velho imprimindo duplicado). */}
      <VersionWatcher />
      {/* Impressão automática de comandas: roda em qualquer página (não só no painel). */}
      {can('delivery:operate') && <AutoPrint />}
      {/* Janelas flutuantes (iFood, 99). Montadas aqui para sobreviverem à troca
          de rota — remontar recarregaria o iframe e derrubaria o login do portal. */}
      <AppDock />
      {/* Backdrop no mobile quando o menu está aberto */}
      {menuOpen && (
        <div className="fixed inset-0 z-30 bg-black/40 md:hidden" onClick={() => setMenuOpen(false)} />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex flex-col bg-slate-900 text-slate-300 transition-[width,transform] duration-200 md:static md:translate-x-0 ${
          rail ? 'w-16' : 'w-60'
        } ${menuOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className={`flex items-center py-5 ${rail ? 'justify-center px-2' : 'justify-between px-4'}`}>
          {!rail && (
            <div className="flex min-w-0 items-center gap-2.5">
              {/* Logo numa placa clara: a marca costuma ser escura e sumiria no trilho. */}
              <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white/95">
                <Logo size={24} />
              </span>
              <span className="truncate text-lg font-bold tracking-tight text-white"><AppName /></span>
            </div>
          )}
          {/* Toggle do trilho — só desktop */}
          <button
            onClick={toggleCollapsed}
            className="hidden items-center justify-center rounded-lg p-2 text-slate-400 transition-colors hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 md:inline-flex"
            aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}
            title={collapsed ? 'Expandir menu' : 'Recolher menu'}
          >
            {collapsed ? <PanelLeft size={18} /> : <PanelLeftClose size={18} />}
          </button>
          {/* Fechar drawer — só mobile (alvo de 44px: é tocado com o polegar) */}
          <button
            onClick={() => setMenuOpen(false)}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 md:hidden"
            aria-label="Fechar menu"
          >
            <X size={20} />
          </button>
        </div>

        <nav className={`flex-1 space-y-2 overflow-y-auto pb-4 ${rail ? 'px-2' : 'px-3'}`}>
          {visibleGroups.map((group, gi) => {
            if (!group.title) {
              return <div key={`g${gi}`} className="space-y-1">{group.items.map((it) => renderItem(it))}</div>;
            }
            const open = rail || isGroupOpen(group.title, group.items);
            return (
              <div key={group.title} className="space-y-1">
                {rail ? (
                  <div className="my-1 border-t border-white/10" />
                ) : (
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.title!, group.items)}
                    className="flex w-full items-center justify-between rounded-lg px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-slate-500 transition-colors hover:text-slate-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
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

        <div className={`border-t border-white/10 p-3 ${rail ? 'px-2' : ''}`}>
          {!rail && (
            <div className="flex items-center gap-2.5 px-2 py-2">
              {/* Inicial do usuário num círculo — âncora visual do rodapé, como nas refs. */}
              <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-sm font-semibold text-emerald-300">
                {(user?.name ?? '?').trim().charAt(0).toUpperCase()}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-white">{user?.name}</p>
                <p className="truncate text-xs capitalize text-slate-400">{user?.role}</p>
              </div>
            </div>
          )}
          <button
            onClick={handleLogout}
            title={rail ? 'Sair' : undefined}
            className={`flex min-h-[var(--control-h)] w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-slate-400 transition-colors hover:bg-red-500/15 hover:text-red-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 ${
              rail ? 'justify-center px-2' : ''
            }`}
          >
            <LogOut size={18} className="shrink-0" />
            {!rail && 'Sair'}
          </button>
        </div>
      </aside>

      {/* Painel de conteúdo: claro, com o canto arredondado recortando o trilho escuro.
          `overflow-hidden` garante que o conteúdo respeite o arredondado ao rolar. */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-[#F4F5FA] md:rounded-l-[1.75rem]">
        {/* Barra superior: faixa fina, presente em todas as telas. O menu e a marca
            só aparecem no mobile (no desktop já estão no trilho lateral); no desktop
            ela existe apenas para ancorar os botões dos apps à direita. */}
        <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-2">
          <button onClick={() => setMenuOpen(true)} className="text-slate-600 hover:text-slate-900 md:hidden" aria-label="Abrir menu">
            <Menu size={24} />
          </button>
          <div className="flex items-center gap-2 md:hidden">
            <Logo size={22} />
            <span className="text-lg font-bold text-slate-800"><AppName /></span>
          </div>

          {/* Busca: no desktop vira um campo falso que anuncia o atalho (só assim
              alguém descobre que Ctrl+K existe); no celular, um botão de ícone. */}
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            aria-label="Buscar (Ctrl+K)"
            className="ml-auto hidden min-h-9 w-72 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-400 transition-colors hover:border-slate-300 hover:text-slate-600 md:flex"
          >
            <Search size={15} />
            <span className="flex-1 text-left">Buscar…</span>
            <kbd className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[11px] font-medium text-slate-500">Ctrl K</kbd>
          </button>
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            aria-label="Buscar"
            className="ml-auto inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 md:hidden"
          >
            <Search size={20} />
          </button>

          <div className="md:ml-3">
            <DockLauncher />
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">
          {/* Largura fluida: o limite de 6xl (1152px) sobrava ~260px de margem morta de
              cada lado num monitor de 1920. O teto de 120rem só entra em tela gigante,
              para a linha de texto não ficar absurda em 4K.
              pb-24 no mobile: a barra de abas é fixa e comeria o fim da página. */}
          <div className="mx-auto w-full max-w-[120rem] p-4 pb-24 sm:p-6 lg:p-8 md:pb-8">
            <Outlet />
          </div>
        </main>
      </div>

      <BottomNav onOpenMenu={() => setMenuOpen(true)} />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
