import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ExternalLink, Maximize2, Minimize2, RotateCw, X } from 'lucide-react';
import { useDock, defaultGeometry, type Geometry } from '../../store/dock.store';
import type { AppId } from '../../config/webapps';

interface Props {
  id: AppId;
  title: string;
  tint: string;
  /** Escondida ≠ desmontada: o conteúdo continua vivo em segundo plano. */
  visible: boolean;
  /** Link externo do botão "abrir em janela" (plano B se o portal quebrar embutido). */
  externalUrl?: string;
  onReload?: () => void;
  children: ReactNode;
}

type Drag =
  | { mode: 'move' | 'resize'; sx: number; sy: number; ox: number; oy: number; ow: number; oh: number }
  | null;

const MIN_W = 380;
const MIN_H = 300;
/** Quanto da janela precisa continuar alcançável ao arrastar para fora da tela. */
const KEEP_VISIBLE = 140;

function clamp(g: Geometry): Geometry {
  const w = Math.min(Math.max(g.w, MIN_W), Math.max(MIN_W, window.innerWidth - 16));
  const h = Math.min(Math.max(g.h, MIN_H), Math.max(MIN_H, window.innerHeight - 16));
  return {
    ...g,
    w,
    h,
    x: Math.min(Math.max(g.x, KEEP_VISIBLE - w), window.innerWidth - KEEP_VISIBLE),
    y: Math.min(Math.max(g.y, 0), Math.max(0, window.innerHeight - 44)),
  };
}

export function DockWindow({ id, title, tint, visible, externalUrl, onReload, children }: Props) {
  const close = useDock((s) => s.close);
  const setGeometry = useDock((s) => s.setGeometry);
  const saved = useDock((s) => s.geometry[id]);

  const [geo, setGeo] = useState<Geometry>(() => clamp(saved ?? defaultGeometry()));
  const [drag, setDrag] = useState<Drag>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Redimensionar o navegador (ou trocar de monitor) pode deixar a janela fora da
  // área visível — sem isso ela fica inalcançável e parece que "sumiu".
  useEffect(() => {
    const onResize = () => setGeo((g) => clamp(g));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const start = useCallback(
    (mode: 'move' | 'resize') => (e: React.PointerEvent) => {
      if (geo.maximized && mode === 'move') return;
      e.preventDefault();
      setDrag({ mode, sx: e.clientX, sy: e.clientY, ox: geo.x, oy: geo.y, ow: geo.w, oh: geo.h });
    },
    [geo],
  );

  // O movimento é ouvido na janela inteira (não no cabeçalho): o ponteiro passa
  // por cima do iframe durante o arrasto e o iframe engoliria o evento. Por isso
  // também existe o `<div>` que cobre a tela enquanto `drag` está ativo.
  useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent) => {
      const dx = e.clientX - drag.sx;
      const dy = e.clientY - drag.sy;
      setGeo((g) =>
        clamp(
          drag.mode === 'move'
            ? { ...g, x: drag.ox + dx, y: drag.oy + dy }
            : { ...g, w: drag.ow + dx, h: drag.oh + dy },
        ),
      );
    };
    const onUp = () => setDrag(null);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [drag]);

  // Só grava quando o arrasto termina — gravar a cada pixel encheria o
  // localStorage de escritas síncronas no meio da animação.
  useEffect(() => {
    if (drag) return;
    setGeometry(id, geo);
    // `geo` muda a cada frame durante o arrasto; a dependência em `drag` é o
    // que segura a gravação até o fim do gesto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag, geo.maximized]);

  function toggleMax() {
    setGeo((g) => ({ ...g, maximized: !g.maximized }));
  }

  // Maximizada: os quatro cantos presos (a janela é `fixed`). Nada de
  // `calc(100vw - 16px)` — `100vw` conta a barra de rolagem e a janela passaria
  // da borda direita, criando rolagem horizontal na página inteira.
  const style: React.CSSProperties = geo.maximized
    ? { left: 8, top: 8, right: 8, bottom: 8 }
    : { left: geo.x, top: geo.y, width: geo.w, height: geo.h };

  return (
    <>
      {/* Capa transparente durante o arrasto: garante que o ponteiro continue
          sendo nosso mesmo passando por cima de um iframe de outro domínio. */}
      {drag && <div className="fixed inset-0 z-[70]" style={{ cursor: drag.mode === 'move' ? 'grabbing' : 'nwse-resize' }} />}

      <div
        ref={panelRef}
        role="dialog"
        aria-label={title}
        // `hidden` some com a janela sem desmontar o conteúdo (ver dock.store).
        className={`ui-animate-pop fixed z-[60] flex flex-col overflow-hidden rounded-2xl border border-slate-300 bg-white shadow-[var(--shadow-lg)] ${
          visible ? '' : 'hidden'
        }`}
        style={style}
        onKeyDown={(e) => {
          // Esc só fecha com o foco DENTRO da janela — senão brigaria com o Esc
          // do Modal de ui.tsx, que é global.
          if (e.key === 'Escape') {
            e.stopPropagation();
            close();
          }
        }}
      >
        <header
          onPointerDown={start('move')}
          onDoubleClick={toggleMax}
          className={`flex shrink-0 select-none items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 ${
            geo.maximized ? '' : 'cursor-grab active:cursor-grabbing'
          }`}
        >
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: tint }} />
          <span className="truncate text-sm font-semibold text-slate-700">{title}</span>

          <div className="ml-auto flex items-center gap-0.5">
            {onReload && (
              <HeaderBtn title="Recarregar" onClick={onReload}>
                <RotateCw size={15} />
              </HeaderBtn>
            )}
            {externalUrl && (
              <HeaderBtn
                title="Abrir em outra janela"
                onClick={() => window.open(externalUrl, `dock-${id}`, 'width=1280,height=860,noopener')}
              >
                <ExternalLink size={15} />
              </HeaderBtn>
            )}
            <HeaderBtn title={geo.maximized ? 'Restaurar' : 'Maximizar'} onClick={toggleMax}>
              {geo.maximized ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            </HeaderBtn>
            <HeaderBtn title="Fechar" onClick={close} danger>
              <X size={16} />
            </HeaderBtn>
          </div>
        </header>

        {/* `pointer-events-none` no conteúdo enquanto arrasta: sem isso o iframe
            reagiria ao ponteiro no meio do gesto (seleciona texto, abre link). */}
        <div className={`relative min-h-0 flex-1 ${drag ? 'pointer-events-none' : ''}`}>{children}</div>

        {!geo.maximized && (
          <div
            onPointerDown={start('resize')}
            aria-hidden
            className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize"
            style={{
              background:
                'linear-gradient(135deg, transparent 50%, rgb(148 163 184) 50%, rgb(148 163 184) 60%, transparent 60%, transparent 72%, rgb(148 163 184) 72%, rgb(148 163 184) 82%, transparent 82%)',
            }}
          />
        )}
      </div>
    </>
  );
}

function HeaderBtn({
  title, onClick, danger, children,
}: { title: string; onClick: () => void; danger?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      // O cabeçalho é a área de arrasto: sem parar a propagação, clicar num
      // botão também iniciaria um movimento de 1px na janela.
      onPointerDown={(e) => e.stopPropagation()}
      onClick={onClick}
      className={`inline-flex h-7 w-7 items-center justify-center rounded-lg text-slate-500 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 ${
        danger ? 'hover:bg-red-50 hover:text-red-600' : 'hover:bg-slate-200 hover:text-slate-800'
      }`}
    >
      {children}
    </button>
  );
}
