import { useState } from 'react';
import { AnimatePresence } from 'motion/react';
import * as m from 'motion/react-m';
import { api } from '../api/client';
import type { ServicioResumen } from '../types';
import { formatearFecha, formatearIntervalo, formatearLatencia, objetivoServicio } from '../utils/format';
import { StatusBadge } from './StatusBadge';
import { LatencyChart } from './LatencyChart';
import { ServiceIncidents } from './ServiceIncidents';

interface Props {
  servicio: ServicioResumen;
  isAdmin: boolean;
  onEdit: (s: ServicioResumen) => void;
  onChanged: () => void;
}

export function ServiceRow({ servicio, isAdmin, onEdit, onChanged }: Props) {
  const [abierto, setAbierto] = useState(false);
  const uptime = servicio.uptime24h;
  const [accionEnCurso, setAccionEnCurso] = useState(false);

  const pausarReanudar = async (): Promise<void> => {
    setAccionEnCurso(true);
    try {
      await api.setServiceState(servicio.id, servicio.estadoActual === 'PAUSED' ? 'resume' : 'pause');
      onChanged();
    } finally {
      setAccionEnCurso(false);
    }
  };

  const eliminar = async (): Promise<void> => {
    if (!confirm(`¿Eliminar "${servicio.nombre}"? Se borraran sus logs e incidentes.`)) return;
    setAccionEnCurso(true);
    try {
      await api.deleteService(servicio.id);
      onChanged();
    } finally {
      setAccionEnCurso(false);
    }
  };

  return (
    <div className="rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
      <button
        onClick={() => setAbierto((v) => !v)}
        className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left"
        aria-expanded={abierto}
      >
        <div className="min-w-0 flex-1">
          <div className="truncate text-base text-slate-800">{servicio.nombre}</div>
          <div className="truncate text-xs font-normal text-slate-400">
            <span className="mr-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase text-slate-500">
              {servicio.tipo}
            </span>
            {objetivoServicio(servicio)}
          </div>
        </div>
        <div className="hidden text-right text-xs font-normal text-slate-500 sm:block">
          <div>Latencia: {formatearLatencia(servicio.ultimaLatenciaMs)}</div>
          <div>Ultimo: {formatearFecha(servicio.ultimoCheckEn)}</div>
          <div>Chequeo: {formatearIntervalo(servicio.intervaloMonitoreo)}</div>
        </div>
        <StatusBadge estado={servicio.estadoActual} />
        <span
          className={`text-slate-400 transition-transform duration-200 ${abierto ? 'rotate-180' : ''}`}
          aria-hidden="true"
        >
          ▼
        </span>
      </button>

      <AnimatePresence initial={false}>
        {abierto && (
          <m.div
            key="detalle"
            className="overflow-hidden"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
          >
            <div className="border-t border-slate-100 px-4 py-4">
              <div className="mb-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <Stat label="Uptime 24h" value={uptime?.uptimePct != null ? `${uptime.uptimePct}%` : '—'} />
                <Stat label="Latencia prom." value={formatearLatencia(uptime?.latenciaPromedioMs ?? null)} />
                <Stat label="Min / Max" value={uptime ? `${uptime.latenciaMinMs ?? '—'} / ${uptime.latenciaMaxMs ?? '—'} ms` : '—'} />
                <Stat label="Muestras" value={uptime?.muestras?.toString() ?? '—'} />
              </div>

              <LatencyChart serviceId={servicio.id} />

              <div className="mt-4 border-t border-slate-100 pt-3">
                <div className="mb-2 text-xs font-normal uppercase tracking-wide text-slate-500">
                  Incidentes de este servicio
                </div>
                <ServiceIncidents serviceId={servicio.id} />
              </div>

              {isAdmin && (
                <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                  <button
                    onClick={() => onEdit(servicio)}
                    className="rounded-lg border border-slate-300 px-3 py-1 text-sm font-normal text-slate-600 hover:bg-slate-50"
                  >
                    Editar
                  </button>
                  <button
                    onClick={() => void pausarReanudar()}
                    disabled={accionEnCurso}
                    className="rounded-lg border border-slate-300 px-3 py-1 text-sm font-normal text-slate-600 hover:bg-slate-50 disabled:opacity-60"
                  >
                    {servicio.estadoActual === 'PAUSED' ? 'Reanudar' : 'Pausar'}
                  </button>
                  <button
                    onClick={() => void eliminar()}
                    disabled={accionEnCurso}
                    className="rounded-lg border border-red-300 px-3 py-1 text-sm font-normal text-red-600 hover:bg-red-50 disabled:opacity-60"
                  >
                    Eliminar
                  </button>
                </div>
              )}
            </div>
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2">
      <div className="text-xs font-normal text-slate-500">{label}</div>
      <div className="text-slate-800">{value}</div>
    </div>
  );
}
