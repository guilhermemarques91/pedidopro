import { itemsApi } from './resources';
import type { Item } from '../types';
import type { ComboOption } from '../components/ui';

export interface OrderItemOptions {
  options: ComboOption[];
  priceByValue: Map<string, string | null>;
}

/**
 * Monta as opções do seletor de item de um pedido a partir de:
 *  - itens já disponíveis ao fornecedor (`si:<id>`),
 *  - demais itens do catálogo, de outros fornecedores (`link:<id>`).
 * O `Combobox` ainda oferece criar um item novo (`new:<nome>`) via `onCreate`.
 */
export function buildOrderItemOptions(supplierItems: Item[] = [], allItems: Item[] = []): OrderItemOptions {
  const priceByValue = new Map<string, string | null>();
  const availableIds = new Set(supplierItems.map((i) => i.id));
  const options: ComboOption[] = [];

  for (const it of supplierItems) {
    const v = `si:${it.id}`;
    options.push({ value: v, label: it.name, hint: it.unit });
    priceByValue.set(v, it.base_price);
  }
  for (const it of allItems) {
    if (availableIds.has(it.id)) continue;
    const v = `link:${it.id}`;
    options.push({ value: v, label: it.name, hint: `vincular · ${it.supplier_name ?? ''}`.trim() });
    priceByValue.set(v, it.base_price);
  }

  options.sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
  return { options, priceByValue };
}

/**
 * Resolve o valor escolhido no seletor em um `item_id` utilizável no pedido,
 * criando/vinculando o item ao fornecedor quando necessário:
 *  - `si:<id>`   → já disponível, usa direto.
 *  - `link:<id>` → vincula o item ao fornecedor e usa o mesmo id.
 *  - `new:<nome>`→ cria um item novo com origem nesse fornecedor.
 */
export async function resolveOrderItemId(
  value: string,
  ctx: { supplierId: number; unit?: string; price: number | null },
): Promise<number> {
  const sep = value.indexOf(':');
  const kind = sep === -1 ? value : value.slice(0, sep);
  const rest = sep === -1 ? '' : value.slice(sep + 1);

  if (kind === 'si') return Number(rest);

  if (kind === 'link') {
    await itemsApi.linkSupplier(Number(rest), { supplier_id: ctx.supplierId, base_price: ctx.price });
    return Number(rest);
  }

  if (kind === 'new') {
    const created = await itemsApi.create({
      supplier_id: ctx.supplierId,
      name: rest,
      unit: ctx.unit || 'un',
      base_price: ctx.price === null ? undefined : (ctx.price as unknown as string),
    });
    return created.id;
  }

  throw new Error('Seleção de item inválida');
}
