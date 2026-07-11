import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { deliveryApi } from '../../../services/resources';
import { apiError } from '../../../services/api';
import { Spinner, ErrorBox } from '../../../components/ui';
import { RECEIPT_CSS, receiptHtml } from './receipt';

/**
 * Rota isolada de impressão da comanda de um pedido de delivery (térmica 80mm).
 * Espelha o padrão do Marmitex/LabelsPrint: busca o pedido, injeta o CSS de
 * impressão e dispara window.print() automaticamente. Serve p/ reimpressão manual.
 */
export function OrderReceipt() {
  const { id } = useParams();
  const orderId = Number(id);

  const { data, isLoading, error } = useQuery({
    queryKey: ['delivery-receipt', orderId],
    queryFn: () => deliveryApi.get(orderId),
    enabled: Number.isFinite(orderId),
  });

  // Dispara o diálogo de impressão assim que a comanda carrega.
  useEffect(() => {
    if (data) {
      const t = setTimeout(() => window.print(), 400);
      return () => clearTimeout(t);
    }
  }, [data]);

  if (isLoading) return <Spinner />;
  if (error) return <div className="p-8"><ErrorBox message={apiError(error)} /></div>;
  if (!data) return null;

  return (
    <div className="min-h-screen bg-slate-100">
      <style>{RECEIPT_CSS}</style>

      <div className="no-print flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-6 py-3">
        <p className="font-semibold text-slate-800">Comanda — {data.display_id ? `#${data.display_id}` : `#${data.id}`}</p>
        <button
          onClick={() => window.print()}
          className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
        >
          <Printer size={16} /> Imprimir
        </button>
      </div>

      <div className="py-4" dangerouslySetInnerHTML={{ __html: receiptHtml(data) }} />
    </div>
  );
}
