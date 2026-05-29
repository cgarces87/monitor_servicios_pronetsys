import type { ServicioResumen } from '../types';
import { ServiceRow } from './ServiceRow';

interface Props {
  servicios: ServicioResumen[] | null;
  loading: boolean;
  isAdmin: boolean;
  onEdit: (s: ServicioResumen) => void;
  onChanged: () => void;
}

export function ServiceList({ servicios, loading, isAdmin, onEdit, onChanged }: Props) {
  if (loading && !servicios) {
    return <p className="text-slate-400">Cargando servicios…</p>;
  }
  if (!servicios || servicios.length === 0) {
    return <p className="text-slate-400">No hay servicios registrados todavia.</p>;
  }

  return (
    <div className="space-y-2">
      {servicios.map((s) => (
        <ServiceRow
          key={s.id}
          servicio={s}
          isAdmin={isAdmin}
          onEdit={onEdit}
          onChanged={onChanged}
        />
      ))}
    </div>
  );
}
