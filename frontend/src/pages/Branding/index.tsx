import { FormEvent, useEffect, useState } from 'react';
import { api, apiError } from '../../services/api';
import { useBrand, Branding } from '../../store/brand.store';
import { DEFAULT_APP_NAME, DEFAULT_TAGLINE } from '../../config/brand';
import { PageHeader } from '../../components/PageHeader';
import { Button, Card, Field, Input, ErrorBox } from '../../components/ui';

const DEFAULT_COLOR = '#059669'; // emerald-600 (padrão do sistema)

/** Personalização do sistema: nome, slogan, logo e cor primária. */
export function BrandingPage() {
  const brand = useBrand();
  const [name, setName] = useState('');
  const [tagline, setTagline] = useState('');
  const [logo, setLogo] = useState<string | null>(null);
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  // Preenche com o que está salvo.
  useEffect(() => {
    setName(brand.brand_name ?? '');
    setTagline(brand.tagline ?? '');
    setLogo(brand.logo);
    setColor(brand.primary_color ?? DEFAULT_COLOR);
  }, [brand.loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  function pickLogo(file: File | undefined) {
    setError('');
    if (!file) return;
    if (file.size > 200_000) { setError('Imagem muito grande (máx. 200 KB). Reduza antes de enviar.'); return; }
    const reader = new FileReader();
    reader.onload = () => setLogo(String(reader.result));
    reader.readAsDataURL(file);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(''); setMsg(''); setSaving(true);
    try {
      const body: Partial<Branding> = {
        brand_name: name.trim() || null,
        tagline: tagline.trim() || null,
        logo,
        primary_color: color.toLowerCase() === DEFAULT_COLOR ? null : color,
      };
      const { data } = await api.put<Branding>('/settings/branding', body);
      useBrand.getState().apply(data);
      setMsg('Personalização salva.');
    } catch (err) {
      setError(apiError(err, 'Falha ao salvar'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader title="Personalização" subtitle="Logo, nome e cores do sistema" />
      <Card className="max-w-xl">
        <form onSubmit={submit} className="space-y-4">
          {error && <ErrorBox message={error} />}
          {msg && <div className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{msg}</div>}

          <Field label="Nome do sistema">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={DEFAULT_APP_NAME} />
          </Field>
          <Field label="Slogan (subtítulo do login)">
            <Input value={tagline} onChange={(e) => setTagline(e.target.value)} placeholder={DEFAULT_TAGLINE} />
          </Field>

          <div>
            <span className="mb-1 block text-sm font-medium text-slate-700">Logo (PNG/JPG/SVG, máx. 200 KB)</span>
            <div className="flex items-center gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-lg border border-slate-200 bg-slate-50">
                {logo ? <img src={logo} className="max-h-14 max-w-14 object-contain" alt="Logo" /> : <span className="text-xs text-slate-400">padrão</span>}
              </div>
              <div className="space-y-1">
                <input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp"
                  onChange={(e) => pickLogo(e.target.files?.[0])}
                  className="block text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-200 file:px-3 file:py-1.5 file:text-sm file:font-medium" />
                {logo && <button type="button" onClick={() => setLogo(null)} className="text-xs text-red-600 hover:underline">Remover logo (voltar ao padrão)</button>}
              </div>
            </div>
          </div>

          <div>
            <span className="mb-1 block text-sm font-medium text-slate-700">Cor primária</span>
            <div className="flex items-center gap-3">
              <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-10 w-16 cursor-pointer rounded border border-slate-300" />
              <span className="text-sm text-slate-500">{color}</span>
              <button type="button" onClick={() => setColor(DEFAULT_COLOR)} className="text-xs text-slate-500 hover:underline">Restaurar padrão</button>
            </div>
            <p className="mt-1 text-xs text-slate-400">Aplicada em botões, links, menu ativo e destaques.</p>
          </div>

          <div className="flex justify-end pt-2">
            <Button type="submit" disabled={saving}>{saving ? 'Salvando…' : 'Salvar'}</Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
