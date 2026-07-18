import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Minus, Plus } from 'lucide-react';
import { vendasApi } from '../../services/resources';
import { apiError } from '../../services/api';
import type { Product } from '../../types';
import { Button, Field, Textarea, Modal, Spinner, ErrorBox } from '../../components/ui';
import { brl } from '../../utils/format';

/** O que a tela de preparo devolve pro carrinho quando confirma. */
export interface PrepResult {
  quantity: number;
  unitPrice: number;
  notes: string | null;
  removed: { component_id: number; name: string }[];
  variations: { option_id: number; group: string; label: string }[];
}

/**
 * Tela de observações de preparo — abre SEMPRE que um produto é lançado:
 * variações da ficha (ex.: a proteína do Executivo), ficha técnica com marcadores
 * para tirar insumos ("sem cebola") e observação livre pra cozinha.
 */
export function PrepModal({
  product, onClose, onConfirm,
}: { product: Product; onClose: () => void; onConfirm: (r: PrepResult) => void }) {
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState('');
  // Linhas da ficha desmarcadas: chave = component_id ou "free:{name}" (insumo avulso).
  const [removedKeys, setRemovedKeys] = useState<Set<string>>(new Set());
  const [chosen, setChosen] = useState<Record<number, number>>({}); // group_id -> option_id

  const { data: prep, isLoading, error } = useQuery({
    queryKey: ['vendas-prep', product.id],
    queryFn: () => vendasApi.prep(product.id),
  });

  const priceDelta = useMemo(() => {
    if (!prep) return 0;
    return prep.groups.reduce((sum, g) => {
      const opt = g.options.find((o) => o.id === chosen[g.id]);
      return sum + (opt ? Number(opt.price_delta) : 0);
    }, 0);
  }, [prep, chosen]);

  const unitPrice = Number(product.sale_price ?? 0) + priceDelta;
  const missingRequired = (prep?.groups ?? []).filter((g) => g.required && !chosen[g.id]);

  function toggleLine(key: string) {
    setRemovedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function confirm() {
    if (!prep || missingRequired.length > 0) return;
    const removed: PrepResult['removed'] = [];
    const freeRemoved: string[] = [];
    for (const line of prep.recipe) {
      const key = line.component_id != null ? String(line.component_id) : `free:${line.name}`;
      if (!removedKeys.has(key)) continue;
      if (line.component_id != null) removed.push({ component_id: line.component_id, name: line.name });
      else freeRemoved.push(line.name);
    }
    // Insumo avulso (sem cadastro) não muda estoque — vira observação pra cozinha.
    const noteParts = [...freeRemoved.map((n) => `Sem ${n}`), notes.trim()].filter(Boolean);
    const variations = prep.groups.flatMap((g) => {
      const opt = g.options.find((o) => o.id === chosen[g.id]);
      return opt ? [{ option_id: opt.id, group: g.name, label: opt.name }] : [];
    });
    onConfirm({
      quantity,
      unitPrice,
      notes: noteParts.length ? noteParts.join(' · ').slice(0, 255) : null,
      removed,
      variations,
    });
  }

  return (
    <Modal title={product.name} onClose={onClose}>
      {isLoading && <Spinner />}
      {error && <ErrorBox message={apiError(error)} />}

      {prep && (
        <div className="space-y-4">
          {/* Variações (ex.: proteína do Executivo) */}
          {prep.groups.map((g) => (
            <div key={g.id}>
              <p className="mb-1.5 text-sm font-medium text-slate-700">
                {g.name}
                {g.required && <span className="ml-1 text-xs font-normal text-amber-600">(escolha uma)</span>}
              </p>
              <div className="flex flex-wrap gap-2">
                {g.options.map((o) => {
                  const active = chosen[g.id] === o.id;
                  const delta = Number(o.price_delta);
                  return (
                    <button
                      key={o.id}
                      type="button"
                      onClick={() => setChosen((prev) => {
                        const next = { ...prev };
                        // Grupo opcional: clicar de novo desmarca.
                        if (active && !g.required) delete next[g.id];
                        else next[g.id] = o.id;
                        return next;
                      })}
                      className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition ${
                        active
                          ? 'border-emerald-600 bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600'
                          : 'border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      {o.name}
                      {delta !== 0 && (
                        <span className={`ml-1 text-xs ${delta > 0 ? 'text-slate-500' : 'text-emerald-600'}`}>
                          {delta > 0 ? `+${brl(delta)}` : brl(delta)}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          {/* Ficha técnica: desmarcar = "sem X" */}
          {prep.recipe.length > 0 && (
            <div>
              <p className="mb-1.5 text-sm font-medium text-slate-700">
                Ficha técnica <span className="text-xs font-normal text-slate-400">(desmarque para tirar)</span>
              </p>
              <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2">
                {prep.recipe.map((line, i) => {
                  const key = line.component_id != null ? String(line.component_id) : `free:${line.name}`;
                  const removed = removedKeys.has(key);
                  return (
                    <label
                      key={`${key}-${i}`}
                      className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm transition hover:bg-slate-50 ${
                        removed ? 'text-red-600 line-through' : 'text-slate-700'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={!removed}
                        onChange={() => toggleLine(key)}
                        className="h-4 w-4 accent-emerald-600"
                      />
                      <span className="flex-1 truncate">{line.name}</span>
                      {line.quantity != null && Number(line.quantity) > 0 && (
                        <span className="text-xs text-slate-400">{Number(line.quantity)} {line.unit ?? ''}</span>
                      )}
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          <Field label="Observações (livre)">
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              maxLength={255}
              placeholder="Ex.: bem passado, molho à parte…"
            />
          </Field>

          <div className="flex items-center justify-between border-t border-slate-100 pt-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-50"
              >
                <Minus size={16} />
              </button>
              <span className="w-8 text-center text-lg font-semibold">{quantity}</span>
              <button
                type="button"
                onClick={() => setQuantity((q) => q + 1)}
                className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-50"
              >
                <Plus size={16} />
              </button>
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
              <Button
                type="button"
                disabled={missingRequired.length > 0}
                title={missingRequired.length > 0 ? `Escolha: ${missingRequired.map((g) => g.name).join(', ')}` : undefined}
                onClick={confirm}
              >
                Adicionar {brl(unitPrice * quantity)}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
