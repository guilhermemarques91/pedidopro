import { useEffect } from 'react';

/**
 * Recarrega a aba quando uma versão nova do frontend é publicada.
 *
 * O PROBLEMA que isto resolve: uma aba aberta NÃO se atualiza sozinha após um deploy.
 * O operador deixa o ERP aberto no caixa por dias; ao publicar uma versão nova, essa
 * aba continua rodando o bundle antigo (em cache). Se o bundle antigo for anterior à
 * dedup de impressão atual, ele imprime a comanda POR CONTA PRÓPRIA — junto com a aba
 * nova — e sai comanda DUPLICADA (uma via com o layout novo, outra com o antigo).
 *
 * Como funciona: o build grava um id em /version.json e embute o MESMO id no bundle
 * (__BUILD_ID__, via vite define). Aqui a gente busca /version.json sem cache de tempos
 * em tempos; se o id do servidor divergir do id embutido, esta aba está velha → reload.
 * O reload puxa o index.html novo (Cache-Control: no-cache) e o bundle novo.
 *
 * Só roda em produção (o build de dev não emite version.json).
 */
export function VersionWatcher() {
  useEffect(() => {
    if (!import.meta.env.PROD) return;
    let stopped = false;

    const check = async () => {
      try {
        const res = await fetch(`/version.json?_=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = (await res.json()) as { build?: string };
        if (!stopped && data.build && data.build !== __BUILD_ID__) {
          window.location.reload();
        }
      } catch {
        /* offline ou sem version.json (build antigo): ignora e tenta de novo depois */
      }
    };

    const id = window.setInterval(check, 60_000);
    check();
    return () => { stopped = true; window.clearInterval(id); };
  }, []);

  return null;
}
