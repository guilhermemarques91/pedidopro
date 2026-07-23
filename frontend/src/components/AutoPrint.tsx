import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { deliveryApi } from '../services/resources';
import { isPrintConfigured, printReceipt } from '../services/print';
import type { DeliveryStatus } from '../types';

/** Status em que a comanda deve ser impressa automaticamente ao aparecer. */
const AUTOPRINT_STATUS: DeliveryStatus[] = ['placed', 'confirmed', 'preparing'];

/**
 * Impressão automática GLOBAL da comanda: montada no Layout, roda em qualquer página
 * enquanto o app estiver aberto — não depende do painel de Delivery estar na tela.
 * Só atua quando o QZ Tray está configurado neste PC (senão fica inerte, sem poll).
 * O endpoint /printed é uma reivindicação atômica que deduplica entre abas/telas.
 */
export function AutoPrint() {
  const configured = isPrintConfigured();
  const { data } = useQuery({
    queryKey: ['delivery-orders'],
    queryFn: () => deliveryApi.list(),
    refetchInterval: 15_000,
    // Continua imprimindo mesmo com a aba em 2º plano (operador em outra janela/app).
    refetchIntervalInBackground: true,
    enabled: configured,
  });
  const attempts = useRef<Set<number>>(new Set());

  useEffect(() => {
    if (!data || !configured) return;
    const pending = data.filter(
      (o) => !o.printed_at && AUTOPRINT_STATUS.includes(o.status) && !attempts.current.has(o.id),
    );
    for (const o of pending) {
      attempts.current.add(o.id);
      (async () => {
        // RESERVA o pedido ANTES de imprimir: o claim é atômico no servidor, então se
        // outro cliente (outra aba/PC) estiver rodando o daemon, só um ganha e imprime —
        // sem isso os dois imprimem e sai comanda duplicada. claimed=false → outro já pegou.
        let claimed = false;
        try {
          claimed = (await deliveryApi.printed(o.id)).claimed;
          if (!claimed) return; // outro cliente já reservou/imprimiu este pedido
          const full = await deliveryApi.get(o.id);
          await printReceipt(full);
        } catch (e) {
          attempts.current.delete(o.id); // libera p/ nova tentativa no próximo poll (ex.: QZ offline)
          // Se já tínhamos reservado, desfaz — senão o pedido fica "impresso" sem ter saído papel.
          if (claimed) await deliveryApi.printReset(o.id).catch(() => {});
          console.error('Impressão automática falhou para o pedido', o.id, e);
        }
      })();
    }
  }, [data, configured]);

  return null;
}
