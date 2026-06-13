import { useState } from 'react';
import { api } from './api/client';
import { usePolling } from './hooks/usePolling';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { Header } from './components/Header';
import { LoginPage } from './components/LoginPage';
import { SummaryCards } from './components/SummaryCards';
import { ServiceList } from './components/ServiceList';
import { ServiceFormModal } from './components/ServiceFormModal';
import { IncidentList } from './components/IncidentList';
import { UserManager } from './components/UserManager';
import { TVMode } from './components/TVMode';
import { NotificationsManager } from './components/NotificationsManager';
import { formatearFecha } from './utils/format';
import type { EstadoServicio, ServicioResumen } from './types';

const ORDEN_ESTADO: Record<EstadoServicio, number> = { DOWN: 0, UP: 1, PAUSED: 2 };

export default function App() {
  return (
    <AuthProvider>
      <Root />
    </AuthProvider>
  );
}

function Root() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-full items-center justify-center text-slate-400">
        Cargando…
      </div>
    );
  }

  if (!user) return <LoginPage />;
  return <Dashboard />;
}

type Vista = 'panel' | 'usuarios' | 'tv' | 'notificaciones';

function Dashboard() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';

  const [vista, setVista] = useState<Vista>('panel');
  const summary = usePolling(api.summary, 30_000);
  const servicios = usePolling(api.services, 30_000);
  const incidentes = usePolling(() => api.incidents(false), 30_000);

  const [modalAbierto, setModalAbierto] = useState(false);
  const [editando, setEditando] = useState<ServicioResumen | null>(null);

  // Filtros activados por click en las tarjetas del resumen.
  const [filtroEstado, setFiltroEstado] = useState<EstadoServicio | null>(null);
  const [filtroIncidentesAbiertos, setFiltroIncidentesAbiertos] = useState(false);

  const toggleFiltroEstado = (estado: 'DOWN' | 'PAUSED'): void => {
    setFiltroEstado((prev) => (prev === estado ? null : estado));
  };
  const toggleFiltroIncidentes = (): void => {
    setFiltroIncidentesAbiertos((prev) => !prev);
  };

  // Ordenamos siempre por estado (DOWN primero, luego UP, luego PAUSED) y
  // dentro de cada grupo, alfabetico. Aplicamos despues el filtro si esta activo.
  const serviciosOrdenados = (servicios.data ?? [])
    .slice()
    .sort(
      (a, b) =>
        ORDEN_ESTADO[a.estadoActual] - ORDEN_ESTADO[b.estadoActual] ||
        a.nombre.localeCompare(b.nombre),
    );
  const serviciosVisibles = filtroEstado
    ? serviciosOrdenados.filter((s) => s.estadoActual === filtroEstado)
    : serviciosOrdenados;

  const incidentesVisibles = filtroIncidentesAbiertos
    ? (incidentes.data ?? []).filter((i) => i.abierto)
    : incidentes.data;

  const refrescar = (): void => {
    servicios.refetch();
    summary.refetch();
  };

  const abrirCrear = (): void => {
    setEditando(null);
    setModalAbierto(true);
  };
  const abrirEditar = (s: ServicioResumen): void => {
    setEditando(s);
    setModalAbierto(true);
  };
  const alGuardar = (): void => {
    setModalAbierto(false);
    refrescar();
  };

  const hayError = summary.error || servicios.error || incidentes.error;

  return (
    <div className="min-h-full">
      <Header />

      <nav className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl gap-1 px-4">
          <NavTab activo={vista === 'panel'} onClick={() => setVista('panel')} label="Panel" />
          <NavTab activo={vista === 'tv'} onClick={() => setVista('tv')} label="Modo TV" />
          {isAdmin && (
            <NavTab activo={vista === 'notificaciones'} onClick={() => setVista('notificaciones')} label="Notificaciones" />
          )}
          {isAdmin && (
            <NavTab activo={vista === 'usuarios'} onClick={() => setVista('usuarios')} label="Usuarios" />
          )}
        </div>
      </nav>

      <main className="mx-auto max-w-7xl space-y-8 px-4 py-6">
        {vista === 'panel' ? (
          <>
            {hayError && (
              <div className="rounded-lg bg-red-100 px-4 py-3 text-sm text-red-800 ring-1 ring-red-200">
                Error de conexion con la API: {summary.error || servicios.error || incidentes.error}
              </div>
            )}

            <section>
              <SummaryCards
                summary={summary.data}
                filtroEstado={filtroEstado}
                filtroIncidentesAbiertos={filtroIncidentesAbiertos}
                onToggleFiltroEstado={toggleFiltroEstado}
                onToggleFiltroIncidentes={toggleFiltroIncidentes}
              />
            </section>

            <section>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-xl text-slate-800">Servicios</h2>
                <div className="flex items-center gap-3">
                  <span className="hidden text-xs font-normal text-slate-400 sm:inline">
                    Actualizado: {formatearFecha(summary.data?.ts ?? null)}
                  </span>
                  {isAdmin && (
                    <button
                      onClick={abrirCrear}
                      className="rounded-lg bg-brand px-3 py-1.5 text-sm text-white hover:bg-brand-dark"
                    >
                      + Agregar servicio
                    </button>
                  )}
                </div>
              </div>

              {filtroEstado && (
                <div className="mb-2 flex items-center gap-2 text-sm">
                  <span className="rounded-full bg-brand/10 px-3 py-1 text-brand">
                    Mostrando solo: {filtroEstado === 'DOWN' ? 'Caidos' : 'Pausados'} ({serviciosVisibles.length})
                  </span>
                  <button
                    onClick={() => setFiltroEstado(null)}
                    className="rounded-full border border-slate-300 px-2 py-0.5 text-xs font-normal text-slate-600 hover:bg-slate-50"
                  >
                    Quitar filtro
                  </button>
                </div>
              )}

              {filtroEstado && serviciosVisibles.length === 0 ? (
                <p className="rounded-lg bg-white px-4 py-3 text-sm text-slate-500 ring-1 ring-slate-200">
                  No hay servicios en estado {filtroEstado === 'DOWN' ? 'caidos' : 'pausados'} en este momento.
                </p>
              ) : (
                <ServiceList
                  servicios={serviciosVisibles}
                  loading={servicios.loading}
                  isAdmin={isAdmin}
                  onEdit={abrirEditar}
                  onChanged={refrescar}
                />
              )}
            </section>

            <section>
              <h2 className="mb-3 text-xl text-slate-800">Incidentes recientes</h2>
              {filtroIncidentesAbiertos && (
                <div className="mb-2 flex items-center gap-2 text-sm">
                  <span className="rounded-full bg-brand/10 px-3 py-1 text-brand">
                    Mostrando solo incidentes abiertos ({incidentesVisibles?.length ?? 0})
                  </span>
                  <button
                    onClick={() => setFiltroIncidentesAbiertos(false)}
                    className="rounded-full border border-slate-300 px-2 py-0.5 text-xs font-normal text-slate-600 hover:bg-slate-50"
                  >
                    Quitar filtro
                  </button>
                </div>
              )}
              <IncidentList incidentes={incidentesVisibles} />
            </section>
          </>
        ) : vista === 'usuarios' ? (
          isAdmin && <UserManager />
        ) : vista === 'notificaciones' ? (
          isAdmin && <NotificationsManager />
        ) : null}
      </main>

      <footer className="mx-auto max-w-7xl px-4 py-6 text-center text-xs font-normal text-slate-400">
        Monitor de Servicios Pronetsys · monitor.pronetsys.com.co
      </footer>

      {modalAbierto && (
        <ServiceFormModal
          initial={editando}
          onClose={() => setModalAbierto(false)}
          onSaved={alGuardar}
        />
      )}

      {vista === 'tv' && <TVMode onExit={() => setVista('panel')} />}
    </div>
  );
}

function NavTab({ activo, onClick, label }: { activo: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`border-b-2 px-4 py-3 text-sm transition ${
        activo
          ? 'border-brand text-brand'
          : 'border-transparent font-normal text-slate-500 hover:text-slate-800'
      }`}
    >
      {label}
    </button>
  );
}
