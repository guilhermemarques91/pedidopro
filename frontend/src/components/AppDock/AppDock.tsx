import { useDock } from '../../store/dock.store';
import { useAuth } from '../../store/auth.store';
import { DOCK_APPS } from '../../config/webapps';
import { WebAppPanel } from './WebAppPanel';
import { WhatsappPanel } from './WhatsappPanel';

/**
 * Camada das janelas flutuantes. Montada uma única vez no Layout, ao lado do
 * AutoPrint — precisa sobreviver à troca de rota, senão o iframe recarregaria
 * (e o login do portal se perderia) toda vez que você navegasse no ERP.
 */
export function AppDock() {
  const open = useDock((s) => s.open);
  const mounted = useDock((s) => s.mounted);
  const permissions = useAuth((s) => s.permissions);

  return (
    <>
      {DOCK_APPS.filter((a) => mounted.includes(a.id) && permissions.includes(a.perm)).map((app) =>
        app.kind === 'native'
          ? <WhatsappPanel key={app.id} app={app} visible={open === app.id} />
          : <WebAppPanel key={app.id} app={app} visible={open === app.id} />,
      )}
    </>
  );
}
