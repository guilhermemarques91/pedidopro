import { useState } from 'react';
import { DockWindow } from './DockWindow';
import type { DockApp } from '../../config/webapps';

/**
 * Portal de terceiro embutido. Uma vez montado nunca é desmontado (ver
 * dock.store): fechar a janela apenas esconde, para o portal continuar
 * recebendo pedido e tocando o alerta sonoro em segundo plano.
 *
 * Sem atributo `sandbox` de propósito — sandbox isola o storage e o login do
 * portal simplesmente não persistiria. `allow` libera o som do alerta e o
 * copiar/colar (código de rastreio, endereço).
 */
export function WebAppPanel({ app, visible }: { app: DockApp; visible: boolean }) {
  // Recarregar um iframe de outra origem por JS é bloqueado (cross-origin), então
  // o botão remonta o elemento trocando a `key`. A sessão sobrevive: ela mora no
  // storage particionado, não na memória da página.
  const [nonce, setNonce] = useState(0);
  const [loaded, setLoaded] = useState(false);

  return (
    <DockWindow
      id={app.id}
      title={app.label}
      tint={app.tint}
      visible={visible}
      externalUrl={app.url}
      onReload={() => {
        setLoaded(false);
        setNonce((n) => n + 1);
      }}
    >
      <iframe
        key={nonce}
        src={app.url}
        title={app.label}
        onLoad={() => setLoaded(true)}
        allow="autoplay; clipboard-read; clipboard-write; fullscreen; geolocation"
        referrerPolicy="no-referrer-when-downgrade"
        className="h-full w-full border-0 bg-white"
      />

      {!loaded && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 bg-white text-sm text-slate-500">
          <span>Carregando {app.label}…</span>
          <span className="max-w-xs text-center text-xs text-slate-400">
            Na primeira vez é preciso fazer login aqui dentro. Essa sessão fica salva e é
            separada da sua aba normal do navegador.
          </span>
        </div>
      )}
    </DockWindow>
  );
}
