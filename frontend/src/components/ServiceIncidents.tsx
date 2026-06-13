import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { Incidente } from '../types';
import { IncidentList } from './IncidentList';

interface Props {
  serviceId: number;
  limit?: number; // default 10
}

/** Carga y muestra los ultimos N incidentes de un servicio especifico. */
export function ServiceIncidents({ serviceId, limit = 10 }: Props) {
  const [data, setData] = useState<Incidente[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let activo = true;
    api
      .incidents({ serviceId, limit })
      .then((d) => activo && setData(d))
      .catch((e) => activo && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      activo = false;
    };
  }, [serviceId, limit]);

  if (error) return <p className="text-xs text-estado-down">Error cargando incidentes: {error}</p>;
  if (!data) return <p className="text-xs text-slate-400">Cargando incidentes…</p>;
  return <IncidentList incidentes={data} mostrarServicio={false} />;
}
