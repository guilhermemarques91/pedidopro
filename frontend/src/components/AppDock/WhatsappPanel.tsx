import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, Send, Users } from 'lucide-react';
import { waInboxApi } from '../../services/resources';
import { apiError } from '../../services/api';
import type { DockApp } from '../../config/webapps';
import type { WaChat, WaMessage } from '../../types';
import { DockWindow } from './DockWindow';
import { ErrorBox, Spinner } from '../ui';

const MEDIA_LABEL: Record<string, string> = {
  image: '📷 Foto',
  video: '🎥 Vídeo',
  audio: '🎤 Áudio',
  document: '📄 Documento',
  sticker: '🌟 Figurinha',
  location: '📍 Localização',
  contact: '👤 Contato',
  other: 'Mensagem',
};

export function WhatsappPanel({ app, visible }: { app: DockApp; visible: boolean }) {
  const qc = useQueryClient();
  const [busca, setBusca] = useState('');
  const [chatId, setChatId] = useState<number | null>(null);
  const [rascunho, setRascunho] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  const { data: chats = [], isLoading } = useQuery({
    queryKey: ['wa-chats'],
    queryFn: waInboxApi.chats,
  });

  // O histórico só é puxado da Evolution uma vez por conversa (é chamada de rede
  // lá fora). Depois disso o webhook mantém a conversa em dia sozinho.
  const jaPuxado = useRef<Set<number>>(new Set());

  const { data: mensagens = [], isLoading: carregandoMsgs } = useQuery({
    queryKey: ['wa-messages', chatId],
    queryFn: () => waInboxApi.messages(chatId as number),
    enabled: chatId !== null,
  });

  const abrir = useMutation({
    mutationFn: async (id: number) => {
      if (!jaPuxado.current.has(id)) {
        jaPuxado.current.add(id);
        await waInboxApi.backfill(id);
      }
      await waInboxApi.read(id);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['wa-chats'] });
      qc.invalidateQueries({ queryKey: ['wa-messages', chatId] });
      qc.invalidateQueries({ queryKey: ['wa-updates'] });
    },
  });

  const enviar = useMutation({
    mutationFn: (texto: string) => waInboxApi.send(chatId as number, texto),
    onSuccess: () => {
      setRascunho('');
      setErro(null);
      qc.invalidateQueries({ queryKey: ['wa-messages', chatId] });
      qc.invalidateQueries({ queryKey: ['wa-chats'] });
    },
    onError: (e) => setErro(apiError(e, 'Não foi possível enviar')),
  });

  function selecionar(id: number) {
    setChatId(id);
    setErro(null);
    abrir.mutate(id);
  }

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return chats;
    return chats.filter((c) => (c.name ?? c.remote_jid).toLowerCase().includes(q));
  }, [chats, busca]);

  const atual = chats.find((c) => c.id === chatId) ?? null;

  return (
    <DockWindow id={app.id} title="WhatsApp" tint={app.tint} visible={visible}>
      <div className="flex h-full min-h-0">
        {/* ---- Coluna das conversas ---- */}
        <aside className="flex w-64 shrink-0 flex-col border-r border-slate-200 bg-slate-50">
          <div className="relative p-2">
            <Search size={15} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar conversa"
              className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-2 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {isLoading && <div className="p-4"><Spinner /></div>}
            {!isLoading && filtradas.length === 0 && (
              <p className="p-4 text-center text-xs text-slate-400">
                {busca ? 'Nenhuma conversa com esse nome.' : 'Nenhuma conversa espelhada ainda.'}
              </p>
            )}
            {filtradas.map((c) => (
              <ChatRow key={c.id} chat={c} ativo={c.id === chatId} onClick={() => selecionar(c.id)} />
            ))}
          </div>
        </aside>

        {/* ---- Conversa ---- */}
        <section className="flex min-w-0 flex-1 flex-col">
          {atual === null ? (
            <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-slate-400">
              Escolha uma conversa à esquerda.
            </div>
          ) : (
            <>
              <header className="flex shrink-0 items-center gap-2 border-b border-slate-200 px-4 py-2">
                <Avatar chat={atual} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-800">{nomeDe(atual)}</p>
                  <p className="truncate text-xs text-slate-400">{atual.remote_jid.split('@')[0]}</p>
                </div>
              </header>

              <Thread mensagens={mensagens} carregando={carregandoMsgs} chatId={atual.id} />

              <div className="shrink-0 border-t border-slate-200 p-2">
                {erro && <div className="mb-2"><ErrorBox message={erro} /></div>}
                <div className="flex items-end gap-2">
                  <textarea
                    value={rascunho}
                    onChange={(e) => setRascunho(e.target.value)}
                    onKeyDown={(e) => {
                      // Enter envia, Shift+Enter quebra linha — o hábito do WhatsApp.
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        const t = rascunho.trim();
                        if (t && !enviar.isPending) enviar.mutate(t);
                      }
                    }}
                    rows={1}
                    placeholder="Escreva uma mensagem"
                    className="max-h-32 min-h-[var(--control-h)] flex-1 resize-y rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                  />
                  <button
                    type="button"
                    disabled={rascunho.trim() === '' || enviar.isPending}
                    onClick={() => enviar.mutate(rascunho.trim())}
                    aria-label="Enviar"
                    className="inline-flex h-[var(--control-h)] w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-600 text-white transition-colors hover:bg-emerald-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:opacity-40"
                  >
                    {/* O `Spinner` de ui.tsx vem com p-8 (é de tela cheia) e
                        estouraria o botão — aqui vai a versão do tamanho do ícone. */}
                    {enviar.isPending
                      ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                      : <Send size={17} />}
                  </button>
                </div>
              </div>
            </>
          )}
        </section>
      </div>
    </DockWindow>
  );
}

