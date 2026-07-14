import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { vendasApi } from '../../services/resources';
import { apiError } from '../../services/api';
import type { PaymentMethod } from '../../types';
import { Button, Field, Select, Modal, ErrorBox } from '../../components/ui';
import { brl } from '../../utils/format';

const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'dinheiro', label: 'Dinheiro' },
  { value: 'debito', label: 'Cartão de débito' },
  { value: 'credito', label: 'Cartão de crédito' },
  { value: 'pix', label: 'Pix' },
  { value: 'outro', label: 'Outro' },
];

/** Recebe o pagamento de uma venda (retirada, ou mesa/comanda no fechamento da conta). */
export function PaymentModal({
  saleId, totalAmount, onClose,
}: { saleId: number; totalAmount: number; onClose: () => void }) {
  const qc = useQueryClient();
  const [method, setMethod] = useState<PaymentMethod>('dinheiro');

  const pay = useMutation({
    mutationFn: () => vendasApi.pay(saleId, method),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['vendas-board'] }); onClose(); },
  });

  return (
    <Modal title="Receber pagamento" onClose={onClose}>
      <div className="space-y-4">
        {pay.error && <ErrorBox message={apiError(pay.error)} />}
        <p className="text-sm text-slate-600">
          Total a receber: <span className="text-lg font-semibold text-slate-800">{brl(totalAmount)}</span>
        </p>
        <Field label="Forma de pagamento">
          <Select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
            {METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </Select>
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="button" disabled={pay.isPending} onClick={() => pay.mutate()}>Confirmar recebimento</Button>
        </div>
      </div>
    </Modal>
  );
}
