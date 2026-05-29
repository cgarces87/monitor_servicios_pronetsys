import { useState, type FormEvent } from 'react';
import { api } from '../api/client';
import type { Role } from '../types';

interface Props {
  onClose: () => void;
  onSaved: () => void;
}

export function UserFormModal({ onClose, onSaved }: Props) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('VIEWER');
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const onSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    setGuardando(true);
    try {
      await api.createUser({ username: username.trim(), password, role });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear el usuario.');
    } finally {
      setGuardando(false);
    }
  };

  const inputCls =
    'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-4 text-lg text-slate-800">Crear usuario</h2>

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-normal text-slate-600">Usuario</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className={inputCls}
              required
              minLength={3}
              maxLength={80}
              autoComplete="off"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-normal text-slate-600">Contrasena</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputCls}
              required
              minLength={6}
              autoComplete="new-password"
            />
            <p className="mt-1 text-xs font-normal text-slate-400">Minimo 6 caracteres.</p>
          </div>
          <div>
            <label className="mb-1 block text-sm font-normal text-slate-600">Rol</label>
            <div className="flex gap-2">
              <RoleBtn activo={role === 'VIEWER'} onClick={() => setRole('VIEWER')} label="Lector" sub="Solo ve el panel" />
              <RoleBtn activo={role === 'ADMIN'} onClick={() => setRole('ADMIN')} label="Admin" sub="Gestiona todo" />
            </div>
          </div>

          {error && (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200">{error}</div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-normal text-slate-600 hover:bg-slate-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={guardando}
              className="rounded-lg bg-brand px-4 py-2 text-sm text-white hover:bg-brand-dark disabled:opacity-60"
            >
              {guardando ? 'Creando…' : 'Crear'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function RoleBtn({
  activo,
  onClick,
  label,
  sub,
}: {
  activo: boolean;
  onClick: () => void;
  label: string;
  sub: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded-lg border px-3 py-2 text-left text-sm transition ${
        activo ? 'border-brand bg-brand text-white' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
      }`}
    >
      <div>{label}</div>
      <div className={`text-xs font-normal ${activo ? 'text-white/80' : 'text-slate-400'}`}>{sub}</div>
    </button>
  );
}