function ChatRow({ chat, ativo, onClick }: { chat: WaChat; ativo: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 border-b border-slate-100 px-2 py-2 text-left transition-colors ${
        ativo ? 'bg-white' : 'hover:bg-white/70'
      }`}
    >
      <Avatar chat={chat} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1">
          <span className={`truncate text-sm ${chat.unread_count ? 'font-semibold text-slate-900' : 'text-slate-700'}`}>
            {nomeDe(chat)}
          </span>
          <span className="ml-auto shrink-0 text-[10px] text-slate-400">{horaCurta(chat.last_message_at)}</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="truncate text-xs text-slate-500">
            {chat.last_from_me ? 'Você: ' : ''}{chat.last_preview ?? ''}
          </span>
          {chat.unread_count > 0 && (
            <span className="ml-auto shrink-0 rounded-full bg-emerald-600 px-1.5 text-[10px] font-bold text-white">
              {chat.unread_count}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

function Thread({ mensagens, carregando, chatId }: { mensagens: WaMessage[]; carregando: boolean; chatId: number }) {
  const scroller = useRef<HTMLDivElement>(null);
  // Guarda a intenção do usuário: quem subiu para reler algo não pode ser
  // arrastado de volta ao fim toda vez que chega mensagem nova.
  const coladoNoFim = useRef(true);
  // Abrindo a conversa a rolagem é obrigatória, mesmo que a linha acima diga o
  // contrário — ninguém abre um chat para cair no meio do histórico.
  const abrindo = useRef(true);
  // Rolagem que NÓS provocamos também dispara `onScroll`. Sem esta marca, o
  // próprio ato de rolar até o fim seria lido como "o usuário saiu do fim".
  const programatico = useRef(false);

  useEffect(() => {
    coladoNoFim.current = true;
    abrindo.current = true;
  }, [chatId]);

  // useLayoutEffect + `scrollTop` direto: rola ANTES da primeira pintura, então
  // a conversa nunca aparece no topo e depois pula. O contêiner também fica
  // SEMPRE montado (o spinner vai dentro dele) — se sumisse enquanto carrega, o
  // ref seria nulo justo no momento de rolar.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || (!abrindo.current && !coladoNoFim.current)) return;
    programatico.current = true;
    el.scrollTop = el.scrollHeight;
    if (mensagens.length > 0) abrindo.current = false;
    requestAnimationFrame(() => { programatico.current = false; });
  }, [mensagens, chatId]);

  let ultimoDia = '';
  return (
    <div
      ref={scroller}
      onScroll={(e) => {
        if (programatico.current) return;
        const el = e.currentTarget;
        coladoNoFim.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      }}
      className="min-h-0 flex-1 space-y-1 overflow-y-auto bg-[#F4F5FA] px-4 py-3"
    >
      {carregando && <Spinner />}
      {!carregando && mensagens.length === 0 && (
        <p className="py-8 text-center text-xs text-slate-400">Nenhuma mensagem espelhada nesta conversa.</p>
      )}
      {mensagens.map((m) => {
        const dia = (m.message_ts ?? '').slice(0, 10);
        const novoDia = dia !== ultimoDia;
        ultimoDia = dia;
        return (
          <div key={m.id}>
            {novoDia && dia && (
              <div className="my-3 text-center">
                <span className="rounded-full bg-white px-2.5 py-0.5 text-[10px] font-medium text-slate-500 shadow-[var(--shadow-sm)]">
                  {diaLabel(dia)}
                </span>
              </div>
            )}
            <Bolha m={m} />
          </div>
        );
      })}
    </div>
  );
}

function Bolha({ m }: { m: WaMessage }) {
  const meu = m.from_me === 1;
  const corpo = m.body?.trim();
  return (
    <div className={`flex ${meu ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[75%] rounded-2xl px-3 py-1.5 shadow-[var(--shadow-sm)] ${
          meu ? 'rounded-br-sm bg-emerald-100 text-slate-800' : 'rounded-bl-sm bg-white text-slate-800'
        }`}
      >
        {!meu && m.sender_name && (
          <p className="text-[11px] font-semibold text-emerald-700">{m.sender_name}</p>
        )}
        {m.type !== 'text' && (
          <p className="text-sm italic text-slate-500">{MEDIA_LABEL[m.type] ?? 'Mensagem'}</p>
        )}
        {corpo && <p className="whitespace-pre-wrap break-words text-sm">{corpo}</p>}
        <p className="mt-0.5 text-right text-[10px] leading-none text-slate-400">{horaCurta(m.message_ts)}</p>
      </div>
    </div>
  );
}

function Avatar({ chat }: { chat: WaChat }) {
  const nome = nomeDe(chat);
  return (
    <span
      className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
        chat.is_group ? 'bg-slate-200 text-slate-600' : 'bg-emerald-100 text-emerald-700'
      }`}
    >
      {chat.is_group ? <Users size={15} /> : nome.trim().charAt(0).toUpperCase()}
    </span>
  );
}

/** Contato sem nome no WhatsApp fica sendo o próprio número, como no app oficial. */
function nomeDe(chat: WaChat): string {
  return chat.name?.trim() || chat.remote_jid.split('@')[0];
}

function horaCurta(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function diaLabel(dia: string): string {
  // Data LOCAL montada à mão: `toISOString()` devolve UTC e, das 21h em diante
  // em America/Sao_Paulo, já apontaria para amanhã — "Hoje" nunca casaria.
  const local = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const hoje = new Date();
  if (dia === local(hoje)) return 'Hoje';
  if (dia === local(new Date(hoje.getTime() - 86_400_000))) return 'Ontem';
  const [y, m, d] = dia.split('-');
  return `${d}/${m}/${y}`;
}
