import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Plug, CheckCircle2, XCircle } from 'lucide-react';
import { channelsApi, ChannelInput } from '../../services/resources';
import { apiError } from '../../services/api';
import type { Channel, DeliveryPlatform } from '../../types';
import { PageHeader } from '../../components/PageHeader';
import { Button, Card, Field, Input, Select, Modal, Spinner, ErrorBox, EmptyState } from '../../components/ui';

const PLATFORMS: { value: DeliveryPlatform; label: string }[] = [
  { value: 'ifood', label: 'iFood' },
  { value: '99food', label: '99Food' },
];

export function Integrations() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Channel | null>(null);
  const [creating, setCreating] = useState(false);
  type TestInfo = { authenticated: boolean; error?: string; merchants?: { id: string; name: string }[] };
  const [testResult, setTestResult] = useState<Record<number, TestInfo>>({});

  const { data, isLoading, error } = useQuery({ queryKey: ['channels'], queryFn: channelsApi.list });
  const test = useMutation({
    mutationFn: (id: number) => channelsApi.test(id),
    onSuccess: (r, id) => setTestResult((prev) => ({ ...prev, [id]: { authenticated: r.authenticated, error: r.error, merchants: r.merchants } })),
  });

  return (
    <div>
      <PageHeader
        title="Integrações"
        subtitle="Canais de delivery — credenciais e webhooks (iFood, 99Food)"
        action={<Button onClick={() => setCreating(true)}><Plus size={16} /> Novo canal</Button>}
      />

      {isLoading && <Spinner />}
      {error && <ErrorBox message={apiError(error)} />}

      {data && (data.length === 0 ? (
        <EmptyState message="Nenhum canal configurado. Cadastre o iFood e o 99Food para começar a receber pedidos." />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {data.map((c) => (
            <Card key={c.id}>
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-semibold text-slate-800">{c.name}</p>
                  <p className="text-xs uppercase text-slate-400">{c.platform}</p>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${c.active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                  {c.active ? 'Ativo' : 'Inativo'}
                </span>
              </div>
              <dl className="mt-3 space-y-1 text-sm text-slate-600">
                <div className="flex justify-between"><dt className="text-slate-400">Merchant ID</dt><dd>{c.merchant_id ?? '—'}</dd></div>
                <div className="flex justify-between"><dt className="text-slate-400">Client ID</dt><dd className="truncate">{c.client_id ?? '—'}</dd></div>
                <div className="flex justify-between"><dt className="text-slate-400">Client secret</dt><dd>{c.has_client_secret ? '••••••' : '—'}</dd></div>
                <div className="flex justify-between"><dt className="text-slate-400">Webhook secret</dt><dd>{c.webhook_secret ? '••••••' : '—'}</dd></div>
              </dl>
              <div className="mt-4 flex items-center gap-2">
                <Button variant="secondary" className="text-xs" onClick={() => setEditing(c)}>Editar</Button>
                <Button variant="ghost" className="text-xs" disabled={test.isPending} onClick={() => test.mutate(c.id)}>
                  <Plug size={14} /> Testar conexão
                </Button>
                {c.id in testResult && (testResult[c.id].authenticated
                  ? <CheckCircle2 size={18} className="text-emerald-600" />
                  : <XCircle size={18} className="text-red-600" />)}
              </div>
              {c.id in testResult && (
                <div className="mt-3 rounded-lg bg-slate-50 p-3 text-xs">
                  {testResult[c.id].authenticated ? (
                    <>
                      <p className="font-medium text-emerald-700">Autenticado ✓</p>
                      {testResult[c.id].merchants && testResult[c.id].merchants!.length > 0 ? (
                        <ul className="mt-1 space-y-1">
                          {testResult[c.id].merchants!.map((m) => (
                            <li key={m.id} className="flex justify-between gap-2">
                              <span className="text-slate-600">{m.name || 'Loja'}</span>
                              <code className="rounded bg-white px-1 text-slate-500">{m.id}</code>
                            </li>
                          ))}
                          <li className="pt-1 text-slate-400">Copie o ID acima para o campo Merchant ID.</li>
                        </ul>
                      ) : (
                        <p className="mt-1 text-slate-400">Nenhuma loja retornada (confira o módulo Merchant no app).</p>
                      )}
                    </>
                  ) : (
                    <p className="text-red-600">{testResult[c.id].error ?? 'Falha na autenticação'}</p>
                  )}
                </div>
              )}
            </Card>
          ))}
        </div>
      ))}

      {(creating || editing) && (
        <ChannelForm channel={editing} onClose={() => { setCreating(false); setEditing(null); qc.invalidateQueries({ queryKey: ['channels'] }); }} />
      )}
    </div>
  );
}

