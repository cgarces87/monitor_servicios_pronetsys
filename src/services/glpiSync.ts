import { prisma } from '../db/prisma';
import { log } from '../utils/logger';
import { glpi } from './glpi';

const STATUS_CERRADO = 6;

/**
 * Sincronizacion inversa GLPI -> portal.
 *
 * Para cada incidente con glpiTicketId cuyo estado aun NO es "Cerrado" (6),
 * consulta el status actual del ticket en GLPI y lo guarda en glpiEstado.
 * Una vez el ticket queda Cerrado, deja de consultarse (no entra al filtro).
 *
 * Tolerante a fallos: si GLPI no responde para un ticket, se omite ese y se
 * sigue con los demas. NUNCA cambia el estado del servicio (UP/DOWN); solo
 * refleja el estado del ticket.
 */
export async function sincronizarEstadosGlpi(): Promise<void> {
  if (!glpi.estaConfigurado()) return;

  const incidentes = await prisma.incident.findMany({
    where: {
      glpiTicketId: { not: null },
      OR: [{ glpiEstado: null }, { glpiEstado: { not: STATUS_CERRADO } }],
    },
    select: { id: true, glpiTicketId: true, glpiEstado: true },
    take: 200,
  });

  if (incidentes.length === 0) return;

  let actualizados = 0;
  let eliminados = 0;
  for (const inc of incidentes) {
    if (inc.glpiTicketId === null) continue;
    const r = await glpi.obtenerEstadoTicket(inc.glpiTicketId);

    if (r.tipo === 'error') continue; // fallo transitorio: se reintenta el proximo ciclo

    if (r.tipo === 'no_encontrado') {
      // GLPI confirma que el ticket fue eliminado -> borramos el incidente huerfano.
      await prisma.incident.delete({ where: { id: inc.id } });
      eliminados++;
      log.warn(`GLPI sync: ticket #${inc.glpiTicketId} no existe en GLPI -> incidente #${inc.id} eliminado del portal.`);
      continue;
    }

    // r.tipo === 'ok'
    const cambio = r.status !== inc.glpiEstado;
    await prisma.incident.update({
      where: { id: inc.id },
      data: { glpiEstado: r.status, glpiEstadoSyncEn: new Date() },
    });
    if (cambio) {
      actualizados++;
      log.info(`GLPI sync: ticket #${inc.glpiTicketId} (incidente #${inc.id}) cambio a estado ${r.status}.`);
    }
  }

  if (actualizados > 0 || eliminados > 0) {
    log.info(`GLPI sync: ${actualizados} incidente(s) actualizados, ${eliminados} eliminados.`);
  }
}
