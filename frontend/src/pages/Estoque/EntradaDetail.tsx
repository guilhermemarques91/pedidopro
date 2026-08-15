import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Ban, Camera, Check, PackageCheck } from 'lucide-react';
import { productsApi, receiptsApi, suppliersApi } from '../../services/resources';
import { apiError } from '../../services/api';
import { PageHeader } from '../../components/PageHeader';
import { Button, Card, Combobox, Input, Select, Spinner, ErrorBox, EmptyState } from '../../components/ui';
import { LINE_TONE, RECEIPT_TONE, RECEIPT_SOURCE_LABEL } from '../../config/estoque';
import { brl, fmtQty, numToInput, parseNum } from '../../utils/format';
import { useAuth } from '../../store/auth.store';
import type { ScannedLine, StockReceiptItem } from '../../types';

/**
 * Conferência de uma entrada: esperado × recebido, linha a linha.
 *
 * Os dois lados ficam à vista de propósito. A nota manda — ela sobrescreve o pedido —, mas
 * sobrescrever em silêncio esconderia justamente o que interessa: o fornecedor entregou
 * menos, ou cobrou mais, e alguém precisa ver isso antes de confirmar.
 */
export function EntradaDetail() {
  const { id } = useParams();
  const rid = Number(id);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const can = useAuth((s) => s.can);
  const canMove = can('estoque:mover');

  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [scanned, setScanned] = useState<ScannedLine[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const receipt = useQuery({ queryKey: ['stock-receipt', rid], queryFn: () => receiptsApi.get(rid), enabled: rid > 0 });
  const products = useQuery({ queryKey: ['products'], queryFn: () => productsApi.list() });
  const suppliers = useQuery({ queryKey: ['suppliers'], queryFn: suppliersApi.list });
  const [editingSupplier, setEditingSupplier] = useState(false);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['stock-receipt', rid] });
    qc.invalidateQueries({ queryKey: ['stock-receipts'] });
  };
  const fail = (e: unknown) => { setMsg(''); setErr(apiError(e)); };

  const confirm = useMutation({
    mutationFn: () => receiptsApi.confirm(rid),
    onSuccess: (r) => {
      setErr('');
      setMsg(
        `Entrada conferida: ${r.moved} item(ns) deram entrada no estoque.`
        + (r.skipped.length ? ` Ficaram de fora (sem produto vinculado): ${r.skipped.join(', ')}.` : '')
        + (r.order_status === 'partially_received' ? ' O pedido ficou como recebido parcialmente.' : ''),
      );
      invalidate();
    },
    onError: fail,
  });
  const cancel = useMutation({
    mutationFn: () => receiptsApi.cancel(rid),
    onSuccess: () => { setErr(''); invalidate(); navigate('/estoque/entradas'); },
    onError: fail,
  });
  const scan = useMutation({
    mutationFn: (f: File) => receiptsApi.scan(rid, f),
    onSuccess: (r) => { setErr(''); setScanned(r.lines); },
    onError: fail,
  });
  const applyScan = useMutation({
    mutationFn: (lines: ScannedLine[]) =>
      receiptsApi.applyScan(
        rid,
        lines
          .filter((l) => (l.quantity ?? 0) > 0)
          .map((l) => ({ name: l.name, unit: l.unit, quantity: l.quantity as number, unit_price: l.price ?? 0 })),
      ),
    onSuccess: () => { setErr(''); setScanned(null); setMsg('Linhas da nota lançadas na conferência.'); invalidate(); },
    onError: fail,
  });
  const updateSupplier = useMutation({
    mutationFn: (supplierId: number) => receiptsApi.update(rid, { supplier_id: supplierId }),
    onSuccess: () => { setErr(''); setEditingSupplier(false); invalidate(); },
    onError: fail,
  });
  const addLine = useMutation({
    mutationFn: (body: { product_id: number; doc_name?: string; doc_unit?: string; qty_received: number; price_received?: number | null }) =>
      receiptsApi.addLine(rid, body),
    onSuccess: () => { setErr(''); invalidate(); },
    onError: fail,
  });

  const productOptions = useMemo(
    () => (products.data ?? []).map((p) => ({
      value: String(p.id),
      label: p.name,
      hint: [p.tipo, p.unit].filter(Boolean).join(' · '),
    })),
    [products.data],
  );

  if (receipt.isLoading) return <Spinner />;
  if (receipt.error) return <ErrorBox message={apiError(receipt.error)} />;
  if (!receipt.data) return null;

  const r = receipt.data;
  const items = r.items ?? [];
  const open = r.status === 'aguardando';
  const pending = items.filter((i) => i.status === 'pendente_vinculo').length;
  const tone = RECEIPT_TONE[r.status];

  return (
    <div>
      <Link to="/estoque/entradas" className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
        <ArrowLeft size={15} /> Entradas
      </Link>
      <PageHeader
        title={`Entrada #${r.id} — ${r.supplier_name ?? 'sem fornecedor'}`}
        subtitle={
          `${RECEIPT_SOURCE_LABEL[r.source] ?? r.source}`
          + (r.order_id ? ` · pedido #${r.order_id}` : '')
          + (r.doc_number ? ` · nota ${r.doc_number}` : '')
        }
      />

      {err && <div className="mb-3"><ErrorBox message={err} /></div>}
      {msg && (
        <Card className="mb-3 border-emerald-200 bg-emerald-50/60">
          <p className="text-sm text-emerald-900">{msg}</p>
        </Card>
      )}

      <Card className="mb-4 flex flex-wrap items-center gap-3">
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${tone.chip}`}>{tone.label}</span>
        {open && canMove && editingSupplier ? (
          <label className="flex items-center gap-2 text-sm">
            <span className="font-medium text-slate-600">Fornecedor</span>
            <Select
              defaultValue={r.supplier_id ?? ''}
              autoFocus
              onChange={(e) => { if (e.target.value) updateSupplier.mutate(Number(e.target.value)); }}
              disabled={updateSupplier.isPending}
              className="w-56"
            >
              <option value="" disabled>— escolher fornecedor —</option>
              {(suppliers.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
            <button type="button" onClick={() => setEditingSupplier(false)} className="text-xs text-slate-400 hover:text-slate-600">
              cancelar
            </button>
          </label>
        ) : (
          open && canMove && (
            <button
              type="button"
              onClick={() => setEditingSupplier(true)}
              className="text-sm text-slate-600 underline decoration-dotted hover:text-emerald-700"
              title="Trocar o fornecedor desta entrada"
            >
              {r.supplier_name ?? 'sem fornecedor'} <span className="text-xs text-slate-400">(trocar)</span>
            </button>
          )
        )}
        {r.doc_total != null && <span className="text-sm text-slate-600">Total da nota: <strong>{brl(r.doc_total)}</strong></span>}
        {r.order_id && (
          <Link to={`/orders/${r.order_id}`} className="text-sm text-emerald-700 hover:underline">Ver pedido #{r.order_id}</Link>
        )}
        <div className="ml-auto flex flex-wrap gap-2">
          {open && canMove && (
            <>
              <input
                ref={fileRef}
                type="file"
                accept="image/*,application/pdf"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) scan.mutate(f); e.target.value = ''; }}
              />
              <Button variant="secondary" onClick={() => fileRef.current?.click()} disabled={scan.isPending}>
                <Camera size={16} /> {scan.isPending ? 'Lendo a nota…' : 'Ler nota (foto/PDF)'}
              </Button>
              <Button onClick={() => confirm.mutate()} disabled={confirm.isPending}>
                <PackageCheck size={16} /> Confirmar entrada
              </Button>
              <Button variant="ghost" onClick={() => confirm2(cancel)} disabled={cancel.isPending}>
                <Ban size={16} /> Cancelar
              </Button>
            </>
          )}
        </div>
      </Card>

      {open && pending > 0 && (
        <Card className="mb-4 border-rose-200 bg-rose-50/60">
          <p className="text-sm text-rose-900">
            <strong>{pending} item(ns) sem produto do ERP.</strong> Eles não vão dar entrada no estoque enquanto
            ninguém escolher o produto. Vincular aqui também ensina o sistema: a próxima nota deste fornecedor casa
            sozinha pelo código dele.
          </p>
        </Card>
      )}

      {scanned && (
        <ScanReview
          lines={scanned}
          busy={applyScan.isPending}
          onCancel={() => setScanned(null)}
          onApply={(l) => applyScan.mutate(l)}
        />
      )}

      {open && canMove && (
        <AddLineForm
          productOptions={productOptions}
          busy={addLine.isPending}
          onAdd={(body) => addLine.mutate(body)}
        />
      )}

      {items.length === 0 ? (
        <EmptyState message="Esta entrada não tem linhas." />
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full min-w-[56rem] text-sm">
            <thead className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-semibold">Item</th>
                <th className="px-4 py-3 text-right font-semibold">Pedido</th>
                <th className="px-4 py-3 text-right font-semibold">Recebido</th>
                <th className="px-4 py-3 text-right font-semibold">Preço pedido</th>
                <th className="px-4 py-3 text-right font-semibold">Preço da nota</th>
                <th className="px-4 py-3 font-semibold">Situação</th>
              </tr>
            </thead>
            <tbody>
              {items.map((line) => (
                <LineRow
                  key={line.id}
                  receiptId={rid}
                  line={line}
                  editable={open && canMove}
                  productOptions={productOptions}
                  onChanged={invalidate}
                  onError={fail}
                />
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

/** Confirmação de cancelamento — a entrada some da fila sem mexer no estoque. */
function confirm2(m: { mutate: () => void }) {
  if (window.confirm('Cancelar esta entrada? O estoque não será alterado.')) m.mutate();
}

/**
 * Lança um item na mão — a entrada avulsa nasce sem nenhuma linha, e mesmo entradas de
 * pedido/NF-e às vezes precisam de um item extra que o documento original não trouxe.
 */
function AddLineForm({
  productOptions, busy, onAdd,
}: {
  productOptions: { value: string; label: string; hint?: string }[];
  busy: boolean;
  onAdd: (body: { product_id: number; doc_unit?: string; qty_received: number; price_received?: number | null }) => void;
}) {
  const [productId, setProductId] = useState('');
  const [unit, setUnit] = useState('');
  const [qty, setQty] = useState('');
  const [price, setPrice] = useState('');

  const canAdd = productId !== '' && parseNum(qty) !== null && (parseNum(qty) as number) > 0;

  function add() {
    if (!canAdd) return;
    onAdd({
      product_id: Number(productId),
      doc_unit: unit.trim() || undefined,
      qty_received: parseNum(qty) as number,
      price_received: price.trim() === '' ? null : parseNum(price),
    });
    setProductId(''); setUnit(''); setQty(''); setPrice('');
  }

  return (
    <Card className="mb-4">
      <p className="mb-2 text-sm font-semibold text-slate-700">Adicionar item</p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[14rem] flex-1">
          <Combobox options={productOptions} value={productId} placeholder="Produto…" onChange={setProductId} />
        </div>
        <Input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="un" className="w-16" aria-label="Unidade" />
        <Input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal" placeholder="qtd" className="w-20 text-right" aria-label="Quantidade" />
        <Input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="preço un." className="w-24 text-right" aria-label="Preço unitário" />
        <Button type="button" onClick={add} disabled={!canAdd || busy}>Adicionar</Button>
      </div>
    </Card>
  );
}

function LineRow({
  receiptId, line, editable, productOptions, onChanged, onError,
}: {
  receiptId: number;
  line: StockReceiptItem;
  editable: boolean;
  productOptions: { value: string; label: string; hint?: string }[];
  onChanged: () => void;
  onError: (e: unknown) => void;
}) {
  const [qty, setQty] = useState(line.qty_received != null ? numToInput(line.qty_received) : '');
  const [price, setPrice] = useState(line.price_received != null ? numToInput(line.price_received) : '');

  const save = useMutation({
    mutationFn: (body: { qty_received?: number | null; price_received?: number | null }) =>
      receiptsApi.updateLine(receiptId, line.id, body),
    onSuccess: onChanged,
    onError,
  });
  const link = useMutation({
    mutationFn: (productId: number) => receiptsApi.linkLine(receiptId, line.id, productId),
    onSuccess: onChanged,
    onError,
  });

  const tone = LINE_TONE[line.status];
  const expQty = line.qty_expected != null ? Number(line.qty_expected) : null;
  const gotQty = line.qty_received != null ? Number(line.qty_received) : null;
  const previewQty = line.stock_qty_preview != null ? Number(line.stock_qty_preview) : null;
  const short = expQty != null && gotQty != null && gotQty < expQty;

  return (
    <tr className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
      <td className="px-4 py-3">
        <p className="font-medium text-slate-800">{line.product_name ?? line.doc_name}</p>
        <p className="text-xs text-slate-400">
          {line.doc_name !== (line.product_name ?? line.doc_name) && <>na nota: “{line.doc_name}” · </>}
          {line.doc_code && <>cód. {line.doc_code} · </>}
          {line.doc_unit ?? line.product_unit ?? ''}
        </p>
        {line.status === 'pendente_vinculo' && editable && (
          <div className="mt-2 max-w-xs">
            <Combobox
              options={productOptions}
              value=""
              placeholder="Vincular a um produto…"
              onChange={(v) => link.mutate(Number(v))}
            />
          </div>
        )}
      </td>
      <td className="px-4 py-3 text-right text-slate-500">{expQty != null ? fmtQty(expQty) : '—'}</td>
      <td className="px-4 py-3 text-right">
        {editable ? (
          <Input
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            onBlur={() => {
              const v = qty.trim() === '' ? null : parseNum(qty);
              if (v === (line.qty_received != null ? Number(line.qty_received) : null)) return;
              save.mutate({ qty_received: v });
            }}
            inputMode="decimal"
            placeholder={expQty != null ? numToInput(expQty) : '0'}
            aria-label={`Quantidade recebida de ${line.doc_name ?? ''}`}
            className={`w-24 text-right ${short ? 'border-amber-400' : ''}`}
          />
        ) : (
          <span className={short ? 'font-medium text-amber-700' : 'text-slate-700'}>
            {gotQty != null ? fmtQty(gotQty) : '—'}
          </span>
        )}
        {previewQty != null && gotQty != null && Math.abs(previewQty - gotQty) > 0.0005 && (
          <p className="mt-0.5 text-xs text-slate-400" title="Embalagem de compra cadastrada no item convertendo pra unidade de estoque">
            = {fmtQty(previewQty)} {line.product_unit ?? ''} no estoque
          </p>
        )}
      </td>
      <td className="px-4 py-3 text-right text-slate-500">
        {line.price_expected != null ? brl(line.price_expected) : '—'}
      </td>
      <td className="px-4 py-3 text-right">
        {editable ? (
          <Input
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            onBlur={() => {
              const v = price.trim() === '' ? null : parseNum(price);
              if (v === (line.price_received != null ? Number(line.price_received) : null)) return;
              save.mutate({ price_received: v });
            }}
            inputMode="decimal"
            placeholder={line.price_expected != null ? numToInput(line.price_expected) : '0,00'}
            aria-label={`Preço da nota de ${line.doc_name ?? ''}`}
            className="w-24 text-right"
          />
        ) : (
          <span className="text-slate-700">{line.price_received != null ? brl(line.price_received) : '—'}</span>
        )}
      </td>
      <td className="px-4 py-3">
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${tone.chip}`}>{tone.label}</span>
      </td>
    </tr>
  );
}