function ChannelForm({ channel, onClose }: { channel: Channel | null; onClose: () => void }) {
  const isEdit = !!channel;
  const [platform, setPlatform] = useState<DeliveryPlatform>(channel?.platform ?? 'ifood');
  const [name, setName] = useState(channel?.name ?? '');
  const [merchantId, setMerchantId] = useState(channel?.merchant_id ?? '');
  const [clientId, setClientId] = useState(channel?.client_id ?? '');
  const [clientSecret, setClientSecret] = useState('');
  const [webhookSecret, setWebhookSecret] = useState(channel?.webhook_secret ?? '');
  const [active, setActive] = useState(channel?.active ?? true);
  const [autoConfirm, setAutoConfirm] = useState(channel?.auto_confirm ?? false);
  const [err, setErr] = useState('');

  const save = useMutation({
    mutationFn: (body: ChannelInput) => (isEdit ? channelsApi.update(channel!.id, body) : channelsApi.create(body)),
    onSuccess: onClose,
    onError: (e) => setErr(apiError(e)),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setErr('');
    if (!name.trim()) { setErr('Informe o nome do canal'); return; }
    const body: ChannelInput = {
      platform, name: name.trim(),
      merchant_id: merchantId || null,
      client_id: clientId || null,
      webhook_secret: webhookSecret || null,
      active,
      auto_confirm: autoConfirm,
    };
    if (clientSecret) body.client_secret = clientSecret; // só envia se preenchido (preserva o atual)
    save.mutate(body);
  }

  return (
    <Modal title={isEdit ? 'Editar canal' : 'Novo canal'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {err && <ErrorBox message={err} />}
        <Field label="Plataforma">
          <Select value={platform} onChange={(e) => setPlatform(e.target.value as DeliveryPlatform)} disabled={isEdit}>
            {PLATFORMS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </Select>
        </Field>
        <Field label="Nome"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Restaurante Seu Sérgio — iFood" /></Field>
        <Field label={platform === '99food' ? 'App Shop ID (id que você define p/ a loja)' : 'Merchant ID'}>
          <Input value={merchantId} onChange={(e) => setMerchantId(e.target.value)} />
        </Field>
        <Field label={platform === '99food' ? 'App ID' : 'Client ID'}><Input value={clientId} onChange={(e) => setClientId(e.target.value)} /></Field>
        <Field label={`${platform === '99food' ? 'App Secret' : 'Client secret'}${isEdit ? ' (deixe vazio para manter)' : ''}`}>
          <Input type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} placeholder={isEdit ? '••••••' : ''} />
        </Field>
        {platform !== '99food' && (
          <Field label="Webhook secret"><Input value={webhookSecret} onChange={(e) => setWebhookSecret(e.target.value)} /></Field>
        )}
        <p className="rounded-lg bg-slate-50 p-2 text-xs text-slate-500">
          {platform === '99food'
            ? 'Callback (no portal 99Food): https://pedidos.guimarques.dev.br/api/webhooks/99food'
            : 'Webhook (no portal iFood, módulo Events): https://pedidos.guimarques.dev.br/api/webhooks/ifood'}
        </p>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Ativo
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={autoConfirm} onChange={(e) => setAutoConfirm(e.target.checked)} /> Confirmar pedidos automaticamente (aceite automático)
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="submit" disabled={save.isPending}>Salvar</Button>
        </div>
      </form>
    </Modal>
  );
}
