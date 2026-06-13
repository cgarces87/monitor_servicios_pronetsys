import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { ServicioResumen, UptimeStats } from '../types';
import { formatearFecha, formatearLatencia, objetivoServicio } from '../utils/format';
import { StatusBadge } from './StatusBadge';
import { LatencyChart } from './LatencyChart';

interface Props {
  servicio: ServicioResumen;
  isAdmin: boolean;
  onEdit: (s: ServicioResumen) => void;
  onChanged: () => void;
}

export function ServiceCard({ servicio, isAdmin, onEdit, onChanged }: Props) {
  const [uptime, setUptime] = useState<UptimeStats | null>(null);
  const [accionEnCurso, setAccionEnCurso] = useState(false);

  useEffect(() => {
    let activo = true;
    api
      .uptime(servicio.id, '24h')
      .then((d) => activo && setUptime(d))
      .catch(() => activo && setUptime(null));
    return () => {
      activo = false;
    };
  }, [servicio.id]);

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
    <div className="flex flex-col rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
      <div className="flex items-start justify-between gap-3 px-4 pt-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-base text-slate-800">{servicio.nombre}</div>
          <div className="truncate text-xs font-normal text-slate-400">
            <span className="mr-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase text-slate-500">
              {servicio.tipo}
            </span>
            {objetivoServicio(servicio)}
          </div>
        </div>
        <StatusBadge estado={servicio.estadoActual} />
      </div>

      <div className="px-2 pt-2">
        <LatencyChart serviceId={servicio.id} heightClass="h-32" limit={40} />
      </div>

      <div className="grid grid-cols-2 gap-2 px-4 pt-1 text-xs">
        <Stat label="Ahora" value={formatearLatencia(servicio.ultimaLatenciaMs)} />
        <Stat label="Uptime 24h" value={uptime?.uptimePct != null ? `${uptime.uptimePct}%` : '—'} />
        <Stat label="Promedio" value={formatearLatencia(uptime?.latenciaPromedioMs ?? null)} />
        <Stat
          label="Min / Max"
          value={
            uptime
              ? `${uptime.latenciaMinMs ?? '—'} / ${uptime.latenciaMaxMs ?? '—'} ms`
              : '—'
          }
        />
      </div>

      <div className="px-4 pb-3 pt-2 text-[11px] font-normal text-slate-400">
        Ultimo check: {formatearFecha(servicio.ultimoCheckEn)}
      </div>

      {isAdmin && (
        <div className="flex flex-wrap gap-2 border-t border-slate-100 px-4 py-2">
          <button
            onClick={() => onEdit(servicio)}
            className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-normal text-slate-600 hover:bg-slate-50"
          >
            Editar
          </button>
          <button
            onClick={() => void pausarReanudar()}
            disabled={accionEnCurso}
            className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-normal text-slate-600 hover:bg-slate-50 disabled:opacity-60"
          >
            {servicio.estadoActual === 'PAUSED' ? 'Reanudar' : 'Pausar'}
          </button>
          <button
            onClick={() => void eliminar()}
            disabled={accionEnCurso}
            className="rounded-lg border border-red-300 px-3 py-1 text-xs font-normal text-red-600 hover:bg-red-50 disabled:opacity-60"
          >
            Eliminar
          </button>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className="font-normal text-slate-700">{value}</div>
    </div>
  );
}
