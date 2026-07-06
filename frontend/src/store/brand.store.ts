import { create } from 'zustand';
import { api } from '../services/api';

export interface Branding {
  brand_name: string | null;
  tagline: string | null;
  logo: string | null;          // data URL
  primary_color: string | null; // #RRGGBB
}

interface BrandState extends Branding {
  loaded: boolean;
  load: () => Promise<void>;
  apply: (b: Partial<Branding>) => void;
}

/** Aplica a cor primária via CSS vars (index.css mapeia as classes emerald p/ elas). */
function applyColor(color: string | null) {
  const root = document.documentElement;
  if (color) {
    root.style.setProperty('--brand', color);
    root.style.setProperty('--brand-dark', `color-mix(in srgb, ${color} 80%, black)`);
    root.style.setProperty('--brand-soft', `color-mix(in srgb, ${color} 10%, white)`);
  } else {
    root.style.removeProperty('--brand');
    root.style.removeProperty('--brand-dark');
    root.style.removeProperty('--brand-soft');
  }
}

export const useBrand = create<BrandState>((set) => ({
  brand_name: null,
  tagline: null,
  logo: null,
  primary_color: null,
  loaded: false,

  async load() {
    try {
      const { data } = await api.get<Branding>('/branding');
      applyColor(data.primary_color);
      if (data.brand_name) document.title = data.brand_name;
      set({ ...data, loaded: true });
    } catch {
      set({ loaded: true }); // offline/erro: usa os padrões do brand.tsx
    }
  },

  apply(b) {
    if ('primary_color' in b) applyColor(b.primary_color ?? null);
    if (b.brand_name) document.title = b.brand_name;
    set(b);
  },
}));
