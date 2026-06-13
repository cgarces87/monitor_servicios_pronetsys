import type { Incidente } from '../types';
import { formatearDuracion, formatearFecha } from '../utils/format';

interface Props {
  incidentes: Incidente[] | null;
  mostrarServicio?: boolean; // default true; en vistas filtradas por servicio se puede ocultar
}

export function IncidentList({ incidentes, mostrarServicio = true }: Props) {
  if (!incidentes) return <p className="text-slate-400">Cargando incidentes…</p>;
  if (incidentes.length === 0) {
    return (
      <p className="rounded-lg bg-white px-4 py-3 text-sm text-slate-500 ring-1 ring-slate-200">
        Sin incidentes registrados. Todo en orden.
      </p>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs font-normal uppercase tracking-wide text-slate-500">
          <tr>
            {mostrarServicio && <th className="px-4 py-2">Servicio</th>}
            <th className="px-4 py-2">Caida</th>
            <th className="px-4 py-2">Duracion</th>
            <th className="px-4 py-2">Estado (portal)</th>
            <th className="px-4 py-2">Ticket GLPI</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {incidentes.map((i) => (
            <tr key={i.id} className={i.abierto ? 'bg-red-50/50' : ''}>
              {mostrarServicio && (
                <td className="px-4 py-2">
                  <div className="text-slate-800">{i.servicioNombre}</div>
                  <div className="truncate text-xs font-normal text-slate-400">{i.detalleError ?? ''}</div>
                </td>
              )}
              <td className="px-4 py-2 font-normal text-slate-600">{formatearFecha(i.horaCaida)}</td>
              <td className="px-4 py-2 font-normal text-slate-600">{formatearDuracion(i.duracionMs)}</td>
              <td className="px-4 py-2">
                {i.abierto ? (
                  <span className="rounded-full bg-estado-down px-2 py-0.5 text-xs text-white">Abierto</span>
                ) : (
                  <span className="rounded-full bg-estado-up px-2 py-0.5 text-xs text-white">Resuelto</span>
                )}
              </td>
              <td className="px-4 py-2 font-normal text-slate-600">
                {i.glpiTicketId ? (
                  <div>
                    <div>#{i.glpiTicketId}</div>
                    {i.glpiEstadoLabel && (
                      <span
                        className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-xs ${
                          i.glpiEstado === 6
                            ? 'bg-slate-200 text-slate-600'
                            : i.glpiEstado === 5
                              ? 'bg-emerald-100 text-emerald-700'
                              : 'bg-blue-100 text-blue-700'
                        }`}
                      >
                        {i.glpiEstadoLabel}
                      </span>
                    )}
                  </div>
                ) : (
                  '—'
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
