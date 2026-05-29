import type { EstadoServicio } from '../types';

const estilos: Record<EstadoServicio, { bg: string; label: string }> = {
  UP: { bg: 'bg-estado-up', label: 'Operativo' },
  DOWN: { bg: 'bg-estado-down', label: 'Caido' },
  PAUSED: { bg: 'bg-estado-paused', label: 'Pausado' },
};

export function StatusBadge({ estado }: { estado: EstadoServicio }) {
  const { bg, label } = estilos[estado];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs text-white ${bg}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-white/90" />
      {label}
    </span>
  );
}
