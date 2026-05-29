import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { env } from '../config/env';
import { log } from '../utils/logger';
import { registrarAuth } from './auth';
import { registrarRutasServices } from './routes/services';
import { registrarRutasIncidents } from './routes/incidents';
import { registrarRutasSummary } from './routes/summary';
import { registrarRutasUsers } from './routes/users';

// Prisma usa BigInt en Log.id; JSON.stringify no sabe serializar BigInt.
// Lo convertimos a number de forma global para todas las respuestas.
(BigInt.prototype as unknown as { toJSON: () => number }).toJSON = function (
  this: bigint,
): number {
  return Number(this);
};

export async function crearServidorApi(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  await app.register(cors, {
    origin: env.api.corsOrigin === '*' ? true : env.api.corsOrigin.split(','),
    credentials: true,
  });

  // Ruta publica (sin auth).
  app.get('/api/health', async () => ({ ok: true, ts: new Date().toISOString() }));

  // Auth se registra directo sobre la raiz (no via register) para que los
  // decoradores authenticate/requireAdmin queden disponibles a las rutas hijas.
  await registrarAuth(app);

  await app.register(registrarRutasSummary);
  await app.register(registrarRutasServices);
  await app.register(registrarRutasIncidents);
  await app.register(registrarRutasUsers);

  return app;
}

export async function iniciarApi(): Promise<FastifyInstance | null> {
  if (!env.api.enabled) {
    log.info('API HTTP deshabilitada (API_ENABLED=false).');
    return null;
  }

  const app = await crearServidorApi();
  await app.listen({ port: env.api.port, host: env.api.host });
  log.info(`API HTTP escuchando en http://${env.api.host}:${env.api.port}`);
  return app;
}
