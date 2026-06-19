import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Check, Trash2, MessageCircle } from 'lucide-react';
import { inboxApi, quotationsApi, InboxRow } from '../../services/resources';
import { apiError } from '../../services/api';
import { brl } from '../../utils/format';
import { PageHeader } from '../../components/PageHeader';
import { Button, Card, Select, Spinner, ErrorBox, EmptyState } from '../../components/ui';

export function Inbox() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [quotationId, setQuotationId] = useState('');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  const { data, isLoading, error: listErr } = useQuery({ queryKey: ['inbox'], queryFn: inboxApi.list });
  const { data: quotations } = useQuery({ queryKey: ['quotations'], queryFn: quotationsApi.list });
  const openQuotations = (quotations ?? []).filter((q) => q.status !== 'closed');

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['inbox'] });
    qc.invalidateQueries({ queryKey: ['inbox-count'] });
    setSelected(new Set());
  };

  const sync = useMutation({
    mutationFn: inboxApi.sync,
    onSuccess: (r) => {
      const msg = r.itemsAdded > 0
        ? `Sincronizado: ${r.itemsAdded} item(ns) novos.`
        : r.pending > 0
          ? `${r.pending} mensagem(ns) nova(s) encontrada(s). A extração por IA roda em segundo plano (sincronização automática) — os preços aparecem aqui em alguns minutos.`
          : 'Nenhuma mensagem nova encontrada.';
      setMsg(msg);
      setError('');
      refresh();
    },
    onError: (e) => setError(apiError(e)),
  });
  const approve = useMutation({
    mutationFn: () => inboxApi.approve([...selected], Number(quotationId)),
    onSuccess: (r) => { setMsg(`${r.added} preço(s) adicionado(s) à cotação.`); setError(''); refresh(); },
    onError: (e) => setError(apiError(e)),
  });
  const discard = useMutation({
    mutationFn: () => inboxApi.discard([...selected]),
    onSuccess: refresh,
    onError: (e) => setError(apiError(e)),
  });

  // Agrupa os pendentes por fornecedor.
  const groups = useMemo(() => {
    const m = new Map<string, InboxRow[]>();
    for (const r of data ?? []) {
      const list = m.get(r.supplier_name) ?? [];
      list.push(r);
      m.set(r.supplier_name, list);
    }
    return [...m.entries()];
  }, [data]);

  function toggle(id: number) {
    setSelected((s) => {
      const next = new Set(s);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  function toggleGroup(rows: InboxRow[]) {
    const ids = rows.map((r) => r.id);
    const allSel = ids.every((id) => selected.has(id));
    setSelected((s) => {
      const next = new Set(s);
      ids.forEach((id) => (allSel ? next.delete(id) : next.add(id)));
      return next;
    });
  }

  function doApprove() {
    setError('');
    if (!selected.size) { setError('Selecione ao menos um item'); return; }
    if (!quotationId) { setError('Escolha a cotação de destino'); return; }
    approve.mutate();
  }

  return (
    <div>
      <PageHeader
        title="Caixa de entrada"
        subtitle="Preços extraídos do WhatsApp por IA, aguardando sua revisão"
        action={
          <Button variant="secondary" onClick={() => sync.mutate()} disabled={sync.isPending}>
            <RefreshCw size={16} className={sync.isPending ? 'animate-spin' : ''} /> Sincronizar agora
          </Button>
        }
      />

      {error && <div className="mb-3"><ErrorBox message={error} /></div>}
      {listErr && <div className="mb-3"><ErrorBox message={apiError(listErr)} /></div>}
      {msg && <div className="mb-3 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{msg}</div>}

      {isLoading && <Spinner />}

      {data && (groups.length === 0 ? (
        <EmptyState message="Nenhum preço pendente. Clique em 'Sincronizar agora' para buscar mensagens novas do WhatsApp." />
      ) : (
        <>
          {/* Barra de ação fixa */}
          <Card className="mb-4 flex flex-wrap items-center gap-3">
            <span className="text-sm text-slate-600">{selected.size} selecionado(s)</span>
            <Select value={quotationId} onChange={(e) => setQuotationId(e.target.value)} className="max-w-xs">
              <option value="">— cotação de destino —</option>
              {openQuotations.map((q) => <option key={q.id} value={q.id}>{q.title}</option>)}
            </Select>
            <Button onClick={doApprove} disabled={approve.isPending || !selected.size}>
              <Check size={16} /> Aprovar p/ cotação
            </Button>
            <Button variant="danger" onClick={() => discard.mutate()} disabled={discard.isPending || !selected.size}>
              <Trash2 size={16} /> Descartar
            </Button>
          </Card>

          <div className="space-y-4">
            {groups.map(([supplier, rows]) => (
              <Card key={supplier} className="p-0">
                <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
                  <h3 className="flex items-center gap-2 font-semibold text-slate-800">
                    <MessageCircle size={16} className="text-emerald-600" /> {supplier}
                    <span className="text-xs font-normal text-slate-400">({rows.length})</span>
                  </h3>
                  <button onClick={() => toggleGroup(rows)} className="text-xs text-emerald-600 hover:underline">
                    selecionar todos
                  </button>
                </div>
                <table className="w-full text-sm">
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} className="border-b border-slate-50 last:border-0">
                        <td className="w-10 px-5 py-2">
                          <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} className="h-4 w-4 accent-emerald-600" />
                        </td>
                        <td className="py-2 font-medium text-slate-800">{r.item_name} <span className="text-xs text-slate-400">({r.unit})</span></td>
                        <td className="py-2 text-right text-slate-600">{brl(r.price)}</td>
                        <td className="py-2 pl-4 pr-5 text-right text-xs text-slate-400" title={r.raw_message ?? ''}>
                          {r.raw_message ? `"${r.raw_message.slice(0, 40)}${r.raw_message.length > 40 ? '…' : ''}"` : ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            ))}
          </div>
        </>
      ))}
    </div>
  );
}
