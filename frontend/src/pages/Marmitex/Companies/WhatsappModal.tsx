import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Plus, Trash2, Send } from 'lucide-react';
import { marmitexApi } from '../../../services/resources';
import { apiError } from '../../../services/api';
import type { MarmitexCompany, MarmitexWaConfig } from '../../../types';
import { Button, Field, Input, Select, Textarea, Modal, Spinner, ErrorBox } from '../../../components/ui';

type AliasType = 'sizes' | 'proteins' | 'sides' | 'notes';
const ALIAS_LABEL: Record<AliasType, string> = {
  sizes: 'Tamanhos',
  proteins: 'Proteínas',
  sides: 'Acompanhamentos',
  notes: 'Recados de cozinha (texto livre)',
};
const ALIAS_HINT: Partial<Record<AliasType, string>> = {
  notes: 'Abreviação que não é item cobrado e sim instrução — ex.: "(P)" → "Porção pequena". Vai para a observação da marmita, e não sobra no nome da pessoa.',
};

/** Linhas editáveis do dicionário: o objeto {de: para} não sobrevive à digitação. */
type AliasRow = { key: string; from: string; to: string };
let rowSeq = 1;

function toRows(map: Record<string, string>): AliasRow[] {
  return Object.entries(map).map(([from, to]) => ({ key: `a${rowSeq++}`, from, to }));
}
function toMap(rows: AliasRow[]): Record<string, string> {
  const out: Record<string, string> = {};
  rows.forEach((r) => { if (r.from.trim() && r.to.trim()) out[r.from.trim()] = r.to.trim(); });
  return out;
}

/**
 * Leitura do grupo de WhatsApp da empresa.
 *
 * O dicionário de apelidos é o que mais mexe na qualidade da leitura: com "G" →
 * "Grande" e "frango" → "Frango Grelhado" cadastrados, a mensagem é entendida por
 * regra fixa e a IA nem entra na conversa.
 */
