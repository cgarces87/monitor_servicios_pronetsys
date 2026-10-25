import { useEffect, useRef, useState } from 'react';
import type { EventoMonitor } from '../types';

/**
 * Se suscribe a /api/stream (Server-Sent Events) y entrega cada evento del
 * motor a `onEvento`. Devuelve si la conexion esta viva: si no lo esta (proxy
 * sin soporte, backend reiniciando) el panel sigue funcionando por polling.
 * EventSource reconecta solo; la cookie de sesion viaja por ser mismo origen.
 */
export function useLiveEvents(onEvento: (e: EventoMonitor) => void): boolean {
  const [conectado, setConectado] = useState(false);
  const onEventoRef = useRef(onEvento);
  onEventoRef.current = onEvento;

  useEffect(() => {
    const fuente = new EventSource('/api/stream', { withCredentials: true });
    fuente.onopen = () => setConectado(true);
    fuente.onerror = () => setConectado(false);
    fuente.onmessage = (msg) => {
      try {
        onEventoRef.current(JSON.parse(msg.data) as EventoMonitor);
      } catch {
        /* evento malformado: se ignora */
      }
    };
    return () => fuente.close();
  }, []);

  return conectado;
}
