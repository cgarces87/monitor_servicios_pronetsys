import { useEffect, useState } from 'react';
import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '../api/client';
import type { LogPunto } from '../types';

interface Props {
  serviceId: number;
}

export function LatencyChart({ serviceId }: Props) {
  const [logs, setLogs] = useState<LogPunto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let activo = true;
    api
      .logs(serviceId, 100)
      .then((d) => activo && setLogs(d))
      .catch((e) => activo && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      activo = false;
    };
  }, [serviceId]);

  if (error) return <p className="text-sm text-estado-down">Error cargando latencia: {error}</p>;
  if (!logs) return <p className="text-sm text-slate-400">Cargando grafico…</p>;
  if (logs.length === 0) return <p className="text-sm text-slate-400">Sin datos aun.</p>;

  const data = logs.map((l) => ({
    hora: new Date(l.timestamp).toLocaleTimeString('es-CO', {
      hour: '2-digit',
      minute: '2-digit',
    }),
    latencia: l.latenciaMs,
  }));

  return (
    <div className="h-48 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 5, right: 10, bottom: 0, left: -10 }}>
          <XAxis dataKey="hora" tick={{ fontSize: 11 }} minTickGap={30} />
          <YAxis tick={{ fontSize: 11 }} width={45} unit="ms" />
          <Tooltip formatter={(v: number) => [`${v} ms`, 'Latencia']} />
          <Line
            type="monotone"
            dataKey="latencia"
            stroke="#0065cb"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
