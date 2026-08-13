import { create } from 'zustand';
import type { AppId } from '../config/webapps';

export interface Geometry {
  x: number;
  y: number;
  w: number;
  h: number;
  maximized: boolean;
}

interface DockState {
  /** App visível agora. `null` = nenhuma janela aberta. */
  open: AppId | null;
  /**
   * Apps já montados. Um app entra aqui na primeira vez que é aberto e NUNCA
   * sai: fechar a janela só esconde. Desmontar recarregaria o iframe, derrubaria
   * a sessão em memória do portal e mataria o alerta sonoro de pedido novo.
   */
  mounted: AppId[];
  geometry: Record<string, Geometry>;
  toggle: (id: AppId) => void;
  focus: (id: AppId) => void;
  close: () => void;
  setGeometry: (id: AppId, g: Geometry) => void;
}

// Mesma persistência manual à mão do auth.store/Layout: localStorage + try/catch.
const KEY = 'dock:state';

interface Persisted {
  mounted?: AppId[];
  geometry?: Record<string, Geometry>;
}

function load(): Persisted {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Persisted) : {};
  } catch {
    return {};
  }
}

function save(s: Persisted) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignora quota/privacidade */
  }
}

/** Tamanho inicial: grande, mas sempre dentro da janela e centralizado. */
export function defaultGeometry(): Geometry {
  const w = Math.min(1180, Math.max(360, window.innerWidth - 96));
  const h = Math.min(780, Math.max(320, window.innerHeight - 128));
  return {
    w,
    h,
    x: Math.max(8, Math.round((window.innerWidth - w) / 2)),
    y: Math.max(8, Math.round((window.innerHeight - h) / 2)),
    maximized: false,
  };
}

const initial = load();

export const useDock = create<DockState>((set, get) => ({
  // Não reabrimos a janela sozinhos ao carregar a página: o app que estava
  // montado volta a montar (em segundo plano, recebendo pedido/tocando som),
  // mas quem decide o que fica na frente é o usuário.
  open: null,
  mounted: initial.mounted ?? [],
  geometry: initial.geometry ?? {},

  toggle(id) {
    const { open, mounted } = get();
    if (open === id) {
      set({ open: null });
      return;
    }
    const next = mounted.includes(id) ? mounted : [...mounted, id];
    set({ open: id, mounted: next });
    save({ mounted: next, geometry: get().geometry });
  },

  focus(id) {
    set({ open: id });
  },

  close() {
    set({ open: null });
  },

  setGeometry(id, g) {
    const geometry = { ...get().geometry, [id]: g };
    set({ geometry });
    save({ mounted: get().mounted, geometry });
  },
}));
