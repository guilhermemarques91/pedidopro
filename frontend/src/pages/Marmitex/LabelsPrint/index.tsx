import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { Printer } from 'lucide-react';
import { marmitexApi } from '../../../services/resources';
import { apiError } from '../../../services/api';
import { Spinner, ErrorBox } from '../../../components/ui';
import { parseSides, proteinLabel } from '../../../utils/format';

/**
 * Etiquetas Pimaco 6080 (= Avery 5160), medidas do gabarito do fabricante:
 *
 *   papel Carta ............ 215,9 × 279,4 mm
 *   margem superior ........  12,7 mm      margem lateral ....... 4,8 mm
 *   etiqueta ...............  66,7 × 25,4 mm
 *   densidade horizontal ...  69,8 mm      densidade vertical ... 25,4 mm
 *   3 colunas × 10 linhas = 30 por folha
 *
 * "Densidade" é a distância de uma etiqueta à SEGUINTE, não a largura dela — a
 * diferença (69,8 − 66,7 = 3,1 mm) é o vão entre colunas. Tratar densidade como
 * largura desalinha 3,1 mm na 2ª coluna e 6,2 mm na 3ª, que foi o que aconteceu.
 * Na vertical densidade = altura, então as linhas se tocam (vão zero).
 *
 * Conferência: 4,8 + 69,8 + 69,8 + 66,7 + 4,8 = 215,9 ✓
 *              12,7 + (25,4 × 10) + 12,7 = 279,4 ✓
 *
 * Cada folha é um container próprio de 279,4 mm com a margem superior dentro dele —
 * senão a margem valeria só na 1ª página e a partir da 31ª etiqueta tudo subiria.
 */
const LABELS_PER_PAGE = 30;

const PRINT_CSS = `
@page { size: 215.9mm 279.4mm; margin: 0; }

.labels-page {
  width: 215.9mm;
  height: 279.4mm;
  box-sizing: border-box;
  padding: 12.7mm 4.8mm;
  display: grid;
  grid-template-columns: repeat(3, 66.7mm);
  grid-auto-rows: 25.4mm;
  column-gap: 3.1mm;
  row-gap: 0;
  background: #fff;
}
.labels-page .label {
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
.labels-page .label .name { font-weight: 700; font-size: 10pt; }
.labels-page .label .line { color: #222; }
.labels-page .label .obs { font-style: italic; color: #444; }

/* Na tela: contorno tracejado para conferir o alinhamento antes de gastar folha. */
@media screen {
  .labels-page { margin: 16px auto; box-shadow: 0 1px 3px rgba(0,0,0,.2); }
  .labels-page .label { outline: 1px dashed #cbd5e1; outline-offset: -1px; }
}

@media print {
  .no-print { display: none !important; }
  html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
  .labels-page { margin: 0; box-shadow: none; break-after: page; }
  .labels-page:last-child { break-after: auto; }
}
`;

/** Quebra a lista em folhas de 30 (3 × 10). */
function paginate<T>(items: T[], perPage: number): T[][] {
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += perPage) {
    pages.push(items.slice(i, i + perPage));
  }
  return pages;
}

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
  // Com ?conferir=1 a folha abre sem o diálogo, para checar o alinhamento na tela
  // (o diálogo aberto tapa a página e impede a conferência antes de gastar folha).
  const conferir = params.get('conferir') === '1';
  useEffect(() => {
    if (data && data.marmitas.length && !conferir) {
      const t = setTimeout(() => window.print(), 400);
      return () => clearTimeout(t);
    }
  }, [data, conferir]);

  if (!dateParam) return <div className="p-8"><ErrorBox message="Informe a data na URL (?date=AAAA-MM-DD)." /></div>;
  if (isLoading) return <Spinner />;
  if (error) return <div className="p-8"><ErrorBox message={apiError(error)} /></div>;
  if (!data) return null;

  const pages = paginate(data.marmitas, LABELS_PER_PAGE);

  return (
    <div className="min-h-screen bg-slate-100">
      <style>{PRINT_CSS}</style>

      <div className="no-print flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-6 py-3">
        <div>
          <p className="font-semibold text-slate-800">Etiquetas — {data.company?.name}</p>
          <p className="text-xs text-slate-500">
            {data.date} · {data.marmitas.length} etiqueta(s) · {pages.length} folha(s) Pimaco 6080
          </p>
        </div>
        <button onClick={() => window.print()} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700">
          <Printer size={16} /> Imprimir
        </button>
      </div>

      <p className="no-print px-6 pt-3 text-xs text-slate-500">
        No diálogo de impressão: papel <b>Carta</b>, margens <b>Nenhuma</b> e escala <b>100%</b> (não use
        "Ajustar à página" — ela encolhe tudo e desalinha). O tracejado é só da tela, não sai impresso.
      </p>

      {data.marmitas.length === 0 ? (
        <div className="p-8"><ErrorBox message="Nenhuma marmita nesta data." /></div>
      ) : (
        pages.map((page, pageIndex) => (
          <div key={pageIndex} className="labels-page">
            {page.map((m) => {
              const sides = parseSides(m.sides_json).map((s) => s.name).join(', ');
              return (
                <div key={m.id} className="label">
                  {m.person_name && <div className="name">{m.person_name}</div>}
                  <div className="line">
                    {[m.size_name, proteinLabel(m.protein_name, m.protein2_name)].filter(Boolean).join(' · ')}
                  </div>
                  {sides && <div className="line">{sides}</div>}
                  {m.observation && <div className="obs">{m.observation}</div>}
                </div>
              );
            })}
          </div>
        ))
      )}
    </div>
  );
}
