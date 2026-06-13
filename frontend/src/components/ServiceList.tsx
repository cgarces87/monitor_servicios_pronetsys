import type { ServicioResumen } from '../types';
import { ServiceRow } from './ServiceRow';
import { ServiceCard } from './ServiceCard';

export type VistaServicios = 'lista' | 'cuadricula';

interface Props {
  servicios: ServicioResumen[] | null;
  loading: boolean;
  isAdmin: boolean;
  vista: VistaServicios;
  onEdit: (s: ServicioResumen) => void;
  onChanged: () => void;
}

export function ServiceList({ servicios, loading, isAdmin, vista, onEdit, onChanged }: Props) {
  if (loading && !servicios) {
    return <p className="text-slate-400">Cargando servicios…</p>;
  }
  if (!servicios || servicios.length === 0) {
    return <p className="text-slate-400">No hay servicios registrados todavia.</p>;
  }

  if (vista === 'cuadricula') {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {servicios.map((s) => (
          <ServiceCard
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
