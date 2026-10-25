import { AnimatePresence } from 'motion/react';
import * as m from 'motion/react-m';
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

// Cuando un servicio cae sube al inicio de la lista: la animacion de layout
// muestra a donde se movio en vez de que las tarjetas "teletransporten".
const MOVER = { layout: { duration: 0.25, ease: [0.77, 0, 0.175, 1] as const } };

export function ServiceList({ servicios, loading, isAdmin, vista, onEdit, onChanged }: Props) {
  if (loading && !servicios) {
    return <EsqueletoLista vista={vista} />;
  }
  if (!servicios || servicios.length === 0) {
    return <p className="text-slate-400">No hay servicios registrados todavia.</p>;
  }

  const items = servicios.map((s) => (
    <m.div
      key={s.id}
      layout="position"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ ...MOVER, opacity: { duration: 0.15 } }}
    >
      {vista === 'cuadricula' ? (
        <ServiceCard servicio={s} isAdmin={isAdmin} onEdit={onEdit} onChanged={onChanged} />
      ) : (
        <ServiceRow servicio={s} isAdmin={isAdmin} onEdit={onEdit} onChanged={onChanged} />
      )}
    </m.div>
  ));

  // key={vista}: cambiar lista<->cuadricula es instantaneo (se remonta), no
  // una animacion de todas las tarjetas a su nueva posicion.
  return (
    <div key={vista} className={vista === 'cuadricula' ? 'grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3' : 'space-y-2'}>
      <AnimatePresence initial={false} mode="popLayout">
        {items}
      </AnimatePresence>
    </div>
  );
}

function EsqueletoLista({ vista }: { vista: VistaServicios }) {
  const alto = vista === 'cuadricula' ? 'h-72' : 'h-16';
  return (
    <div className={vista === 'cuadricula' ? 'grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3' : 'space-y-2'}>
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className={`${alto} animate-pulse rounded-xl bg-white ring-1 ring-slate-200`} />
      ))}
    </div>
  );
}
