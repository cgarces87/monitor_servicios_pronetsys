import type { ServicioResumen } from '../types';

export function formatearFecha(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('es-CO', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatearDuracion(ms: number): string {
  const seg = Math.floor(ms / 1000);
  const min = Math.floor(seg / 60);
  const horas = Math.floor(min / 60);
  const dias = Math.floor(horas / 24);

  if (dias > 0) return `${dias}d ${horas % 24}h`;
  if (horas > 0) return `${horas}h ${min % 60}m`;
  if (min > 0) return `${min}m ${seg % 60}s`;
  return `${seg}s`;
}

export function formatearLatencia(ms: number | null): string {
  if (ms === null) return '—';
  return `${ms} ms`;
}

/** Texto del objetivo monitoreado: la URL (HTTP) o host:puerto (TCP). */
export function objetivoServicio(s: Pick<ServicioResumen, 'tipo' | 'url' | 'host' | 'puerto'>): string {
  if (s.tipo === 'TCP') return `${s.host ?? '?'}:${s.puerto ?? '?'}`;
  return s.url ?? '';
}

/** Intervalo (en segundos) en texto amigable: "cada 30 s", "cada 5 min", "cada 2 h". */
export function formatearIntervalo(segundos: number): string {
  if (segundos >= 3600 && segundos % 3600 === 0) return `cada ${segundos / 3600} h`;
  if (segundos >= 60 && segundos % 60 === 0) return `cada ${segundos / 60} min`;
  return `cada ${segundos} s`;
}
