import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { Printer } from 'lucide-react';
import { marmitexApi } from '../../../services/resources';
import { apiError } from '../../../services/api';
import { Spinner, ErrorBox } from '../../../components/ui';

/**
 * Impressão direta de etiquetas Pimaco 6080 (= Avery 5160): Carta, 3 colunas × 10
 * linhas (30 etiquetas/folha), cada uma 66,7mm × 25,4mm. Sem PDF — usa window.print().
 * As margens podem variar por impressora; ajuste o @page após um teste real.
 */
const PRINT_CSS = `
@page { size: letter; margin: 0; }
@media print {
  .no-print { display: none !important; }
  html, body { margin: 0 !important; background: #fff !important; }
}
.labels-sheet {
  width: 215.9mm;
  box-sizing: border-box;
  padding: 12.7mm 4.8mm;
  margin: 0 auto;
  display: grid;
  grid-template-columns: repeat(3, 66.7mm);
  grid-auto-rows: 25.4mm;
  column-gap: 0;
  row-gap: 0;
}
.labels-sheet .label {
  width: 66.7mm;
  height: 25.4mm;
  box-sizing: border-box;
  padding: 2mm 3mm;
  overflow: hidden;
  font-size: 9pt;
  line-height: 1.18;
  break-inside: avoid;
  display: flex;
  flex-direction: column;
  justify-content: center;
}
.labels-sheet .label .name { font-weight: 700; font-size: 10pt; }
.labels-sheet .label .line { color: #222; }
.labels-sheet .label .obs { font-style: italic; color: #444; }
`;

export function LabelsPrint() {
  const [params] = useSearchParams();
  const dateParam = params.get('date') ?? '';
  const companyId = params.get('company_id');

  const { data, isLoading, error } = useQuery({
    queryKey: ['marmitex-labels', companyId, dateParam],
    queryFn: () => marmitexApi.labels({ date: dateParam, company_id: companyId ? Number(companyId) : undefined }),
    enabled: !!dateParam,
  });

  // Dispara o diálogo de impressão automaticamente assim que as etiquetas carregam.
  useEffect(() => {
    if (data && data.marmitas.length) {
      const t = setTimeout(() => window.print(), 400);
      return () => clearTimeout(t);
    }
  }, [data]);

  if (!dateParam) return <div className="p-8"><ErrorBox message="Informe a data na URL (?date=AAAA-MM-DD)." /></div>;
  if (isLoading) return <Spinner />;
  if (error) return <div className="p-8"><ErrorBox message={apiError(error)} /></div>;
  if (!data) return null;

  return (
    <div className="bg-slate-100 min-h-screen">
      <style>{PRINT_CSS}</style>

      <div className="no-print flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-6 py-3">
        <div>
          <p className="font-semibold text-slate-800">Etiquetas — {data.company?.name}</p>
          <p className="text-xs text-slate-500">{data.date} · {data.marmitas.length} etiqueta(s)</p>
        </div>
        <button onClick={() => window.print()} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700">
          <Printer size={16} /> Imprimir
        </button>
      </div>

      {data.marmitas.length === 0 ? (
        <div className="p-8"><ErrorBox message="Nenhuma marmita nesta data." /></div>
      ) : (
        <div className="labels-sheet bg-white">
          {data.marmitas.map((m) => {
            const sides = (m.sides_json ?? []).map((s) => s.name).join(', ');
            return (
              <div key={m.id} className="label">
                {m.person_name && <div className="name">{m.person_name}</div>}
                <div className="line">{m.size_name}{m.protein_name ? ` · ${m.protein_name}` : ''}</div>
                {sides && <div className="line">{sides}</div>}
                {m.observation && <div className="obs">{m.observation}</div>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
