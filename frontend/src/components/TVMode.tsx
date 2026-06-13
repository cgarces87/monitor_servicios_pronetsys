import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { usePolling } from '../hooks/usePolling';
import type { EstadoServicio, ServicioResumen } from '../types';
import { formatearFecha, formatearLatencia, objetivoServicio } from '../utils/format';

interface Props {
  onExit: () => void;
}

const ordenEstado: Record<EstadoServicio, number> = { DOWN: 0, UP: 1, PAUSED: 2 };

export function TVMode({ onExit }: Props) {
  const servicios = usePolling(api.services, 15_000);
  const [now, setNow] = useState(new Date());
  const [fs, setFs] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    const onFsChange = (): void => setFs(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFsChange);
    return () => {
      clearInterval(t);
      document.removeEventListener('fullscreenchange', onFsChange);
    };
  }, []);

  const toggleFs = (): void => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen();
  };

  const lista: ServicioResumen[] = (servicios.data ?? [])
    .slice()
    .sort((a, b) => ordenEstado[a.estadoActual] - ordenEstado[b.estadoActual] || a.nombre.localeCompare(b.nombre));

  const up = lista.filter((s) => s.estadoActual === 'UP').length;
  const down = lista.filter((s) => s.estadoActual === 'DOWN').length;
  const paused = lista.filter((s) => s.estadoActual === 'PAUSED').length;

  return (
    <div className="fixed inset-0 z-50 overflow-auto bg-slate-900 text-white">
      <div className="flex items-center justify-between border-b border-slate-700 px-6 py-3">
        <div className="flex items-center gap-4">
          <img src="/logo.png?v=2" alt="Pronetsys" className="h-12 w-auto rounded-md bg-white p-1" />
          <div>
            <div className="text-xl tracking-wide">Monitor de Servicios</div>
            <div className="text-xs text-slate-400">{now.toLocaleString('es-CO')}</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Chip label="Operativos" value={up} color="text-estado-up" />
          <Chip label="Caidos" value={down} color={down > 0 ? 'text-estado-down' : 'text-slate-300'} />
          <Chip label="Pausados" value={paused} color="text-slate-400" />
          <button
            onClick={toggleFs}
            className="rounded-lg border border-slate-600 px-3 py-1 text-sm text-slate-200 hover:bg-slate-800"
          >
            {fs ? 'Salir pantalla completa' : 'Pantalla completa'}
          </button>
          <button
            onClick={onExit}
            className="rounded-lg border border-slate-600 px-3 py-1 text-sm text-slate-200 hover:bg-slate-800"
          >
            Salir
          </button>
        </div>
      </div>

      {servicios.error && (
        <div className="m-6 rounded-lg bg-red-900/50 px-4 py-3 text-red-200">
          Error de conexion: {servicios.error}
        </div>
      )}

      {lista.length === 0 ? (
        <div className="p-10 text-center text-slate-400">
          {servicios.loading ? 'Cargando…' : 'No hay servicios registrados.'}
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3 p-6">
          {lista.map((s) => (
            <Tile key={s.id} servicio={s} />
          ))}
        </div>
      )}
    </div>
  );
}

function Chip({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="text-center">
      <div className={`text-2xl leading-none ${color}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
    </div>
  );
}

function Tile({ servicio }: { servicio: ServicioResumen }) {
  const estado = servicio.estadoActual;
  const base = 'rounded-xl p-4 flex flex-col justify-between min-h-[120px] ring-1';
  const estilo =
    estado === 'DOWN'
      ? 'bg-red-600 ring-red-400'
      : estado === 'PAUSED'
        ? 'bg-slate-800 ring-slate-700 opacity-60'
        : 'bg-slate-800 ring-slate-700';

  return (
    <div className={`${base} ${estilo}`}>
      <div>
        <div className="flex items-start justify-between gap-2">
          <span className="text-lg leading-tight">{servicio.nombre}</span>
          <span
            className={`mt-1 h-3 w-3 flex-shrink-0 rounded-full ${
              estado === 'DOWN' ? 'animate-pulse bg-white' : estado === 'PAUSED' ? 'bg-slate-500' : 'bg-estado-up'
            }`}
          />
        </div>
        <div className="mt-1 truncate text-xs text-slate-300">
          <span className="mr-1 rounded bg-black/20 px-1 text-[10px] uppercase">{servicio.tipo}</span>
          {objetivoServicio(servicio)}
        </div>
      </div>
      <div className="mt-3 flex items-end justify-between text-xs">
        <span className={estado === 'DOWN' ? 'font-bold text-white' : 'text-slate-300'}>
          {estado === 'DOWN' ? 'CAIDO' : estado === 'PAUSED' ? 'Pausado' : 'Operativo'}
        </span>
        <span className="text-right text-slate-300">
          <div>{formatearLatencia(servicio.ultimaLatenciaMs)}</div>
          <div className="text-[10px] text-slate-400">{formatearFecha(servicio.ultimoCheckEn)}</div>
        </span>
      </div>
    </div>
  );
}
