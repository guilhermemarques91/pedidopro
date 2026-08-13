import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Search, CornerDownLeft, ArrowUp, ArrowDown, Loader2 } from 'lucide-react';
import { searchApi } from '../services/resources';
import { visibleScreens } from '../config/nav';
import { useAuth } from '../store/auth.store';

/** Linha da paleta: uma tela do app ou um registro vindo da busca do servidor. */
interface Row {
  kind: 'screen' | 'record';
  type: string;            // "Tela" / "Produto" / "Pedido delivery"…
  label: string;
  hint?: string | null;
  to: string;
  Icon?: typeof Search;
}

/** Remove acento e caixa: "Cotações" casa com "cotacoes". */
const norm = (s: string) =>
  s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const permissions = useAuth((s) => s.permissions);
  const can = (p: string) => permissions.includes(p);
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Zera a cada abertura: a paleta sempre começa limpa, como um campo de busca novo.
  // Foco direto (sem requestAnimationFrame): rAF não dispara em aba que não está
  // compondo quadros, e aí a paleta abria sem cursor no campo — que é justamente
  // o que o atalho existe para evitar.
  useEffect(() => {
    if (open) {
      setQ(''); setDebounced(''); setCursor(0);
      inputRef.current?.focus();
    }
  }, [open]);

  // O servidor só é consultado depois que a digitação para — buscar a cada tecla
  // encheria a rede de requisições que ninguém chega a ler.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 180);
    return () => clearTimeout(t);
  }, [q]);

  const screens = useMemo(() => visibleScreens(can), [permissions]);

  // Telas casam localmente (instantâneo, funciona offline) por rótulo, grupo ou sinônimo.
  const screenRows: Row[] = useMemo(() => {
    const term = norm(q.trim());
    const list = screens
      .filter((s) => {
        if (!term) return true;
        return norm(`${s.label} ${s.group ?? ''} ${s.keywords ?? ''}`).includes(term);
      })
      // Rótulo que começa com o termo vem antes de quem só casa no meio/sinônimo.
      .sort((a, b) => {
        if (!term) return 0;
        const pa = norm(a.label).startsWith(term) ? 0 : 1;
        const pb = norm(b.label).startsWith(term) ? 0 : 1;
        return pa - pb || a.label.localeCompare(b.label, 'pt-BR');
      });
    return list.slice(0, term ? 8 : 12).map((s) => ({
      kind: 'screen' as const,
      type: s.group ? `Tela · ${s.group}` : 'Tela',
      label: s.label,
      to: s.to,
      Icon: s.icon,
    }));
  }, [screens, q]);

  const { data, isFetching } = useQuery({
    queryKey: ['search', debounced],
    queryFn: () => searchApi.query(debounced),
    enabled: open && debounced.length >= 2,
    staleTime: 30_000,
  });

  const recordRows: Row[] = useMemo(
    () => (data?.results ?? []).map((r) => ({ kind: 'record' as const, type: r.type, label: r.label, hint: r.hint, to: r.to })),
    [data],
  );

  const rows = useMemo(() => [...screenRows, ...recordRows], [screenRows, recordRows]);

  // O cursor não pode ficar apontando para uma linha que sumiu ao refinar a busca.
  useEffect(() => { setCursor((c) => (c >= rows.length ? 0 : c)); }, [rows.length]);

  function go(row: Row | undefined) {
    if (!row) return;
    onClose();
    navigate(row.to);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => (rows.length ? (c + 1) % rows.length : 0)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => (rows.length ? (c - 1 + rows.length) % rows.length : 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); go(rows[cursor]); }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    else if (e.key === 'Home') { e.preventDefault(); setCursor(0); }
    else if (e.key === 'End') { e.preventDefault(); setCursor(Math.max(0, rows.length - 1)); }
  }

  // Mantém a linha selecionada visível ao andar com as setas por uma lista longa.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-row="${cursor}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  if (!open) return null;

  let lastType = '';
  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center bg-slate-900/50 p-3 pt-[10vh] backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="flex max-h-[75vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Busca global"
      >
        <div className="flex items-center gap-2 border-b border-slate-200 px-4">
          <Search size={18} className="shrink-0 text-slate-400" />
          <input
            ref={inputRef}
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Buscar tela, produto, fornecedor, pedido…"
            aria-label="Buscar"
            className="min-h-12 w-full bg-transparent py-3 text-base outline-none placeholder:text-slate-400"
          />
          {isFetching && <Loader2 size={16} className="shrink-0 animate-spin text-slate-400" />}
        </div>

        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto py-2">
          {rows.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-slate-500">
              {debounced.length >= 2 ? 'Nada encontrado.' : 'Digite para buscar.'}
            </p>
          ) : (
            rows.map((row, i) => {
              const header = row.type !== lastType ? row.type : null;
              lastType = row.type;
              const active = i === cursor;
              return (
                <div key={`${row.to}-${i}`}>
                  {header && (
                    <p className="px-4 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-slate-400">{header}</p>
                  )}
                  <button
                    type="button"
                    data-row={i}
                    onMouseEnter={() => setCursor(i)}
                    onClick={() => go(row)}
                    className={`flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm ${
                      active ? 'bg-emerald-50 text-emerald-900' : 'text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {row.Icon ? <row.Icon size={16} className={active ? 'text-emerald-600' : 'text-slate-400'} /> : <span className="w-4" />}
                    <span className="min-w-0 flex-1 truncate">{row.label}</span>
                    {row.hint && <span className="shrink-0 text-xs text-slate-400">{row.hint}</span>}
                    {active && <CornerDownLeft size={14} className="shrink-0 text-emerald-600" />}
                  </button>
                </div>
              );
            })
          )}
        </div>

        <div className="hidden items-center gap-4 border-t border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-500 sm:flex">
          <span className="flex items-center gap-1"><ArrowUp size={12} /><ArrowDown size={12} /> navegar</span>
          <span className="flex items-center gap-1"><CornerDownLeft size={12} /> abrir</span>
          <span><kbd className="rounded border border-slate-300 bg-white px-1">Esc</kbd> fechar</span>
        </div>
      </div>
    </div>
  );
}
