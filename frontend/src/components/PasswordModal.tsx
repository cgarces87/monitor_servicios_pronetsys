import { useState, type FormEvent } from 'react';
import { api } from '../api/client';

type Props =
  | { mode: 'self'; onClose: () => void; onSaved: () => void }
  | { mode: 'admin'; targetId: number; targetUsername: string; onClose: () => void; onSaved: () => void };

export function PasswordModal(props: Props) {
  const esAdmin = props.mode === 'admin';
  const [current, setCurrent] = useState('');
  const [nueva, setNueva] = useState('');
  const [confirmar, setConfirmar] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const onSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    if (nueva.length < 6) {
      setError('La nueva contrasena debe tener al menos 6 caracteres.');
      return;
    }
    if (nueva !== confirmar) {
      setError('Las contrasenas no coinciden.');
      return;
    }
    setGuardando(true);
    try {
      if (props.mode === 'admin') {
        await api.updateUser(props.targetId, { password: nueva });
      } else {
        await api.changeMyPassword(current, nueva);
      }
      props.onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cambiar la contrasena.');
    } finally {
      setGuardando(false);
    }
  };

  const inputCls =
    'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={props.onClose}>
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-4 text-lg text-slate-800">
          {esAdmin ? `Cambiar contrasena de "${props.targetUsername}"` : 'Cambiar mi contrasena'}
        </h2>

        <form onSubmit={onSubmit} className="space-y-4">
          {!esAdmin && (
            <div>
              <label className="mb-1 block text-sm font-normal text-slate-600">Contrasena actual</label>
              <input
                type="password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                className={inputCls}
                required
                autoComplete="current-password"
              />
            </div>
          )}
          <div>
            <label className="mb-1 block text-sm font-normal text-slate-600">Nueva contrasena</label>
            <input
              type="password"
              value={nueva}
              onChange={(e) => setNueva(e.target.value)}
              className={inputCls}
              required
              minLength={6}
              autoComplete="new-password"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-normal text-slate-600">Confirmar nueva contrasena</label>
            <input
              type="password"
              value={confirmar}
              onChange={(e) => setConfirmar(e.target.value)}
              className={inputCls}
              required
              minLength={6}
              autoComplete="new-password"
            />
          </div>

          {error && (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200">{error}</div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={props.onClose}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-normal text-slate-600 hover:bg-slate-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={guardando}
              className="rounded-lg bg-brand px-4 py-2 text-sm text-white hover:bg-brand-dark disabled:opacity-60"
            >
              {guardando ? 'Guardando…' : 'Cambiar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