export function WhatsappModal({ company, onClose }: { company: MarmitexCompany; onClose: () => void }) {
  const [cfg, setCfg] = useState<MarmitexWaConfig | null>(null);
  const [aliases, setAliases] = useState<Record<AliasType, AliasRow[]>>({ sizes: [], proteins: [], sides: [], notes: [] });
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [testText, setTestText] = useState('');

  const load = useQuery({ queryKey: ['marmitex-wa-config', company.id], queryFn: () => marmitexApi.whatsapp.config(company.id) });
  const catalog = useQuery({ queryKey: ['marmitex-catalog', company.id], queryFn: () => marmitexApi.catalog(company.id) });

  useEffect(() => {
    if (!load.data) return;
    setCfg(load.data);
    setAliases({
      sizes: toRows(load.data.aliases?.sizes ?? {}),
      proteins: toRows(load.data.aliases?.proteins ?? {}),
      sides: toRows(load.data.aliases?.sides ?? {}),
      notes: toRows(load.data.aliases?.notes ?? {}),
    });
  }, [load.data]);

  const save = useMutation({
    mutationFn: () => marmitexApi.whatsapp.saveConfig(company.id, {
      ...cfg!,
      aliases: {
        sizes: toMap(aliases.sizes),
        proteins: toMap(aliases.proteins),
        sides: toMap(aliases.sides),
        notes: toMap(aliases.notes),
      },
    }),
    onSuccess: (d) => { setCfg(d); setMsg('Configuração salva.'); setError(''); },
    onError: (e) => { setMsg(''); setError(apiError(e)); },
  });

  const simulate = useMutation({
    mutationFn: () => marmitexApi.whatsapp.simulate(company.id, testText),
    onSuccess: () => {
      setError('');
      setMsg('Mensagem enfileirada. A leitura roda no worker (até ~1 min) — veja o resultado em WhatsApp (revisão).');
    },
    onError: (e) => { setMsg(''); setError(apiError(e)); },
  });

  const set = <K extends keyof MarmitexWaConfig>(key: K, value: MarmitexWaConfig[K]) =>
    setCfg((c) => c && { ...c, [key]: value });

  const addAlias = (type: AliasType) =>
    setAliases((a) => ({ ...a, [type]: [...a[type], { key: `a${rowSeq++}`, from: '', to: '' }] }));
  const setAlias = (type: AliasType, key: string, patch: Partial<AliasRow>) =>
    setAliases((a) => ({ ...a, [type]: a[type].map((r) => (r.key === key ? { ...r, ...patch } : r)) }));
  const removeAlias = (type: AliasType, key: string) =>
    setAliases((a) => ({ ...a, [type]: a[type].filter((r) => r.key !== key) }));

  const options = (type: AliasType) => {
    const list = type === 'sizes' ? catalog.data?.sizes
      : type === 'proteins' ? catalog.data?.proteins
      : type === 'sides' ? catalog.data?.sides
      : [];
    return (list ?? []).filter((x) => x.active);
  };

  return (
    <Modal title={`WhatsApp — ${company.name}`} onClose={onClose} size="xl">
      {load.isLoading && <Spinner />}
      {error && <div className="mb-3"><ErrorBox message={error} /></div>}
      {msg && <div className="mb-3 rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-700">{msg}</div>}

      {cfg && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="ID do grupo (termina em @g.us)">
              <Input
                value={cfg.group_jid}
                placeholder="120363000000000000@g.us"
                onChange={(e) => set('group_jid', e.target.value)}
              />
            </Field>
            <Field label="Como a empresa manda o pedido">
              <Select value={cfg.mode} onChange={(e) => set('mode', e.target.value as MarmitexWaConfig['mode'])}>
                <option value="incremental">Uma mensagem por pessoa, ao longo da manhã</option>
                <option value="list">A lista inteira de uma vez</option>
              </Select>
            </Field>
          </div>
          <p className="-mt-3 text-xs text-slate-400">
            O ID do grupo aparece no gerenciador da Evolution API (campo <code>remoteJid</code> das mensagens do grupo).
          </p>

          <div className="space-y-2 rounded-lg border border-slate-200 p-3">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={!!cfg.enabled} onChange={(e) => set('enabled', e.target.checked)} />
              Ler os pedidos deste grupo
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={!!cfg.auto_apply} onChange={(e) => set('auto_apply', e.target.checked)} />
              Gravar o pedido do dia automaticamente <span className="text-slate-400">— só quando entender 100% das linhas</span>
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={!!cfg.auto_apply_after_cutoff}
                onChange={(e) => set('auto_apply_after_cutoff', e.target.checked)}
              />
              Gravar automaticamente também depois do horário de corte
            </label>
            {cfg.mode === 'list' && (
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={!!cfg.list_replaces} onChange={(e) => set('list_replaces', e.target.checked)} />
                Reenviar a lista <b>substitui</b> a anterior (em vez de somar)
              </label>
            )}
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={!!cfg.confirm_reply} onChange={(e) => set('confirm_reply', e.target.checked)} />
              Responder no grupo confirmando o pedido registrado
            </label>
          </div>

          <Field label="Tamanho padrão (quando a pessoa só disser a proteína)">
            <Select
              value={cfg.default_size_id ?? ''}
              onChange={(e) => set('default_size_id', e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">Sem padrão — linha sem tamanho vai para revisão</option>
              {options('sizes').map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Field>

          <div>
            <h4 className="text-sm font-semibold text-slate-700">Itens sem dono</h4>
            <p className="mb-2 text-xs text-slate-500">
              O que a empresa pede para o grupo, e não para uma pessoa — refrigerante, sobremesa
              compartilhada. Toda marmita precisa de nome, mas estes não: a etiqueta sai no nome da
              empresa em vez de segurar o pedido do dia na revisão.
            </p>
            <div className="flex flex-wrap gap-2 rounded-lg border border-slate-200 p-3">
              {options('sizes').map((s) => {
                const on = (cfg.ownerless_size_ids ?? []).includes(s.id);
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => set(
                      'ownerless_size_ids',
                      on
                        ? (cfg.ownerless_size_ids ?? []).filter((id) => id !== s.id)
                        : [...(cfg.ownerless_size_ids ?? []), s.id],
                    )}
                    className={`rounded-full border px-3 py-1 text-sm transition ${
                      on ? 'border-emerald-600 bg-emerald-50 text-emerald-700' : 'border-slate-300 text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {s.name}
                  </button>
                );
              })}
              {options('sizes').length === 0 && <p className="text-xs text-slate-400">Cardápio desta empresa sem itens.</p>}
            </div>
          </div>

          <div>
            <h4 className="text-sm font-semibold text-slate-700">Como esta empresa escreve</h4>
            <p className="mb-2 text-xs text-slate-500">
              Traduza as abreviações do grupo para os itens do cardápio. É o que faz “João - G frango” ser entendido sem IA.
            </p>
            <div className="space-y-3">
              {(Object.keys(ALIAS_LABEL) as AliasType[]).map((type) => (
                <div key={type} className="rounded-lg border border-slate-200 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-sm font-medium text-slate-600">{ALIAS_LABEL[type]}</span>
                    <Button variant="secondary" onClick={() => addAlias(type)}><Plus size={14} /> Apelido</Button>
                  </div>
                  {ALIAS_HINT[type] && <p className="mb-2 text-xs text-slate-500">{ALIAS_HINT[type]}</p>}
                  {aliases[type].length === 0 && <p className="text-xs text-slate-400">Nenhum apelido cadastrado.</p>}
                  <div className="space-y-2">
                    {aliases[type].map((row) => (
                      <div key={row.key} className="flex items-center gap-2">
                        <Input
                          value={row.from}
                          placeholder="como escrevem (ex.: G)"
                          className="flex-1"
                          onChange={(e) => setAlias(type, row.key, { from: e.target.value })}
                        />
                        <span className="text-slate-400">→</span>
                        {type === 'notes' ? (
                          <Input
                            value={row.to}
                            placeholder="o que anotar (ex.: Porção pequena)"
                            className="flex-1"
                            onChange={(e) => setAlias(type, row.key, { to: e.target.value })}
                          />
                        ) : (
                          <Select
                            value={row.to}
                            className="flex-1"
                            onChange={(e) => setAlias(type, row.key, { to: e.target.value })}
                          >
                            <option value="">Selecione o item…</option>
                            {/* Apelido que aponta para item renomeado/desativado: sem esta
                                opção o select viria vazio e salvar apagaria a regra sem avisar. */}
                            {row.to && !options(type).some((o) => o.name === row.to) && (
                              <option value={row.to}>{row.to} (fora do cardápio)</option>
                            )}
                            {options(type).map((o) => <option key={o.id} value={o.name}>{o.name}</option>)}
                          </Select>
                        )}
                        <button onClick={() => removeAlias(type, row.key)} className="text-slate-400 hover:text-red-600">
                          <Trash2 size={16} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <Field label="Instruções extras para a IA (opcional)">
            <Textarea
              rows={3}
              value={cfg.ai_instructions ?? ''}
              placeholder="ex.: quando não disserem a proteína, é sempre a do dia; ignorar mensagens do supervisor."
              onChange={(e) => set('ai_instructions', e.target.value)}
            />
          </Field>

          <div className="rounded-lg border border-slate-200 p-3">
            <h4 className="mb-2 text-sm font-semibold text-slate-700">Testar uma mensagem</h4>
            <Textarea
              rows={3}
              value={testText}
              placeholder={'João - G frango\nMaria - P bife'}
              onChange={(e) => setTestText(e.target.value)}
            />
            <div className="mt-2 flex justify-end">
              <Button variant="secondary" onClick={() => simulate.mutate()} disabled={!testText.trim() || simulate.isPending}>
                <Send size={14} /> {simulate.isPending ? 'Enfileirando…' : 'Testar leitura'}
              </Button>
            </div>
          </div>

          {cfg.last_sweep_at && (
            <p className="text-xs text-slate-400">Última varredura do grupo: {cfg.last_sweep_at}</p>
          )}

          <div className="flex justify-end gap-2 border-t border-slate-100 pt-3">
            <Button type="button" variant="secondary" onClick={onClose}>Fechar</Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending ? 'Salvando…' : 'Salvar'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
