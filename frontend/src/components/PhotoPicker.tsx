import { ChangeEvent, useState } from 'react';
import { UploadCloud } from 'lucide-react';

// Limite de ARMAZENAMENTO cru (~2MB): vale quando a imagem vai para o banco como veio
// (cardápio — qualidade para publicar no iFood). Cabe no MEDIUMTEXT.
const MAX_RAW_BYTES = 2 * 1024 * 1024;
// Limite de ENTRADA quando vamos redimensionar (`maxDim`): aqui o tamanho do arquivo
// original não importa — ele é reduzido para uns 60KB antes de sair daqui. Foto de
// celular tem 3–8MB e era barrada por engano pelo limite de 2MB. Este teto existe só
// para não estourar a memória do navegador com um arquivo absurdo.
const MAX_INPUT_BYTES = 25 * 1024 * 1024;

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('Falha ao ler a imagem'));
    r.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Imagem inválida'));
    img.src = src;
  });
}

// Reduz a imagem para caber em `maxDim` (lado maior) e re-encoda em JPEG. Mantém os
// thumbnails do cadastro leves (~40–80KB) para trafegarem inline na lista e no PDV
// sem endpoint de imagem dedicado.
async function resizeDataUrl(dataUrl: string, maxDim: number, quality = 0.72): Promise<string> {
  const img = await loadImage(dataUrl);
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return dataUrl; // sem canvas: guarda o original
  // Fundo BRANCO antes de desenhar: o canvas nasce transparente e o JPEG não tem canal
  // alpha, então área transparente (PNG de catálogo) sairia PRETA. Pinta de branco para
  // a foto ficar como o usuário espera.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', quality);
}

/**
 * Seletor de foto: preview + enviar + remover. Guarda a imagem como data URL (base64).
 * Com `maxDim` definido, reduz a imagem antes de devolver (thumbnails leves p/ o cadastro);
 * sem ele, devolve a imagem crua (cardápio → qualidade para publicar na plataforma).
 */
export function PhotoPicker({
  value, onChange, size = 64, label = 'Foto', maxDim,
}: {
  value: string | null;
  onChange: (dataUrl: string | null) => void;
  size?: number;
  label?: string;
  maxDim?: number;
}) {
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  async function pick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // permite reenviar o mesmo arquivo
    if (!file) return;
    if (!file.type.startsWith('image/')) { setErr('Selecione uma imagem'); return; }
    // Só limita o arquivo de ENTRADA quando ele vai ser guardado como veio. Com `maxDim`
    // a imagem é reduzida aqui mesmo, então foto de celular (3–8MB) é bem-vinda.
    const limit = maxDim ? MAX_INPUT_BYTES : MAX_RAW_BYTES;
    if (file.size > limit) {
      setErr(`Imagem muito grande (máx. ${Math.round(limit / 1024 / 1024)}MB)`);
      return;
    }
    try {
      setErr('');
      setBusy(true);
      const raw = await readFileAsDataUrl(file);
      onChange(maxDim ? await resizeDataUrl(raw, maxDim) : raw);
    } catch { setErr('Falha ao ler a imagem'); }
    finally { setBusy(false); }
  }
  return (
    <div className="flex items-center gap-2">
      {value ? (
        <img src={value} alt={label} className="rounded border border-slate-200 object-cover" style={{ width: size, height: size }} />
      ) : (
        <div className="flex items-center justify-center rounded border border-dashed border-slate-300 text-slate-300" style={{ width: size, height: size }}>
          <UploadCloud size={Math.round(size / 3)} />
        </div>
      )}
      <div className="flex flex-col items-start gap-1">
        {/* `sr-only` em vez de `hidden`: display:none tiraria o input da ordem de tabulação
            e quem navega por teclado não conseguiria enviar foto. Assim ele segue focável
            e o anel aparece no label via focus-within. */}
        <label className="inline-flex cursor-pointer items-center rounded px-1 py-1 text-xs text-emerald-700 hover:underline focus-within:ring-2 focus-within:ring-emerald-500">
          {busy ? 'Processando…' : value ? 'Trocar foto' : 'Enviar foto'}
          <input type="file" accept="image/*" className="sr-only" onChange={pick} disabled={busy} />
        </label>
        {value && !busy && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="rounded px-1 py-1 text-left text-xs text-slate-500 hover:text-red-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
          >
            Remover
          </button>
        )}
        {err && <span role="alert" className="text-xs text-red-600">{err}</span>}
      </div>
    </div>
  );
}
