import { UtensilsCrossed } from 'lucide-react';

// Marca do sistema — altere aqui para mudar nome/logo em todo o app.
export const APP_NAME = 'Restaurante Seu Sérgio';
export const APP_TAGLINE = 'Gestão de pedidos a fornecedores';

/**
 * Logo do sistema.
 * Hoje usa um ícone (UtensilsCrossed). Para usar uma imagem própria,
 * coloque o arquivo em `frontend/public/logo.svg` (ou .png) e troque o
 * conteúdo abaixo por: <img src="/logo.svg" width={size} height={size} className={className} alt={APP_NAME} />
 */
export function Logo({ size = 26, className = 'text-emerald-600' }: { size?: number; className?: string }) {
  return <UtensilsCrossed size={size} className={className} />;
}
