import { UtensilsCrossed } from 'lucide-react';
import { useBrand } from '../store/brand.store';

// Padrões da marca — usados enquanto a personalização (Admin → Personalização)
// não define nome/logo/cor próprios.
export const DEFAULT_APP_NAME = 'Restaurante Seu Sérgio';
export const DEFAULT_TAGLINE = 'Gestão de pedidos a fornecedores';

// Compat: constantes seguem exportadas como padrão estático.
export const APP_NAME = DEFAULT_APP_NAME;
export const APP_TAGLINE = DEFAULT_TAGLINE;

/** Nome do sistema (personalizável em Admin → Personalização). */
export function AppName() {
  const name = useBrand((s) => s.brand_name);
  return <>{name || DEFAULT_APP_NAME}</>;
}

export function AppTagline() {
  const tagline = useBrand((s) => s.tagline);
  return <>{tagline || DEFAULT_TAGLINE}</>;
}

/** Logo do sistema: imagem personalizada ou o ícone padrão. */
export function Logo({ size = 26, className = 'text-emerald-600' }: { size?: number; className?: string }) {
  const logo = useBrand((s) => s.logo);
  if (logo) {
    return <img src={logo} width={size} height={size} className="rounded object-contain" alt="Logo" />;
  }
  return <UtensilsCrossed size={size} className={className} />;
}
