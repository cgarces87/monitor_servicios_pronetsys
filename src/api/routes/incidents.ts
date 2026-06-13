import { FastifyInstance } from 'fastify';
import { prisma } from '../../db/prisma';
import { etiquetaEstadoGlpi } from '../../services/glpi';

/**
 * Rutas de incidentes:
 *   GET /api/incidents                         -> lista (mas recientes primero)
 *   GET /api/incidents?open=true              -> solo abiertos
 *   GET /api/incidents?serviceId=42           -> solo de un servicio
 *   GET /api/incidents?limit=200              -> hasta 500
 */
export async function registrarRutasIncidents(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { open?: string; limit?: string; serviceId?: string } }>(
    '/api/incidents',
    { preHandler: [app.authenticate] },
    async (req) => {
      const soloAbiertos = req.query.open === 'true';
      const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 500);
      const sid = Number(req.query.serviceId);
      const filtroServicio = Number.isFinite(sid) && sid > 0 ? sid : null;

      const where: { horaRecuperacion?: null; serviceId?: number } = {};
      if (soloAbiertos) where.horaRecuperacion = null;
      if (filtroServicio) where.serviceId = filtroServicio;

      const incidentes = await prisma.incident.findMany({
        where,
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
