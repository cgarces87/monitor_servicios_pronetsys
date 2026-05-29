import type { Summary } from '../types';

interface Props {
  summary: Summary | null;
}

function Card({ label, value, accent }: { label: string; value: number | string; accent: string }) {
  return (
    <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <div className="text-sm font-normal text-slate-500">{label}</div>
      <div className={`mt-1 text-3xl ${accent}`}>{value}</div>
    </div>
  );
}

export function SummaryCards({ summary }: Props) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      <Card label="Servicios" value={summary?.totalServicios ?? '—'} accent="text-brand" />
      <Card label="Operativos" value={summary?.up ?? '—'} accent="text-estado-up" />
      <Card label="Caidos" value={summary?.down ?? '—'} accent="text-estado-down" />
      <Card label="Pausados" value={summary?.paused ?? '—'} accent="text-estado-paused" />
      <Card
        label="Incidentes abiertos"
        value={summary?.incidentesAbiertos ?? '—'}
        accent={summary && summary.incidentesAbiertos > 0 ? 'text-estado-down' : 'text-slate-700'}
      />
    </div>
  );
}
