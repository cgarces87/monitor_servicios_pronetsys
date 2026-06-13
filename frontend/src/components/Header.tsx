/*
  Encabezado corporativo. Por lineamiento de marca, en el header se permite
  EXCLUSIVAMENTE el logotipo oficial actual de Pronetsys. No agregar otras
  imagenes, banners ni iconos decorativos aqui (los controles de usuario son
  texto/boton, no imagenes).
*/
import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { PasswordModal } from './PasswordModal';

export function Header() {
  const { user, logout } = useAuth();
  const [logoFallo, setLogoFallo] = useState(false);
  const [cambiarPass, setCambiarPass] = useState(false);

  return (
    <header className="bg-white shadow-sm ring-1 ring-slate-200">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3">
          {!logoFallo ? (
            <img
              src="/logo.png?v=2"
              alt="Pronetsys"
              className="h-20 w-auto"
              onError={() => setLogoFallo(true)}
            />
          ) : (
            <span className="text-2xl tracking-wide text-brand">PRONETSYS</span>
          )}
          <div className="hidden border-l border-slate-200 pl-3 sm:block">
            <div className="text-lg text-slate-800">Monitor de Servicios</div>
          </div>
        </div>

        {user && (
          <div className="flex items-center gap-3 text-sm">
            <span className="hidden text-slate-600 sm:inline">
              {user.username}
              <span className="ml-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                {user.role === 'ADMIN' ? 'Admin' : 'Lector'}
              </span>
            </span>
            <button
              onClick={() => setCambiarPass(true)}
              className="rounded-lg border border-slate-300 px-3 py-1 font-normal text-slate-600 transition hover:bg-slate-50"
            >
              Cambiar contrasena
            </button>
            <button
              onClick={() => void logout()}
              className="rounded-lg border border-slate-300 px-3 py-1 font-normal text-slate-600 transition hover:bg-slate-50"
            >
              Salir
            </button>
          </div>
        )}
      </div>

      {cambiarPass && (
        <PasswordModal
          mode="self"
          onClose={() => setCambiarPass(false)}
          onSaved={() => setCambiarPass(false)}
        />
      )}
    </header>
  );
}
