import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { Incidente } from '../types';
import { IncidentList } from './IncidentList';

type Filtro = 'todos' | 'abiertos';

export function IncidentsView() {
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [data, setData] = useState<Incidente[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let activo = true;
    setData(null);
    setError(null);
    api
      .incidents({ open: filtro === 'abiertos', limit: 200 })
      .then((d) => activo && setData(d))
      .catch((e) => activo && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      activo = false;
    };
  }, [filtro]);

  const opt = (v: Filtro, label: string) => (
    <button
      type="button"
      onClick={() => setFiltro(v)}
      className={`rounded px-3 py-1 text-sm transition ${
        filtro === v ? 'bg-brand text-white' : 'font-normal text-slate-600 hover:bg-slate-50'
      }`}
    >
      {label}
    </button>
  );

  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-xl text-slate-800">Incidentes</h2>
          <div className="flex items-center gap-0.5 rounded-lg border border-slate-300 p-0.5">
            {opt('todos', 'Todos')}
            {opt('abiertos', 'Solo abiertos')}
          </div>
        </div>
        {data && (
          <span className="text-xs font-normal text-slate-400">
            {data.length} {data.length === 1 ? 'incidente' : 'incidentes'}
          </span>
        )}
      </div>

      {error ? (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-200">
          Error: {error}
        </p>
      ) : (
        <IncidentList incidentes={data} />
      )}
    </section>
  );
}
