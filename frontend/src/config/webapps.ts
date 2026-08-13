/**
 * Apps abertos no dock (barra superior → janela flutuante).
 *
 * `web` = portal de terceiro embutido em <iframe>. Os portais do iFood e do 99
 * não mandam `X-Frame-Options` nem `frame-ancestors`, então podem ser embutidos.
 * A sessão de cada um é isolada: o Chrome particiona cookie/storage de terceiro
 * pelo site de topo. Você loga UMA vez dentro do app e aquilo persiste,
 * independente da sua aba normal do navegador. Trocar a origem do ERP
 * (127.0.0.1:8090 ↔ domínio do tunnel) troca a partição, logo pede login de novo.
 *
 * `native` = tela nossa. O WhatsApp é native por obrigação: `web.whatsapp.com`
 * responde `frame-ancestors https://*.whatsapp.com` e recusa ser embutido. A
 * conversa vem da Evolution API, espelhada pelo backend (App\Services\WaInbox).
 */
export type AppId = 'whatsapp' | 'ifood' | '99food';

export interface DockApp {
  id: AppId;
  label: string;
  /** Permissão do ERP exigida para ver o botão (Core\Permissions no backend). */
  perm: string;
  /** Cor da marca, só para o ícone do botão não virar um borrão cinza. */
  tint: string;
  kind: 'native' | 'web';
  /** Só em `web`. */
  url?: string;
}

const env = import.meta.env;

export const DOCK_APPS: DockApp[] = [
  {
    id: 'whatsapp',
    label: 'WhatsApp',
    perm: 'whatsapp:chat',
    tint: '#25D366',
    kind: 'native',
  },
  {
    id: 'ifood',
    label: 'iFood',
    perm: 'delivery:operate',
    tint: '#EA1D2C',
    kind: 'web',
    url: env.VITE_IFOOD_URL || 'https://gestordepedidos.ifood.com.br/',
  },
  {
    id: '99food',
    label: '99Food',
    perm: 'delivery:operate',
    tint: '#F5A623',
    kind: 'web',
    url: env.VITE_99FOOD_URL || 'https://merchant.99app.com/pt-BR/store',
  },
];
