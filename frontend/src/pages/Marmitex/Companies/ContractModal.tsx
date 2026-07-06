import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { marmitexApi, MarmitexContractData } from '../../../services/resources';
import { apiError } from '../../../services/api';
import type { MarmitexCompany } from '../../../types';
import { Button, Input, Modal, Spinner, ErrorBox } from '../../../components/ui';

/**
 * Contrato da empresa: preço diferenciado por tamanho (vazio = preço do cardápio)
 * e itens do cardápio disponíveis/ocultos para ela.
 */
export function ContractModal({ company, onClose }: { company: MarmitexCompany; onClose: () => void }) {
  const [data, setData] = useState<MarmitexContractData | null>(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const load = useQuery({
    queryKey: ['marmitex-contract', company.id],
    queryFn: async () => {
      const d = await marmitexApi.contract.get(company.id);
      setData(d);
      return d;
    },
  });

  const save = useMutation({
    mutationFn: () => marmitexApi.contract.update(company.id, {
      prices: data!.sizes.map((s) => ({
        size_id: s.id,
        price: s.contract_price !== null && String(s.contract_price).trim() !== '' ? Number(String(s.contract_price).replace(',', '.')) : null,
      })),
      hidden: {
        sizes: data!.sizes.filter((x) => !x.enabled).map((x) => x.id),
        proteins: data!.proteins.filter((x) => !x.enabled).map((x) => x.id),
        sides: data!.sides.filter((x) => !x.enabled).map((x) => x.id),
        observations: data!.observations.filter((x) => !x.enabled).map((x) => x.id),
      },
    }),
    onSuccess: (d) => { setData(d); setMsg('Contrato salvo.'); setError(''); },
    onError: (e) => setError(apiError(e)),
  });

  const setSize = (id: number, patch: Partial<MarmitexContractData['sizes'][0]>) =>
    setData((d) => d && { ...d, sizes: d.sizes.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
  const toggleItem = (type: 'proteins' | 'sides' | 'observations', id: number) =>
    setData((d) => d && { ...d, [type]: d[type].map((x) => (x.id === id ? { ...x, enabled: !x.enabled } : x)) });

  return (
    <Modal title={`Contrato — ${company.name}`} onClose={onClose} size="xl">
      {load.isLoading && <Spinner />}
      {error && <div className="mb-3"><ErrorBox message={error} /></div>}
      {msg && <div className="mb-3 rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-700">{msg}</div>}

      {data && (
        <div className="space-y-4">
          <div>
            <h4 className="mb-2 text-sm font-semibold text-slate-600">Tamanhos e preços do contrato</h4>
            <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {data.sizes.map((s) => (
                <div key={s.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
                  <label className="flex min-w-0 flex-1 items-center gap-2">
                    <input type="checkbox" checked={s.enabled} onChange={() => setSize(s.id, { enabled: !s.enabled })} className="h-4 w-4 accent-emerald-600" />
                    <span className={`truncate font-medium ${s.enabled ? 'text-slate-800' : 'text-slate-400 line-through'}`}>{s.name}</span>
                  </label>
                  <span className="text-xs text-slate-400">cardápio R$ {s.base_price}</span>
                  <Input
                    value={s.contract_price ?? ''}
                    onChange={(e) => setSize(s.id, { contract_price: e.target.value })}
                    placeholder="preço contrato"
                    inputMode="decimal"
                    className="w-32"
                    disabled={!s.enabled}
                  />
                </div>
              ))}
            </div>
            <p className="mt-1 text-xs text-slate-400">Preço vazio = usa o do cardápio. Desmarcado = não aparece para a empresa.</p>
          </div>

          {(['proteins', 'sides', 'observations'] as const).map((type) => (
            <div key={type}>
              <h4 className="mb-2 text-sm font-semibold text-slate-600">
                {type === 'proteins' ? 'Proteínas' : type === 'sides' ? 'Acompanhamentos' : 'Observações'} disponíveis
              </h4>
              <div className="flex flex-wrap gap-x-4 gap-y-1.5 rounded-lg border border-slate-200 p-3">
                {data[type].length === 0 && <span className="text-sm text-slate-400">Nenhum cadastrado.</span>}
                {data[type].map((x) => (
                  <label key={x.id} className="flex items-center gap-1.5 text-sm text-slate-700">
                    <input type="checkbox" checked={x.enabled} onChange={() => toggleItem(type, x.id)} className="h-4 w-4 accent-emerald-600" />
                    <span className={x.enabled ? '' : 'text-slate-400 line-through'}>{x.name}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={onClose}>Fechar</Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending}>Salvar contrato</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
