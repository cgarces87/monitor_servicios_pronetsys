import { useEffect, useRef, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import * as m from 'motion/react-m';
import { api } from './api/client';
import { usePolling } from './hooks/usePolling';
import { useLiveEvents } from './hooks/useLiveEvents';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { Header } from './components/Header';
import { LoginPage } from './components/LoginPage';
import { SummaryCards } from './components/SummaryCards';
import { ServiceList, type VistaServicios } from './components/ServiceList';
import { ServiceFormModal } from './components/ServiceFormModal';
import { IncidentList } from './components/IncidentList';
import { UserManager } from './components/UserManager';
import { TVMode } from './components/TVMode';
import { NotificationsManager } from './components/NotificationsManager';
import { IncidentsView } from './components/IncidentsView';
import { formatearFecha } from './utils/format';
import type { EstadoServicio, EventoMonitor, ServicioResumen } from './types';

const ORDEN_ESTADO: Record<EstadoServicio, number> = { DOWN: 0, UP: 1, PAUSED: 2 };

// Puntos del mini-grafico de cada tarjeta en la vista cuadricula.
const PUNTOS_SPARKLINE = 40;

/** Aplica un evento de chequeo en vivo a la lista local de servicios. */
function aplicarCheck(lista: ServicioResumen[] | null, e: EventoMonitor): ServicioResumen[] | null {
  if (!lista || e.tipo !== 'check') return lista;
  return lista.map((s) => {
    if (s.id !== e.serviceId) return s;
    const punto = { latenciaMs: e.latenciaMs, statusCode: e.statusCode, ok: e.ok, timestamp: e.ts };
    return {
      ...s,
      estadoActual: s.estadoActual === 'PAUSED' ? s.estadoActual : e.estado,
      ultimaLatenciaMs: e.latenciaMs,
      ultimoStatusCode: e.statusCode,
      ultimoCheckEn: e.ts,
      sparkline: s.sparkline ? [...s.sparkline, punto].slice(-PUNTOS_SPARKLINE) : undefined,
    };
  });
}

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

type Vista = 'panel' | 'usuarios' | 'tv' | 'notificaciones' | 'incidentes';

function Dashboard() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';

  const [vista, setVista] = useState<Vista>('panel');

  const [modalAbierto, setModalAbierto] = useState(false);
  const [editando, setEditando] = useState<ServicioResumen | null>(null);

  // Filtros activados por click en las tarjetas del resumen.
  const [filtroEstado, setFiltroEstado] = useState<EstadoServicio | null>(null);
  const [filtroIncidentesAbiertos, setFiltroIncidentesAbiertos] = useState(false);

  // Vista lista / cuadricula, persistida en localStorage para que sobreviva
  // recargas y vuelva a abrir donde el usuario la dejo.
  const [vistaServicios, setVistaServicios] = useState<VistaServicios>(() => {
    const guardado = typeof window !== 'undefined' ? localStorage.getItem('vistaServicios') : null;
    return guardado === 'cuadricula' ? 'cuadricula' : 'lista';
  });
  useEffect(() => {
    try {
      localStorage.setItem('vistaServicios', vistaServicios);
    } catch {
      /* sin persistencia si el browser bloquea localStorage */
    }
  }, [vistaServicios]);

  // Con eventos en vivo (SSE) el panel se actualiza al instante; el polling
  // queda como respaldo y para refrescar uptime/incidentes cada tanto.
  const [vivo, setVivo] = useState(false);
  const intervalo = vivo ? 60_000 : 30_000;
  const summary = usePolling(api.summary, intervalo);
  const servicios = usePolling(
    () => api.services(vistaServicios === 'cuadricula' ? PUNTOS_SPARKLINE : 0),
    intervalo,
  );
  const incidentes = usePolling(() => api.incidents({ limit: 20 }), intervalo);

  const conectado = useLiveEvents((e) => {
    if (e.tipo === 'check') {
      servicios.mutate((prev) => aplicarCheck(prev, e));
    } else {
      // Cambio UP<->DOWN: cambian contadores, incidentes y el uptime.
      summary.refetch();
      incidentes.refetch();
      servicios.refetch();
    }
  });
  useEffect(() => setVivo(conectado), [conectado]);

  // Al pasar a cuadricula hacen falta los sparklines: recargar ya (el primer
  // render no, porque usePolling ya hace la carga inicial).
  const refetchServicios = servicios.refetch;
  const vistaPrevia = useRef(vistaServicios);
  useEffect(() => {
    if (vistaPrevia.current === vistaServicios) return;
    vistaPrevia.current = vistaServicios;
    refetchServicios();
  }, [vistaServicios, refetchServicios]);

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
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-2 px-4">
          {/* En movil las pestanas se desplazan en horizontal en vez de desbordar la pagina. */}
          <div className="flex min-w-0 gap-1 overflow-x-auto [scrollbar-width:none]">
            <NavTab activo={vista === 'panel'} onClick={() => setVista('panel')} label="Panel" />
            <NavTab activo={vista === 'tv'} onClick={() => setVista('tv')} label="Modo TV" />
            <NavTab activo={vista === 'incidentes'} onClick={() => setVista('incidentes')} label="Incidentes" />
            {isAdmin && (
              <NavTab activo={vista === 'notificaciones'} onClick={() => setVista('notificaciones')} label="Notificaciones" />
            )}
            {isAdmin && (
              <NavTab activo={vista === 'usuarios'} onClick={() => setVista('usuarios')} label="Usuarios" />
            )}
          </div>
          {isAdmin && vista === 'panel' && (
            <button
              onClick={abrirCrear}
              aria-label="Agregar servicio"
              className="my-2 shrink-0 whitespace-nowrap rounded-lg bg-brand px-3 py-1.5 text-sm text-white hover:bg-brand-dark"
            >
              + <span className="hidden sm:inline">Agregar servicio</span>
            </button>
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
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <h2 className="text-xl text-slate-800">Servicios</h2>
                  <ToggleVista vista={vistaServicios} onChange={setVistaServicios} />
                </div>
                <span className="hidden items-center gap-2 text-xs font-normal text-slate-400 sm:flex">
                  {vivo ? (
                    <>
                      <span className="h-1.5 w-1.5 rounded-full bg-estado-up" aria-hidden="true" />
                      En vivo
                    </>
                  ) : (
                    <>Actualizado: {formatearFecha(summary.data?.ts ?? null)}</>
                  )}
                </span>
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
                  vista={vistaServicios}
                  onEdit={abrirEditar}
                  onChanged={refrescar}
                />
              )}
            </section>

            <section>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-xl text-slate-800">Incidentes recientes (Top 5)</h2>
                <button
                  onClick={() => setVista('incidentes')}
                  className="text-sm text-brand hover:underline"
                >
                  Ver todos →
                </button>
              </div>
              {filtroIncidentesAbiertos && (
                <div className="mb-2 flex items-center gap-2 text-sm">
                  <span className="rounded-full bg-brand/10 px-3 py-1 text-brand">
                    Mostrando solo incidentes abiertos
                  </span>
                  <button
                    onClick={() => setFiltroIncidentesAbiertos(false)}
                    className="rounded-full border border-slate-300 px-2 py-0.5 text-xs font-normal text-slate-600 hover:bg-slate-50"
                  >
                    Quitar filtro
                  </button>
                </div>
              )}
              <IncidentList incidentes={(incidentesVisibles ?? []).slice(0, 5)} />
            </section>
          </>
        ) : vista === 'incidentes' ? (
          <IncidentsView />
        ) : vista === 'usuarios' ? (
          isAdmin && <UserManager />
        ) : vista === 'notificaciones' ? (
          isAdmin && <NotificationsManager />
        ) : null}
      </main>

      <footer className="mx-auto max-w-7xl px-4 py-6 text-center text-xs font-normal text-slate-400">
        Monitor de Servicios Pronetsys · monitor.pronetsys.com.co
      </footer>

      <AnimatePresence>
        {modalAbierto && (
          <ServiceFormModal
            initial={editando}
            onClose={() => setModalAbierto(false)}
            onSaved={alGuardar}
          />
        )}
      </AnimatePresence>

      {vista === 'tv' && (
        <TVMode
          servicios={servicios.data}
          loading={servicios.loading}
          error={servicios.error}
          onExit={() => setVista('panel')}
        />
      )}
    </div>
  );
}

