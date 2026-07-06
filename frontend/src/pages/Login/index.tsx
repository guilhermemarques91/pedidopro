import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../store/auth.store';
import { apiError } from '../../services/api';
import { Button, Field, Input, ErrorBox } from '../../components/ui';
import { AppName, AppTagline, Logo } from '../../config/brand';

export function Login() {
  const login = useAuth((s) => s.login);
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(username, password);
      // Login de empresa cai direto na própria área; staff vai ao dashboard.
      const role = useAuth.getState().user?.role;
      navigate(role === 'company' ? '/marmitex' : '/');
    } catch (err) {
      setError(apiError(err, 'Falha ao entrar'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-lg">
        <div className="mb-6 flex flex-col items-center gap-2">
          <Logo size={36} />
          <h1 className="text-2xl font-bold text-slate-800"><AppName /></h1>
          <p className="text-sm text-slate-500"><AppTagline /></p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <ErrorBox message={error} />}
          <Field label="Usuário">
            <Input type="text" autoCapitalize="none" autoCorrect="off" value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus />
          </Field>
          <Field label="Senha">
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? 'Entrando...' : 'Entrar'}
          </Button>
        </form>
      </div>
    </div>
  );
}
