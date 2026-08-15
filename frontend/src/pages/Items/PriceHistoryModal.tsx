import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid } from 'recharts';
import { itemsApi } from '../../services/resources';
import { apiError } from '../../services/api';
import { Modal, Card, Spinner, ErrorBox, EmptyState } from '../../components/ui';
import { brl, date } from '../../utils/format';

const COLORS = ['#059669', '#e11d48', '#2563eb', '#d97706', '#7c3aed', '#0891b2', '#be123c', '#4d7c0f'];

/**
 * Evolução de preço por fornecedor, a partir de price_history — que já era gravada a cada
 * cotação fechada, mas até agora ninguém lia. Um fornecedor por linha no gráfico deixa óbvio
 * quem subiu o preço e quando, sem precisar abrir cotação por cotação pra comparar.
 */
export function PriceHistoryModal({ itemId, itemName, onClose }: { itemId: number; itemName: string; onClose: () => void }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['item-price-history', itemId],
    queryFn: () => itemsApi.priceHistory(itemId),
  });

  const suppliers = useMemo(() => {
    const map = new Map<number, string>();
    for (const p of data?.points ?? []) map.set(p.supplier_id, p.supplier_name);
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [data]);

  const chartData = useMemo(() => {
    const points = data?.points ?? [];
    const dates = Array.from(new Set(points.map((p) => p.recorded_at))).sort();
    return dates.map((d) => {
      const row: Record<string, string | number | null> = { date: date(d), _iso: d };
      for (const s of suppliers) {
        const hit = points.find((p) => p.recorded_at === d && p.supplier_id === s.id);
        row[s.name] = hit ? Number(hit.price) : null;
      }
      return row;
    });
  }, [data, suppliers]);

  const sortedPoints = useMemo(
    () => [...(data?.points ?? [])].sort((a, b) => b.recorded_at.localeCompare(a.recorded_at)),
    [data],
  );

  return (
    <Modal title={`Histórico de preço — ${data?.product_name ?? itemName}`} onClose={onClose} size="wide">
      {isLoading && <Spinner />}
      {error && <ErrorBox message={apiError(error)} />}
      {data && data.points.length === 0 && (
        <EmptyState message="Nenhum preço registrado ainda — o histórico se acumula a cada cotação fechada." />
      )}
      {data && data.points.length > 0 && (
        <div className="space-y-4">
          {suppliers.length > 1 && chartData.length > 1 && (
            <Card>
              <ResponsiveContainer width="100%" height={240}>
                <LineChart data={chartData} margin={{ left: 0, right: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => brl(v)} width={70} />
                  <Tooltip formatter={(v: number) => brl(v)} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {suppliers.map((s, i) => (
                    <Line
                      key={s.id}
                      type="monotone"
                      dataKey={s.name}
                      stroke={COLORS[i % COLORS.length]}
                      strokeWidth={2}
                      dot
                      connectNulls
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </Card>
          )}

          <Card className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Data</th>
                  <th className="px-4 py-2.5 font-semibold">Fornecedor</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Preço</th>
                </tr>
              </thead>
              <tbody>
                {sortedPoints.map((p, i) => (
                  <tr key={i} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-2 text-slate-500">{date(p.recorded_at)}</td>
                    <td className="px-4 py-2 text-slate-800">{p.supplier_name}</td>
                    <td className="px-4 py-2 text-right font-medium text-slate-800">{brl(p.price)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}
    </Modal>
  );
}
