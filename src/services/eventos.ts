import { EventEmitter } from 'events';
import type { ServiceStatus } from '@prisma/client';

/**
 * Bus de eventos en memoria entre el motor y la API (corren en el mismo
 * proceso). La ruta /api/stream los reenvia por SSE al navegador, asi el
 * panel se actualiza al instante en vez de esperar al siguiente poll.
 */
export type EventoMonitor =
  | {
      tipo: 'check';
      serviceId: number;
      estado: ServiceStatus;
      latenciaMs: number;
      statusCode: number | null;
      ok: boolean;
      ts: string;
    }
  | { tipo: 'transicion'; serviceId: number; estado: ServiceStatus };

const bus = new EventEmitter();
// Un listener por pestana abierta: sin tope artificial.
bus.setMaxListeners(0);

export function emitirEvento(evento: EventoMonitor): void {
  bus.emit('evento', evento);
}

export function suscribirEventos(fn: (evento: EventoMonitor) => void): () => void {
  bus.on('evento', fn);
  return () => bus.off('evento', fn);
}
