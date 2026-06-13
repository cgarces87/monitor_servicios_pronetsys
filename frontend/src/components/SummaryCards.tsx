import type { EstadoServicio, Summary } from '../types';

interface Props {
  summary: Summary | null;
  filtroEstado: EstadoServicio | null;
  filtroIncidentesAbiertos: boolean;
  onToggleFiltroEstado: (estado: 'DOWN' | 'PAUSED') => void;
  onToggleFiltroIncidentes: () => void;
}

function Card({
  label,
  value,
  accent,
  active,
  onClick,
}: {
  label: string;
  value: number | string;
  accent: string;
  active?: boolean;
  onClick?: () => void;
}) {
  const base = 'rounded-xl bg-white p-4 shadow-sm ring-1 transition';
  const ringCls = active ? 'ring-2 ring-brand' : 'ring-slate-200';

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`${base} ${ringCls} cursor-pointer text-left hover:ring-slate-300`}
      >
        <div className="text-sm font-normal text-slate-500">{label}</div>
        <div className={`mt-1 text-3xl ${accent}`}>{value}</div>
        <div className={`mt-1 text-[10px] uppercase tracking-wide ${active ? 'text-brand' : 'text-slate-300'}`}>
          {active ? 'Filtro activo · clic para quitar' : 'Clic para ver cuales'}
        </div>
      </button>
    );
  }

  return (
    <div className={`${base} ${ringCls}`}>
      <div className="text-sm font-normal text-slate-500">{label}</div>
      <div className={`mt-1 text-3xl ${accent}`}>{value}</div>
    </div>
  );
}

export function SummaryCards({
  summary,
  filtroEstado,
  filtroIncidentesAbiertos,
  onToggleFiltroEstado,
  onToggleFiltroIncidentes,
}: Props) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      <Card label="Servicios" value={summary?.totalServicios ?? '—'} accent="text-brand" />
      <Card label="Operativos" value={summary?.up ?? '—'} accent="text-estado-up" />
      <Card
        label="Caidos"
        value={summary?.down ?? '—'}
        accent="text-estado-down"
        active={filtroEstado === 'DOWN'}
        onClick={() => onToggleFiltroEstado('DOWN')}
      />
      <Card
        label="Pausados"
        value={summary?.paused ?? '—'}
        accent="text-estado-paused"
        active={filtroEstado === 'PAUSED'}
        onClick={() => onToggleFiltroEstado('PAUSED')}
      />
      <Card
        label="Incidentes abiertos"
        value={summary?.incidentesAbiertos ?? '—'}
        accent={summary && summary.incidentesAbiertos > 0 ? 'text-estado-down' : 'text-slate-700'}
        active={filtroIncidentesAbiertos}
        onClick={onToggleFiltroIncidentes}
      />
    </div>
  );
}
