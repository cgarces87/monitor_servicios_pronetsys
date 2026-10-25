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
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs text-white transition-colors duration-200 ${bg}`}
    >
      <span className="relative flex h-1.5 w-1.5">
        {/* Halo continuo solo en CAIDO: es una alarma que debe verse de reojo.
            Animacion CSS (fuera del hilo principal), apagada con reduced-motion. */}
        {estado === 'DOWN' && (
          <span className="absolute inline-flex h-full w-full rounded-full bg-white/80 motion-safe:animate-ping" />
        )}
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-white/90" />
      </span>
      {label}
    </span>
  );
}
