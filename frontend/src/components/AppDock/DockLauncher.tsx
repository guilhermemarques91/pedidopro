import { useDock } from '../../store/dock.store';
import { useAuth } from '../../store/auth.store';
import { DOCK_APPS } from '../../config/webapps';
import { askNotificationPermission, useWaInbox } from './useWaInbox';

/**
 * Botões da barra superior. Cada um abre/fecha a janela flutuante do seu app.
 * O ponto colorido é a identidade da plataforma — num alvo pequeno ele é
 * reconhecido bem antes do texto.
 *
 * Este componente também hospeda o pulso da caixa de entrada (`useWaInbox`):
 * ele está sempre montado, então o contador continua correndo com todas as
 * janelas fechadas — que é justamente quando não se pode perder mensagem.
 */
export function DockLauncher() {
  const open = useDock((s) => s.open);
  const toggle = useDock((s) => s.toggle);
  const permissions = useAuth((s) => s.permissions);
  const { unreadTotal } = useWaInbox();

  const apps = DOCK_APPS.filter((a) => permissions.includes(a.perm));
  if (apps.length === 0) return null;

  return (
    <div className="flex items-center gap-1">
      {apps.map((app) => {
        const active = open === app.id;
        const badge = app.id === 'whatsapp' ? unreadTotal : 0;
        return (
          <button
            key={app.id}
            type="button"
            onClick={() => {
              // A permissão de notificação é pedida no primeiro clique, não no
              // carregamento: pop-up logo ao abrir o sistema todo mundo nega.
              if (app.id === 'whatsapp') askNotificationPermission();
              toggle(app.id);
            }}
            aria-pressed={active}
            aria-label={badge > 0 ? `${app.label} — ${badge} não lidas` : app.label}
            title={`${app.label} — abrir dentro do sistema`}
            className={`relative inline-flex min-h-8 items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 pointer-coarse:min-h-11 ${
              active
                ? 'border-slate-300 bg-slate-100 text-slate-900'
                : 'border-transparent text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: app.tint }} />
            <span className="hidden sm:inline">{app.label}</span>
            {badge > 0 && (
              <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-emerald-600 px-1 text-xs font-bold text-white">
                {badge > 99 ? '99+' : badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
