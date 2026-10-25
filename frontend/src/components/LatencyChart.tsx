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
  heightClass?: string; // tailwind h-*, default h-48
  limit?: number;       // cuantos puntos historicos pedir
  // Puntos ya cargados (p.ej. el sparkline de /api/services): si vienen, no
  // se hace otra peticion y el grafico se actualiza con los eventos en vivo.
  data?: LogPunto[];
}

export function LatencyChart({ serviceId, heightClass = 'h-48', limit = 100, data }: Props) {
  const [logs, setLogs] = useState<LogPunto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (data) return;
    let activo = true;
    api
      .logs(serviceId, limit)
      .then((d) => activo && setLogs(d))
      .catch((e) => activo && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      activo = false;
    };
  }, [serviceId, limit, data]);

  const puntos = data ?? logs;

  if (!data && error) return <p className="text-sm text-estado-down">Error cargando latencia: {error}</p>;
  if (!puntos) return <div className={`${heightClass} w-full animate-pulse rounded-lg bg-slate-100`} />;
  if (puntos.length === 0) return <p className="text-sm text-slate-400">Sin datos aun.</p>;

  const serie = puntos.map((l) => ({
    hora: new Date(l.timestamp).toLocaleTimeString('es-CO', {
      hour: '2-digit',
      minute: '2-digit',
    }),
    latencia: l.latenciaMs,
    ok: l.ok,
  }));

  return (
    <div className={`${heightClass} w-full`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={serie} margin={{ top: 5, right: 10, bottom: 0, left: 0 }}>
          <XAxis dataKey="hora" tick={{ fontSize: 11 }} minTickGap={30} />
          <YAxis tick={{ fontSize: 11 }} width={44} tickFormatter={formatearEje} />
          <Tooltip
            formatter={(v: number, _n, item) => [`${v} ms${item.payload.ok ? '' : ' (fallo)'}`, 'Latencia']}
          />
          <Line
            type="monotone"
            dataKey="latencia"
            stroke="#0065cb"
            strokeWidth={2}
            dot={PuntoFallido}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// Eje compacto: "250ms", "1.5s"; asi "3000ms" no se recorta en tarjetas angostas.
function formatearEje(v: number): string {
  return v >= 1000 ? `${Number((v / 1000).toFixed(1))}s` : `${v}ms`;
}

// Marca en rojo los chequeos fallidos; los exitosos no llevan punto.
function PuntoFallido(props: { cx?: number; cy?: number; index?: number; payload?: { ok: boolean } }) {
  const { cx, cy, index, payload } = props;
  if (payload?.ok !== false || cx === undefined || cy === undefined) return <g key={index} />;
  return <circle key={index} cx={cx} cy={cy} r={2.5} fill="#dc2626" />;
}
