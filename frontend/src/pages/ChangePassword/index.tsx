import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, apiError } from '../../services/api';
import { useAuth } from '../../store/auth.store';
import { Button, Field, Input, ErrorBox } from '../../components/ui';
import { AppName, Logo } from '../../config/brand';

/** Troca de senha obrigatória (1º login / reset pelo admin) ou voluntária. */
export function ChangePassword() {
  const navigate = useNavigate();
  const user = useAuth((s) => s.user);
  const [current, setCurrent] = useState('');
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (pw.length < 8) { setError('A nova senha precisa ter pelo menos 8 caracteres.'); return; }
    if (pw !== confirm) { setError('A confirmação não confere.'); return; }
    setLoading(true);
    try {
      await api.post('/auth/change-password', { current_password: current, new_password: pw });
      // Atualiza o usuário salvo (zera a flag) e segue para o app.
      const updated = { ...user, must_change_password: 0 };
      localStorage.setItem('pedidopro_user', JSON.stringify(updated));
      useAuth.setState({ user: updated as never });
      navigate('/');
    } catch (err) {
      setError(apiError(err, 'Falha ao trocar a senha'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-lg">
        <div className="mb-6 flex flex-col items-center gap-2">
          <Logo size={36} />
          <h1 className="text-xl font-bold text-slate-800"><AppName /></h1>
          <p className="text-center text-sm text-slate-500">
            Por segurança, defina uma nova senha antes de continuar.
          </p>
        </div>
        <form onSubmit={submit} className="space-y-4">
          {error && <ErrorBox message={error} />}
          <Field label="Senha atual">
            <Input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} required autoFocus />
          </Field>
          <Field label="Nova senha (mín. 8 caracteres)">
            <Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} required />
          </Field>
          <Field label="Confirmar nova senha">
            <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          </Field>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? 'Salvando…' : 'Salvar nova senha'}
          </Button>
        </form>
      </div>
    </div>
  );
}
