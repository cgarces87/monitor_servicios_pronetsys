import { FastifyInstance } from 'fastify';
import { suscribirEventos } from '../../services/eventos';

const PING_MS = 15_000;

/**
 * Eventos en vivo del motor via Server-Sent Events:
 *   GET /api/stream   -> text/event-stream, un `data: {json}` por evento
 *
 * El navegador (EventSource) reconecta solo si se cae la conexion. Detras de
 * Nginx, `X-Accel-Buffering: no` desactiva el buffer del proxy para esta
 * respuesta y el ping mantiene viva la conexion dentro de proxy_read_timeout.
 */
export async function registrarRutaStream(app: FastifyInstance): Promise<void> {
  app.get('/api/stream', { preHandler: [app.authenticate] }, (req, reply) => {
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 5000\n\n');

    const desuscribir = suscribirEventos((evento) => {
      res.write(`data: ${JSON.stringify(evento)}\n\n`);
    });
    const ping = setInterval(() => res.write(': ping\n\n'), PING_MS);

    req.raw.on('close', () => {
      clearInterval(ping);
      desuscribir();
    });
  });
}