/** Rascunho lido da foto: a IA sugere, o conferente aceita. Nada foi gravado ainda. */
function ScanReview({
  lines, busy, onApply, onCancel,
}: {
  lines: ScannedLine[];
  busy: boolean;
  onApply: (lines: ScannedLine[]) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(lines);
  const usable = draft.filter((l) => (l.quantity ?? 0) > 0).length;

  return (
    <Card className="mb-4 border-sky-200 bg-sky-50/50">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-slate-700">Linhas lidas da nota</h3>
        <span className="text-xs text-slate-500">
          A IA leu {draft.length} linha(s) — confira antes de lançar. Quantidade zerada é ignorada.
        </span>
        <div className="ml-auto flex gap-2">
          <Button variant="ghost" onClick={onCancel}>Descartar</Button>
          <Button onClick={() => onApply(draft)} disabled={busy || usable === 0}>
            <Check size={16} /> Lançar {usable} linha(s)
          </Button>
        </div>
      </div>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full min-w-[36rem] text-sm">
          <thead className="border-b border-slate-200 text-left text-xs text-slate-500">
            <tr>
              <th className="px-3 py-2 font-medium">Descrição</th>
              <th className="px-3 py-2 font-medium">Un.</th>
              <th className="px-3 py-2 text-right font-medium">Quantidade</th>
              <th className="px-3 py-2 text-right font-medium">Preço un.</th>
            </tr>
          </thead>
          <tbody>
            {draft.map((l, i) => (
              <tr key={i} className="border-b border-slate-100 last:border-0">
                <td className="px-3 py-2">
                  <Input
                    value={l.name}
                    onChange={(e) => setDraft((d) => d.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                    aria-label={`Descrição da linha ${i + 1}`}
                  />
                </td>
                <td className="px-3 py-2">
                  <Input
                    value={l.unit}
                    onChange={(e) => setDraft((d) => d.map((x, j) => (j === i ? { ...x, unit: e.target.value } : x)))}
                    className="w-16"
                    aria-label={`Unidade da linha ${i + 1}`}
                  />
                </td>
                <td className="px-3 py-2 text-right">
                  <Input
                    value={l.quantity != null ? numToInput(l.quantity) : ''}
                    onChange={(e) => setDraft((d) => d.map((x, j) => (j === i ? { ...x, quantity: parseNum(e.target.value) } : x)))}
                    inputMode="decimal"
                    className="w-24 text-right"
                    aria-label={`Quantidade da linha ${i + 1}`}
                  />
                </td>
                <td className="px-3 py-2 text-right">
                  <Input
                    value={l.price != null ? numToInput(l.price) : ''}
                    onChange={(e) => setDraft((d) => d.map((x, j) => (j === i ? { ...x, price: parseNum(e.target.value) } : x)))}
                    inputMode="decimal"
                    className="w-24 text-right"
                    aria-label={`Preço da linha ${i + 1}`}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
