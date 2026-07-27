import { ReactNode, ButtonHTMLAttributes, InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes, useEffect, useId, useRef, useState } from 'react';
import { AlertCircle, ChevronDown, MoreVertical, Plus } from 'lucide-react';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

// Cada variante leva a cor do próprio anel de foco: um anel emerald sobre o botão
// vermelho de excluir ficaria ilegível.
// `secondary` passou de cinza cheio (slate-200, pesado) para uma superfície branca
// com borda — hierarquia mais clara: só a ação principal tem peso de cor.
const variants: Record<Variant, string> = {
  primary: 'bg-emerald-600 text-white shadow-[var(--shadow-xs)] hover:bg-emerald-700 active:translate-y-px focus-visible:ring-emerald-600',
  secondary: 'border border-slate-200 bg-white text-slate-700 shadow-[var(--shadow-xs)] hover:border-slate-300 hover:bg-slate-50 active:translate-y-px focus-visible:ring-slate-400',
  danger: 'bg-red-600 text-white shadow-[var(--shadow-xs)] hover:bg-red-700 active:translate-y-px focus-visible:ring-red-600',
  ghost: 'bg-transparent text-slate-600 hover:bg-slate-100 active:translate-y-px focus-visible:ring-slate-400',
};

export function Button({
  variant = 'primary', className = '', children, ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      // min-h pelo token: 38px no mouse, 44px no toque (o dedo erra alvo menor).
      // focus-visible (não focus): o anel aparece para quem navega por teclado e não
      // pisca a cada clique de mouse. Antes não havia indicação de foco nenhuma.
      // active:translate-y-px dá a resposta tátil de "afundou" ao tocar.
      // Transição EXPLÍCITA (nunca `transition-all`): all anima também largura/altura e
      // custom properties, o que causa jank e — visto aqui na prática — deixa a cor de
      // fundo presa num valor antigo quando a cor da marca muda em runtime.
      className={`inline-flex min-h-[var(--control-h)] items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-[background-color,border-color,color,box-shadow,translate] duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 disabled:active:translate-y-0 ${variants[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

// Base comum dos campos. Borda slate-200 (em vez de 300) deixa o formulário mais
// calmo: a borda marca o campo sem competir com o conteúdo. O anel de foco de 2px
// substitui o de 1px — indicação mais clara de onde o cursor está.
const controlBase =
  'w-full min-h-[var(--control-h)] rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 shadow-[var(--shadow-xs)] outline-none transition-colors ' +
  'placeholder:text-slate-400 hover:border-slate-300 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/25 ' +
  'disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500';

export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${controlBase} ${className}`} {...props} />;
}

export function Textarea({ className = '', ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`${controlBase} py-2.5 leading-relaxed ${className}`} {...props} />;
}

export function Select({ className = '', children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={`${controlBase} cursor-pointer pr-8 ${className}`} {...props}>
      {children}
    </select>
  );
}

export interface ComboOption { value: string; label: string; hint?: string }

/** Select com filtro por texto digitado. Com `onCreate`, permite criar um item pelo texto buscado. */
export function Combobox({
  options, value, onChange, placeholder = 'Buscar…', disabled = false, onCreate,
}: {
  options: ComboOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  onCreate?: (label: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value);

  // Fecha ao clicar fora.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const q = search.trim().toLowerCase();
  const filtered = q
    ? options.filter((o) => o.label.toLowerCase().includes(q) || o.hint?.toLowerCase().includes(q))
    : options;
  // Oferece criar quando há texto digitado sem correspondência exata de nome.
  const canCreate = !!onCreate && q.length > 0 && !options.some((o) => o.label.toLowerCase() === q);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          setOpen((v) => !v);
          setSearch('');
          // No celular o popover pode ficar atrás do teclado; rola o campo para o centro ao abrir.
          requestAnimationFrame(() => ref.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
        }}
        className="flex w-full min-h-[var(--control-h)] items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-sm shadow-[var(--shadow-xs)] outline-none transition-colors hover:border-slate-300 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className={selected ? 'text-slate-800' : 'text-slate-400'}>{selected ? selected.label : placeholder}</span>
        <ChevronDown size={16} className="ml-2 shrink-0 text-slate-400" />
      </button>
      {open && (
        <div className="ui-animate-pop absolute z-50 mt-1.5 w-full rounded-xl border border-slate-200/80 bg-white shadow-[var(--shadow-lg)]">
          <div className="p-2">
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Digite para filtrar…"
              className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm outline-none focus:border-emerald-500"
            />
          </div>
          <ul className="max-h-52 overflow-y-auto pb-1">
            {filtered.length === 0 && !canCreate && <li className="px-3 py-2 text-sm text-slate-400">Nada encontrado</li>}
            {filtered.map((o) => (
              <li key={o.value}>
                <button
                  type="button"
                  onClick={() => { onChange(o.value); setOpen(false); }}
                  className={`flex w-full min-h-[var(--control-h)] items-center justify-between px-3 py-2 text-left text-sm transition-colors hover:bg-emerald-50 ${o.value === value ? 'bg-emerald-50 font-medium text-emerald-700' : 'text-slate-700'}`}
                >
                  <span>{o.label}</span>
                  {o.hint && <span className="ml-2 text-xs text-slate-400">{o.hint}</span>}
                </button>
              </li>
            ))}
            {canCreate && (
              <li className="border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => { onCreate!(search.trim()); setSearch(''); setOpen(false); }}
                  className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-sm font-medium text-emerald-700 hover:bg-emerald-50"
                >
                  <Plus size={15} /> Criar “{search.trim()}”
                </button>
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

export interface MenuAction {
  label: string;
  icon?: ReactNode;
  onClick?: () => void;
  href?: string;
  danger?: boolean;
}

/** Menu de ações (kebab) — agrupa ações de uma linha para caber em telas pequenas. */
export function ActionMenu({ actions }: { actions: MenuAction[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  if (actions.length === 0) return null;

  return (
    <div className="relative inline-block text-left" ref={ref}>
      <button
        type="button"
        aria-label="Ações"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center justify-center rounded-xl p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 pointer-coarse:min-h-11 pointer-coarse:min-w-11"
      >
        <MoreVertical size={18} />
      </button>
      {open && (
        <div role="menu" className="ui-animate-pop absolute right-0 z-30 mt-1.5 min-w-[12rem] overflow-hidden rounded-xl border border-slate-200/80 bg-white py-1.5 shadow-[var(--shadow-lg)]">
          {actions.map((a, i) => {
            // min-h pelo token: item de menu é alvo de toque como qualquer outro.
            const cls = `flex w-full min-h-[var(--control-h)] items-center gap-2.5 px-3.5 py-2.5 text-left text-sm transition-colors ${
              a.danger ? 'text-red-600 hover:bg-red-50' : 'text-slate-700 hover:bg-slate-50'
            }`;
            const inner = <>{a.icon}<span>{a.label}</span></>;
            return a.href ? (
              <a key={i} href={a.href} target="_blank" rel="noreferrer" className={cls} onClick={() => setOpen(false)}>
                {inner}
              </a>
            ) : (
              <button key={i} type="button" className={cls} onClick={() => { setOpen(false); a.onClick?.(); }}>
                {inner}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      {children}
    </label>
  );
}

export function Card({ className = '', children, onClick }: { className?: string; children: ReactNode; onClick?: () => void }) {
  return (
    // Raio maior + sombra em camadas: o cartão "descola" do fundo sem borda pesada.
    <div className={`rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[var(--shadow-sm)] ${className}`} onClick={onClick}>
      {children}
    </div>
  );
}

const badgeColors: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-700',
  active: 'bg-blue-100 text-blue-700',
  closed: 'bg-slate-200 text-slate-600',
  pending_approval: 'bg-amber-100 text-amber-700',
  approved: 'bg-emerald-100 text-emerald-700',
  sent: 'bg-indigo-100 text-indigo-700',
  received: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-700',
  submitted: 'bg-amber-100 text-amber-700',
  allocated: 'bg-blue-100 text-blue-700',
  ordered: 'bg-green-100 text-green-700',
};

const badgeLabels: Record<string, string> = {
  draft: 'Rascunho',
  active: 'Ativa',
  closed: 'Fechada',
  pending_approval: 'Aguardando aprovação',
  approved: 'Aprovado',
  sent: 'Enviado',
  received: 'Recebido',
  cancelled: 'Cancelado',
  submitted: 'Enviada p/ aprovação',
  allocated: 'Alocada',
  ordered: 'Pedidos gerados',
};

export function Badge({ status }: { status: string }) {
  return (
    // ring interno em vez de fundo chapado: o selo fica nítido em qualquer superfície.
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ring-current/15 ${badgeColors[status] ?? 'bg-slate-100 text-slate-700'}`}>
      {badgeLabels[status] ?? status}
    </span>
  );
}

export function Modal({
  title, onClose, children, size = 'lg',
}: { title: string; onClose: () => void; children: ReactNode; size?: 'lg' | 'xl' | 'full' | 'wide' }) {
  // `wide`: telas de lançamento (muitos itens em linha) — acompanha a janela em vez de
  // ficar presa num tamanho fixo, com teto para não esticar demais em monitor grande.
  const maxW = size === 'wide' ? 'max-w-[min(80rem,95vw)]'
    : size === 'full' ? 'max-w-5xl'
    : size === 'xl' ? 'max-w-2xl'
    : 'max-w-lg';
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  // onClose quase sempre chega como arrow inline (`onClose={() => setX(null)}`), cuja
  // identidade muda a cada render. Guardar num ref mantém o efeito com deps [] — sem
  // re-registrar listener nem re-disputar o foco a cada render do pai.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Esc fecha (era preciso mirar o X ou o fundo) + trava o scroll da página atrás,
  // que rolava junto e fazia perder a posição da lista ao fechar o modal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCloseRef.current(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Leva o foco ao modal — mas só se nada dentro dele já tiver o foco, para não
    // roubar de um campo com autoFocus (formulários dependem disso).
    if (panelRef.current && !panelRef.current.contains(document.activeElement)) {
      panelRef.current.focus();
    }
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, []);

  return (
    // Fundo mais escuro + desfoque: separa o modal do conteúdo atrás e tira o ruído
    // visual de uma tela densa, dando foco ao que está sendo editado.
    <div
      className="ui-animate-fade fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`ui-animate-pop max-h-[90vh] w-full ${maxW} overflow-y-auto rounded-2xl bg-white p-6 shadow-[var(--shadow-lg)] outline-none`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Título fixo no topo ao rolar formulário longo (ficha técnica, tributação):
            o contexto do que se está editando não some da tela. */}
        <div className="sticky -top-6 z-10 -mx-6 -mt-6 mb-5 border-b border-slate-100 bg-white/95 px-6 pb-3 pt-6 backdrop-blur">
          <h2 id={titleId} className="text-lg font-semibold tracking-tight text-slate-900">{title}</h2>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Botão de ação em ícone (linhas de listas: ver / editar / excluir). */
export function IconBtn({
  title, onClick, hover = 'slate', children,
}: { title: string; onClick: () => void; hover?: 'slate' | 'emerald' | 'red'; children: ReactNode }) {
  const h = hover === 'emerald' ? 'hover:text-emerald-600' : hover === 'red' ? 'hover:text-red-600' : 'hover:text-slate-700';
  return (
    // `pointer-coarse`: em tela de toque o alvo vai a 44×44 (o dedo erra um alvo de 32px);
    // no desktop com mouse a densidade das tabelas é preservada. text-slate-500 em vez de
    // 400 para o ícone ter contraste suficiente em repouso.
    <button type="button" title={title} aria-label={title} onClick={onClick}
      className={`inline-flex items-center justify-center rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 pointer-coarse:min-h-11 pointer-coarse:min-w-11 ${h}`}>
      {children}
    </button>
  );
}

/**
 * Popup só-leitura com os detalhes completos de um registro (padrão mobile:
 * a listagem mostra poucos campos + botão 👁 que abre este modal). Botão "Editar"
 * opcional para pular direto à edição.
 */
export function ViewModal({
  title, fields, onClose, onEdit,
}: {
  title: string;
  fields: { label: string; value: ReactNode }[];
  onClose: () => void;
  onEdit?: () => void;
}) {
  return (
    <Modal title={title} onClose={onClose}>
      <dl className="divide-y divide-slate-100">
        {fields.map((f, i) => (
          <div key={i} className="flex items-start justify-between gap-4 py-2 text-sm">
            <dt className="shrink-0 text-slate-500">{f.label}</dt>
            <dd className="text-right font-medium text-slate-800">{f.value === null || f.value === undefined || f.value === '' ? <span className="text-slate-300">—</span> : f.value}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>Fechar</Button>
        {onEdit && <Button onClick={onEdit}>Editar</Button>}
      </div>
    </Modal>
  );
}

export function Spinner() {
  return (
    <div className="flex justify-center p-8" role="status" aria-label="Carregando">
      <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-slate-200 border-t-emerald-600" />
    </div>
  );
}

export function ErrorBox({ message }: { message: string }) {
  return (
    // role=alert: o leitor de tela anuncia o erro assim que ele aparece, sem o
    // usuário precisar procurá-lo na tela.
    <div role="alert" className="flex items-start gap-2.5 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
      <AlertCircle size={16} className="mt-0.5 shrink-0" />
      <span className="min-w-0">{message}</span>
    </div>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 px-6 py-12 text-center">
      <p className="mx-auto max-w-sm text-sm text-slate-500">{message}</p>
    </div>
  );
}