function NavTab({ activo, onClick, label }: { activo: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      aria-current={activo ? 'page' : undefined}
      className={`relative shrink-0 whitespace-nowrap px-4 py-3 text-sm transition-colors ${
        activo ? 'text-brand' : 'font-normal text-slate-500 hover:text-slate-800'
      }`}
    >
      {label}
      {/* Un solo subrayado que se desliza entre pestanas (layoutId). */}
      {activo && (
        <m.span
          layoutId="pestana-activa"
          className="absolute inset-x-0 bottom-0 h-0.5 bg-brand"
          transition={{ duration: 0.25, ease: [0.77, 0, 0.175, 1] }}
        />
      )}
    </button>
  );
}

function ToggleVista({
  vista,
  onChange,
}: {
  vista: VistaServicios;
  onChange: (v: VistaServicios) => void;
}) {
  const opt = (v: VistaServicios, label: string) => (
    <button
      type="button"
      onClick={() => onChange(v)}
      className={`rounded px-2.5 py-1 text-xs transition ${
        vista === v ? 'bg-brand text-white' : 'font-normal text-slate-600 hover:bg-slate-50'
      }`}
    >
      {label}
    </button>
  );
  return (
    <div className="flex items-center gap-0.5 rounded-lg border border-slate-300 p-0.5">
      {opt('lista', 'Lista')}
      {opt('cuadricula', 'Cuadricula')}
    </div>
  );
}
