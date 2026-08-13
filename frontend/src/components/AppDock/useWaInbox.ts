import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { waInboxApi } from '../../services/resources';
import { useAuth } from '../../store/auth.store';
import { useDock } from '../../store/dock.store';

/**
 * Pulso da caixa de entrada. Roda MESMO com a janela fechada — é o que alimenta
 * o contador da barra superior e o aviso de mensagem nova. Por isso mora num
 * hook chamado pelo `DockLauncher` (sempre montado), e não dentro do painel.
 *
 * 5s com `refetchIntervalInBackground` é o mesmo arranjo do AutoPrint: a aba do
 * ERP costuma ficar em segundo plano no PC do caixa, e sem isso o navegador
 * congelaria o intervalo justo quando ninguém está olhando.
 *
 * O endpoint devolve só o delta (`{lastId, unreadTotal, changed}`), então este
 * laço é barato; quem busca conversa e mensagem são as queries que ele invalida.
 */
export function useWaInbox() {
  const permissions = useAuth((s) => s.permissions);
  const enabled = permissions.includes('whatsapp:chat');
  const qc = useQueryClient();
  const openApp = useDock((s) => s.open);

  // O cursor não entra na queryKey de propósito: é o MESMO laço avançando, não
  // uma consulta nova a cada tique — trocar a chave criaria um cache por tique.
  const cursor = useRef(0);
  const openAppRef = useRef(openApp);
  openAppRef.current = openApp;

  const { data } = useQuery({
    queryKey: ['wa-updates'],
    queryFn: () => waInboxApi.updates(cursor.current),
    enabled,
    refetchInterval: 5_000,
    refetchIntervalInBackground: true,
  });

  useEffect(() => {
    if (!data || data.lastId === cursor.current) return;
    const first = cursor.current === 0;
    cursor.current = data.lastId;

    qc.invalidateQueries({ queryKey: ['wa-chats'] });
    qc.invalidateQueries({ queryKey: ['wa-messages'] });

    // Na primeira resposta o `changed` vem vazio (cursor 0 = "só me diga onde
    // estamos"), mas a guarda fica explícita: recarregar a página não pode
    // disparar uma saraivada de avisos de mensagens já vistas.
    if (first) return;
    const novas = data.changed.filter((c) => c.novas > 0);
    if (novas.length === 0) return;
    // Com o WhatsApp já aberto na frente, a mensagem aparece sozinha na tela —
    // avisar de novo seria barulho.
    if (openAppRef.current === 'whatsapp') return;
    notify(novas.map((c) => c.name || c.remote_jid.split('@')[0]));
  }, [data, qc]);

  return {
    unreadTotal: data?.unreadTotal ?? 0,
    enabled,
  };
}

/** Aviso de mensagem nova: som curto + notificação do sistema (se autorizada). */
function notify(nomes: string[]) {
  beep();
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const titulo = nomes.length === 1 ? `WhatsApp — ${nomes[0]}` : `WhatsApp — ${nomes.length} conversas`;
  try {
    new Notification(titulo, { body: nomes.slice(0, 4).join(', '), tag: 'wa-inbox' });
  } catch {
    /* alguns navegadores exigem service worker; o som já avisou */
  }
}

/**
 * Bipe sintetizado em vez de um arquivo de áudio: evita carregar um binário no
 * bundle para dois tons de 90ms.
 *
 * O navegador só deixa tocar depois de alguma interação do usuário na página —
 * até lá o AudioContext nasce suspenso e isto vira um no-op silencioso, sem
 * erro. Na prática, quem está operando o ERP já clicou em algo.
 */
function beep() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    if (ctx.state === 'suspended') void ctx.resume();
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.connect(ctx.destination);
    [880, 1180].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.connect(gain);
      const t0 = ctx.currentTime + i * 0.11;
      // Rampa em vez de liga/desliga: corte seco vira um "clique" audível.
      gain.gain.exponentialRampToValueAtTime(0.16, t0 + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.09);
      osc.start(t0);
      osc.stop(t0 + 0.1);
    });
    setTimeout(() => void ctx.close(), 500);
  } catch {
    /* sem áudio disponível: o contador na barra já mostra que chegou algo */
  }
}

/** Pede a permissão de notificação no primeiro uso — nunca no carregamento. */
export function askNotificationPermission() {
  if (typeof Notification === 'undefined' || Notification.permission !== 'default') return;
  void Notification.requestPermission();
}
