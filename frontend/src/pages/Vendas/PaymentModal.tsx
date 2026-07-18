import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { vendasApi } from '../../services/resources';
import { apiError } from '../../services/api';
import { Button, Field, Input, Modal, ErrorBox } from '../../components/ui';
import { brl, parseNum } from '../../utils/format';
import { PaymentSplitEditor, splitIsValid, splitToPayments, type SplitLine } from './shared';

/** Recebe o pagamento de uma venda — uma forma só ou dividido (parte dinheiro, parte cartão...). */
export function PaymentModal({
  saleId, totalAmount, onClose, onPaid,
}: { saleId: number; totalAmount: number; onClose: () => void; onPaid?: () => void }) {
  const qc = useQueryClient();
  const [lines, setLines] = useState<SplitLine[]>([{ method: 'dinheiro', amount: String(totalAmount) }]);
  const [received, setReceived] = useState('');

  const single = lines.length <= 1;
  const receivedNum = parseNum(received);
  const change = single && lines[0]?.method === 'dinheiro' && receivedNum !== null
    ? receivedNum - totalAmount
    : null;

  const pay = useMutation({
    mutationFn: () => vendasApi.pay(saleId, splitToPayments(lines, totalAmount)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vendas-board'] });
      qc.invalidateQueries({ queryKey: ['vendas-stations'] });
      qc.invalidateQueries({ queryKey: ['vendas-sale', saleId] });
      onPaid?.();
      onClose();
    },
  });

  return (
    <Modal title="Receber pagamento" onClose={onClose}>
      <div className="space-y-4">
        {pay.error && <ErrorBox message={apiError(pay.error)} />}

        <div className="rounded-xl bg-slate-50 p-4 text-center">
          <p className="text-xs font-medium uppercase text-slate-500">Total a receber</p>
          <p className="text-3xl font-bold text-slate-800">{brl(totalAmount)}</p>
        </div>

        <Field label="Forma de pagamento">
          <PaymentSplitEditor total={totalAmount} lines={lines} onChange={setLines} disabled={pay.isPending} />
        </Field>

        {single && lines[0]?.method === 'dinheiro' && (
          <div className="grid grid-cols-2 items-end gap-3">
            <Field label="Valor recebido (opcional)">
              <Input
                inputMode="decimal"
                placeholder="0,00"
                value={received}
                onChange={(e) => setReceived(e.target.value)}
              />
            </Field>
            <div className="pb-1 text-sm">
              {change !== null && change >= 0 && (
                <p className="text-slate-600">Troco: <span className="text-lg font-semibold text-emerald-700">{brl(change)}</span></p>
              )}
              {change !== null && change < 0 && (
                <p className="font-medium text-red-600">Faltam {brl(-change)}</p>
              )}
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button
            type="button"
            disabled={pay.isPending || !splitIsValid(lines, totalAmount)}
            onClick={() => pay.mutate()}
          >
            Confirmar {brl(totalAmount)}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
