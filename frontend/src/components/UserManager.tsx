import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import type { Role, UserAdmin } from '../types';
import { formatearFecha } from '../utils/format';
import { UserFormModal } from './UserFormModal';
import { PasswordModal } from './PasswordModal';

export function UserManager() {
  const { user } = useAuth();
  const [usuarios, setUsuarios] = useState<UserAdmin[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modalAbierto, setModalAbierto] = useState(false);
  const [resetPass, setResetPass] = useState<UserAdmin | null>(null);
  const [accionId, setAccionId] = useState<number | null>(null);

  const cargar = useCallback(async () => {
    try {
      setUsuarios(await api.users());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const toggleActivo = async (u: UserAdmin): Promise<void> => {
    setAccionId(u.id);
    try {
      await api.updateUser(u.id, { activo: !u.activo });
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAccionId(null);
    }
  };

  const cambiarRol = async (u: UserAdmin, role: Role): Promise<void> => {
    if (role === u.role) return;
    setAccionId(u.id);
    try {
      await api.updateUser(u.id, { role });
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAccionId(null);
    }
  };

  const eliminar = async (u: UserAdmin): Promise<void> => {
    if (!confirm(`¿Eliminar al usuario "${u.username}"?`)) return;
    setAccionId(u.id);
    try {
      await api.deleteUser(u.id);
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAccionId(null);
    }
  };

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xl text-slate-800">Usuarios</h2>
        <button
          onClick={() => setModalAbierto(true)}
          className="rounded-lg bg-brand px-3 py-1.5 text-sm text-white hover:bg-brand-dark"
        >
          + Crear usuario
        </button>
      </div>

      {error && (
        <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200">{error}</div>
      )}

      <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs font-normal uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2">Usuario</th>
              <th className="px-4 py-2">Rol</th>
              <th className="px-4 py-2">Estado</th>
              <th className="px-4 py-2">Creado</th>
              <th className="px-4 py-2 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {!usuarios ? (
              <tr>
                <td colSpan={5} className="px-4 py-3 text-slate-400">Cargando…</td>
              </tr>
            ) : (
              usuarios.map((u) => {
                const esYo = u.id === user?.id;
                return (
                  <tr key={u.id}>
                    <td className="px-4 py-2 text-slate-800">
                      {u.username}
                      {esYo && <span className="ml-2 text-xs font-normal text-slate-400">(tú)</span>}
                    </td>
                    <td className="px-4 py-2">
                      {esYo ? (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                          {u.role === 'ADMIN' ? 'Admin' : 'Lector'}
                        </span>
                      ) : (
                        <select
                          value={u.role}
                          disabled={accionId === u.id}
                          onChange={(e) => void cambiarRol(u, e.target.value as Role)}
                          className="rounded-lg border border-slate-300 px-2 py-1 text-xs text-slate-700 outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 disabled:opacity-60"
                        >
                          <option value="VIEWER">Lector</option>
                          <option value="ADMIN">Admin</option>
                        </select>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      {u.activo ? (
                        <span className="text-estado-up">Activo</span>
                      ) : (
                        <span className="text-slate-400">Inactivo</span>
                      )}
                    </td>
                    <td className="px-4 py-2 font-normal text-slate-500">{formatearFecha(u.creadoEn)}</td>
                    <td className="px-4 py-2">
                      <div className="flex justify-end gap-2">
                        {!esYo && (
                          <>
                            <button
                              onClick={() => setResetPass(u)}
                              disabled={accionId === u.id}
                              className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-normal text-slate-600 hover:bg-slate-50 disabled:opacity-60"
                            >
                              Contrasena
                            </button>
                            <button
                              onClick={() => void toggleActivo(u)}
                              disabled={accionId === u.id}
                              className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-normal text-slate-600 hover:bg-slate-50 disabled:opacity-60"
                            >
                              {u.activo ? 'Desactivar' : 'Activar'}
                            </button>
                            <button
                              onClick={() => void eliminar(u)}
                              disabled={accionId === u.id}
                              className="rounded-lg border border-red-300 px-2.5 py-1 text-xs font-normal text-red-600 hover:bg-red-50 disabled:opacity-60"
                            >
                              Eliminar
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {modalAbierto && (
        <UserFormModal
          onClose={() => setModalAbierto(false)}
          onSaved={() => {
            setModalAbierto(false);
            void cargar();
          }}
        />
      )}

      {resetPass && (
        <PasswordModal
          mode="admin"
          targetId={resetPass.id}
          targetUsername={resetPass.username}
          onClose={() => setResetPass(null)}
          onSaved={() => setResetPass(null)}
        />
      )}
    </section>
  );
}
