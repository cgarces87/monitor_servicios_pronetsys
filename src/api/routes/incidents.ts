import { FastifyInstance } from 'fastify';
import { prisma } from '../../db/prisma';
import { etiquetaEstadoGlpi } from '../../services/glpi';

/**
 * Rutas de incidentes:
 *   GET /api/incidents            -> lista de incidentes (abiertos primero)
 *   GET /api/incidents?open=true  -> solo incidentes abiertos
 */
export async function registrarRutasIncidents(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { open?: string; limit?: string } }>(
    '/api/incidents',
    { preHandler: [app.authenticate] },
    async (req) => {
      const soloAbiertos = req.query.open === 'true';
      const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 500);

      const incidentes = await prisma.incident.findMany({
        where: soloAbiertos ? { horaRecuperacion: null } : undefined,
        orderBy: { horaCaida: 'desc' },
        take: limit,
        include: {
          service: { select: { nombre: true, url: true } },
        },
      });

      return incidentes.map((i) => ({
        id: i.id,
        serviceId: i.serviceId,
        servicioNombre: i.service.nombre,
        servicioUrl: i.service.url,
        horaCaida: i.horaCaida,
        horaRecuperacion: i.horaRecuperacion,
        abierto: i.horaRecuperacion === null,
        duracionMs:
          i.horaRecuperacion === null
            ? Date.now() - i.horaCaida.getTime()
            : i.horaRecuperacion.getTime() - i.horaCaida.getTime(),
        detalleError: i.detalleError,
        glpiTicketId: i.glpiTicketId,
        glpiEstado: i.glpiEstado,
        glpiEstadoLabel: etiquetaEstadoGlpi(i.glpiEstado),
        glpiEstadoSyncEn: i.glpiEstadoSyncEn,
      }));
    },
  );
}
