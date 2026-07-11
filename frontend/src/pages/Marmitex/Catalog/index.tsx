import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, Eye, EyeOff } from 'lucide-react';
import { marmitexApi, productsApi, CatalogItemBody } from '../../../services/resources';
import { apiError } from '../../../services/api';
import type { CatalogType, MarmitexSize, MarmitexOption, Product } from '../../../types';
import { PageHeader } from '../../../components/PageHeader';
import { Button, Card, Field, Input, Select, Modal, Spinner, ErrorBox, EmptyState } from '../../../components/ui';
import { brl, parseNum, numToInput } from '../../../utils/format';

// `observations` não vira consumo: não tem produto vinculado.
const TABS: { type: CatalogType; label: string; singular: string; hasPrice?: boolean; hasProduct?: boolean }[] = [
  { type: 'sizes', label: 'Tamanhos', singular: 'tamanho', hasPrice: true, hasProduct: true },
  { type: 'proteins', label: 'Proteínas', singular: 'proteína', hasProduct: true },
  { type: 'sides', label: 'Acompanhamentos', singular: 'acompanhamento', hasProduct: true },
  { type: 'observations', label: 'Observações', singular: 'observação' },
];

type Row = MarmitexSize | MarmitexOption;

export function MarmitexCatalogPage() {
  const [tab, setTab] = useState<CatalogType>('sizes');
  const { data, isLoading, error } = useQuery({ queryKey: ['marmitex-catalog'], queryFn: () => marmitexApi.catalog() });
  const current = TABS.find((t) => t.type === tab)!;

  return (
    <div>
      <PageHeader title="Cardápio" subtitle="Opções e preços disponíveis para os pedidos das empresas" />

      <div className="mb-4 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.type}
            onClick={() => setTab(t.type)}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
              tab === t.type ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {isLoading && <Spinner />}
      {error && <ErrorBox message={apiError(error)} />}
      {data && (
        <CatalogSection
          type={tab}
          singular={current.singular}
          hasPrice={!!current.hasPrice}
          hasProduct={!!current.hasProduct}
          rows={(data[tab] as Row[]) ?? []}
        />
      )}
    </div>
  );
}

function CatalogSection({ type, singular, hasPrice, hasProduct, rows }: {
  type: CatalogType; singular: string; hasPrice: boolean; hasProduct: boolean; rows: Row[];
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Row | null>(null);
  const [open, setOpen] = useState(false);

  // Só para exibir o nome do produto vinculado e alimentar o select do formulário.
  const { data: products } = useQuery({
    queryKey: ['products'], queryFn: () => productsApi.list(), enabled: hasProduct,
  });
  const productName = (id?: number | null) => products?.find((p) => p.id === id)?.name;

  const invalidate = () => qc.invalidateQueries({ queryKey: ['marmitex-catalog'] });
  const toggle = useMutation({
    mutationFn: (r: Row) => marmitexApi.catalogUpdate(type, r.id, { active: !r.active }),
    onSuccess: invalidate,
  });
  const remove = useMutation({ mutationFn: (id: number) => marmitexApi.catalogRemove(type, id), onSuccess: invalidate });

  return (
    <Card className="p-0">
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
        <span className="text-sm font-medium text-slate-500">{rows.length} cadastrado(s)</span>
        <Button onClick={() => { setEditing(null); setOpen(true); }}><Plus size={16} /> Adicionar</Button>
      </div>

      {rows.length === 0 ? (
        <EmptyState message={`Nenhum(a) ${singular} cadastrado(a).`} />
      ) : (
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 text-left text-slate-500">
            <tr>
              <th className="px-5 py-3 font-medium">Nome</th>
              {hasPrice && <th className="px-5 py-3 font-medium">Preço</th>}
              {hasProduct && <th className="px-5 py-3 font-medium">Produto (baixa de estoque)</th>}
              <th className="px-5 py-3 font-medium">Situação</th>
              <th className="px-5 py-3" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={`border-b border-slate-100 last:border-0 ${!r.active ? 'opacity-50' : ''}`}>
                <td className="px-5 py-3 font-medium text-slate-800">{r.name}</td>
                {hasPrice && <td className="px-5 py-3 text-slate-700">{brl((r as MarmitexSize).price)}</td>}
                {hasProduct && (
                  <td className="px-5 py-3">
                    {r.product_id ? (
                      <span className="text-slate-700">{productName(r.product_id) ?? `#${r.product_id}`}</span>
                    ) : (
                      <span className="text-amber-600">Sem vínculo — não baixa estoque</span>
                    )}
                  </td>
                )}
                <td className="px-5 py-3 text-slate-500">{r.active ? 'Ativo' : 'Inativo'}</td>
                <td className="px-5 py-3 text-right whitespace-nowrap">
                  <button onClick={() => toggle.mutate(r)} className="mr-2 text-slate-400 hover:text-emerald-600" title={r.active ? 'Desativar' : 'Ativar'}>
                    {r.active ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                  <button onClick={() => { setEditing(r); setOpen(true); }} className="mr-2 text-slate-400 hover:text-emerald-600"><Pencil size={16} /></button>
                  <button onClick={() => confirm(`Excluir "${r.name}"?`) && remove.mutate(r.id)} className="text-slate-400 hover:text-red-600"><Trash2 size={16} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {open && (
        <CatalogForm
          type={type}
          singular={singular}
          hasPrice={hasPrice}
          hasProduct={hasProduct}
          products={products ?? []}
          row={editing}
          onClose={() => setOpen(false)}
          onSaved={() => { invalidate(); setOpen(false); }}
        />
      )}
    </Card>
  );
}

function CatalogForm({
  type, singular, hasPrice, hasProduct, products, row, onClose, onSaved,
}: {
  type: CatalogType; singular: string; hasPrice: boolean; hasProduct: boolean;
  products: Product[]; row: Row | null; onClose: () => void; onSaved: () => void;
}) {
  const [name, setName] = useState(row?.name ?? '');
  const [price, setPrice] = useState(row && hasPrice ? numToInput((row as MarmitexSize).price) : '');
  const [productId, setProductId] = useState(row?.product_id ? String(row.product_id) : '');
  const [error, setError] = useState('');

  const save = useMutation({
    mutationFn: (body: CatalogItemBody) => (row ? marmitexApi.catalogUpdate(type, row.id, body) : marmitexApi.catalogCreate(type, body)),
    onSuccess: onSaved,
    onError: (e) => setError(apiError(e)),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    const body: CatalogItemBody = { name };
    if (hasPrice) body.price = parseNum(price) ?? 0;
    if (hasProduct) body.product_id = productId ? Number(productId) : null;
    save.mutate(body);
  }

  return (
    <Modal title={`${row ? 'Editar' : 'Novo(a)'} ${singular}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {error && <ErrorBox message={error} />}
        <Field label="Nome"><Input value={name} onChange={(e) => setName(e.target.value)} required autoFocus /></Field>
        {hasPrice && (
          <Field label="Preço (R$)">
            <Input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" placeholder="0,00" />
          </Field>
        )}
        {hasProduct && (
          <Field label="Produto (ficha técnica)">
            <Select value={productId} onChange={(e) => setProductId(e.target.value)}>
              <option value="">Não controla estoque</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </Select>
            <p className="mt-1 text-xs text-slate-500">
              Ao fechar a produção do dia, a receita deste produto é explodida e os insumos saem do estoque.
            </p>
          </Field>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={save.isPending}>Salvar</Button>
        </div>
      </form>
    </Modal>
  );
}
