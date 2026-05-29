import { FastifyInstance } from 'fastify';
import { ServiceStatus } from '@prisma/client';
import { prisma } from '../../db/prisma';

/**
 * Resumen para las tarjetas del dashboard:
 *   GET /api/summary
 */
export async function registrarRutasSummary(app: FastifyInstance): Promise<void> {
  app.get('/api/summary', { preHandler: [app.authenticate] }, async () => {
    const [total, up, down, paused, incidentesAbiertos] = await Promise.all([
      prisma.service.count(),
      prisma.service.count({ where: { estadoActual: ServiceStatus.UP } }),
      prisma.service.count({ where: { estadoActual: ServiceStatus.DOWN } }),
      prisma.service.count({ where: { estadoActual: ServiceStatus.PAUSED } }),
      prisma.incident.count({ where: { horaRecuperacion: null } }),
    ]);

    return {
      totalServicios: total,
      up,
      down,
      paused,
      incidentesAbiertos,
      ts: new Date().toISOString(),
    };
  });
}
