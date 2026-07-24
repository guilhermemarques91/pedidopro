import { ChangeEvent, useState } from 'react';
import { UploadCloud } from 'lucide-react';

// ~2MB cru: cabe no MEDIUMTEXT e evita payloads gigantes. O cardápio guarda a imagem
// nesse tamanho (qualidade para publicar no iFood); o cadastro reduz com `maxDim`.
const MAX_PHOTO_BYTES = 2 * 1024 * 1024;

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
  async function pick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // permite reenviar o mesmo arquivo
    if (!file) return;
    if (!file.type.startsWith('image/')) { setErr('Selecione uma imagem'); return; }
    if (file.size > MAX_PHOTO_BYTES) { setErr('Imagem muito grande (máx. 2MB)'); return; }
    try {
      setErr('');
      const raw = await readFileAsDataUrl(file);
      onChange(maxDim ? await resizeDataUrl(raw, maxDim) : raw);
    } catch { setErr('Falha ao ler a imagem'); }
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
      <div className="flex flex-col gap-1">
        <label className="cursor-pointer text-xs text-emerald-600 hover:underline">
          {value ? 'Trocar foto' : 'Enviar foto'}
          <input type="file" accept="image/*" className="hidden" onChange={pick} />
        </label>
        {value && (
          <button type="button" onClick={() => onChange(null)} className="text-left text-xs text-slate-400 hover:text-red-600">Remover</button>
        )}
        {err && <span className="text-xs text-red-600">{err}</span>}
      </div>
    </div>
  );
}
