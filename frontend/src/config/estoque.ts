import type { MoveReason, ReceiptLineStatus, ReceiptStatus, ReplenishStatus } from '../types';

/**
 * Motivos de um lançamento manual de estoque.
 *
 * ESPELHO de `App\Modules\Stock\StockController::REASONS` (backend), que é a fonte da
 * verdade e valida o que chega. Existe porque antes o motivo era texto livre em `notes`:
 * perda por vencimento, quebra na cozinha e consumo da equipe ficavam indistinguíveis, e
 * sem separá-los não há relatório de perdas possível.
 */
export const MOVE_REASONS: { value: MoveReason; label: string; types: ('in' | 'out' | 'adjust')[] }[] = [
  { value: 'compra', label: 'Compra / entrada de nota', types: ['in'] },
  { value: 'devolucao', label: 'Devolução de cliente', types: ['in'] },
  { value: 'perda_vencimento', label: 'Perda — vencimento', types: ['out'] },
  { value: 'perda_quebra', label: 'Perda — quebra ou avaria', types: ['out'] },
  { value: 'perda_preparo', label: 'Perda — preparo (queimou, errou)', types: ['out'] },
  { value: 'consumo_interno', label: 'Consumo interno (equipe)', types: ['out'] },
  { value: 'degustacao', label: 'Degustação / cortesia', types: ['out'] },
  { value: 'acerto_inventario', label: 'Acerto de inventário', types: ['adjust', 'in', 'out'] },
  { value: 'transferencia', label: 'Transferência', types: ['in', 'out'] },
];

export const REASON_LABEL: Record<string, string> = Object.fromEntries(
  MOVE_REASONS.map((r) => [r.value, r.label]),
);

/** Motivos que representam PERDA — o que o relatório soma como desperdício. */
export const LOSS_REASONS: MoveReason[] = ['perda_vencimento', 'perda_quebra', 'perda_preparo'];

export function reasonsFor(type: 'in' | 'out' | 'adjust') {
  return MOVE_REASONS.filter((r) => r.types.includes(type));
}

/** Origem do movimento, lida do prefixo do `ref` — é o que diz de onde a baixa veio. */
export const MOVE_ORIGINS: { value: string; label: string }[] = [
  { value: 'delivery', label: 'Delivery (iFood/99Food)' },
  { value: 'vendas', label: 'Vendas / PDV' },
  { value: 'marmitex', label: 'Marmitex' },
  { value: 'receipt', label: 'Entrada de mercadoria' },
  { value: 'count', label: 'Contagem de estoque' },
  { value: 'manual', label: 'Lançamento manual' },
  { value: 'order', label: 'Pedido de compra (antigo)' },
  { value: 'nfe', label: 'NF-e (antigo)' },
];

export const REPLENISH_TONE: Record<ReplenishStatus, { label: string; chip: string }> = {
  critico: { label: 'Crítico', chip: 'bg-rose-50 text-rose-700 ring-rose-200' },
  repor: { label: 'Repor', chip: 'bg-amber-50 text-amber-700 ring-amber-200' },
  ok: { label: 'OK', chip: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  sem_parametro: { label: 'Sem parâmetro', chip: 'bg-slate-100 text-slate-500 ring-slate-200' },
};

export const RECEIPT_TONE: Record<ReceiptStatus, { label: string; chip: string }> = {
  aguardando: { label: 'Aguardando nota', chip: 'bg-amber-50 text-amber-700 ring-amber-200' },
  conferida: { label: 'Conferida', chip: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  cancelada: { label: 'Cancelada', chip: 'bg-slate-100 text-slate-500 ring-slate-200' },
};

export const RECEIPT_SOURCE_LABEL: Record<string, string> = {
  pedido: 'Pedido de compra',
  nfe: 'NF-e',
  nota_ia: 'Nota do fornecedor (foto)',
  manual: 'Lançamento manual',
};

export const LINE_TONE: Record<ReceiptLineStatus, { label: string; chip: string }> = {
  ok: { label: 'Confere', chip: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  divergente: { label: 'Divergente', chip: 'bg-amber-50 text-amber-700 ring-amber-200' },
  pendente_vinculo: { label: 'Sem produto', chip: 'bg-rose-50 text-rose-700 ring-rose-200' },
  nao_veio: { label: 'Não veio', chip: 'bg-slate-100 text-slate-500 ring-slate-200' },
};
