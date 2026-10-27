import { ServiceStatus } from '@prisma/client';
import { env } from '../config/env';
import { prisma } from '../db/prisma';
import { log } from '../utils/logger';
import { glpi, type SolucionesTicket } from './glpi';
import { sincronizarCierreGlpi } from './stateManager';

const STATUS_RESUELTO = 5;
const STATUS_CERRADO = 6;

type IncidenteSync = Awaited<ReturnType<typeof buscarIncidentes>>[number];

function buscarIncidentes() {
  return prisma.incident.findMany({
    where: {
      glpiTicketId: { not: null },
      OR: [{ glpiEstado: null }, { glpiEstado: { not: STATUS_CERRADO } }],
    },
    select: {
      id: true,
      glpiTicketId: true,
      glpiEstado: true,
      horaRecuperacion: true,
      serviceId: true,
      service: {
        select: { nombre: true, tipo: true, url: true, host: true, puerto: true, estadoActual: true },
      },
    },
    take: 200,
  });
}

/**
 * Sincronizacion inversa GLPI -> portal.
 *
 * Para cada incidente con glpiTicketId cuyo estado aun NO es "Cerrado" (6),
 * consulta el status actual del ticket en GLPI y lo guarda en glpiEstado.
 * Una vez el ticket queda Cerrado, deja de consultarse (no entra al filtro).
 *
 * Ademas reintenta resolver los tickets que quedaron abiertos aunque el
 * servicio ya se normalizo (ver debeReintentarCierre).
 *
 * Tolerante a fallos: si GLPI no responde para un ticket, se omite ese y se
 * sigue con los demas. NUNCA cambia el estado del servicio (UP/DOWN); solo
 * refleja el estado del ticket.
 */
export async function sincronizarEstadosGlpi(): Promise<void> {
  if (!glpi.estaConfigurado()) return;

  const incidentes = await buscarIncidentes();

  if (incidentes.length === 0) return;

  let actualizados = 0;
  let eliminados = 0;
  let reintentados = 0;
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
    let status = r.status;
    const soluciones = status < STATUS_RESUELTO ? await debeReintentarCierre(inc, r.creadorId) : null;
    if (soluciones) {
      if (await reintentarCierre(inc, soluciones)) {
        status = env.glpi.resolveMode === 'closed' ? STATUS_CERRADO : STATUS_RESUELTO;
        reintentados++;
      }
    }

    const cambio = status !== inc.glpiEstado;
    await prisma.incident.update({
      where: { id: inc.id },
      data: { glpiEstado: status, glpiEstadoSyncEn: new Date() },
    });
    if (cambio) {
      actualizados++;
      log.info(`GLPI sync: ticket #${inc.glpiTicketId} (incidente #${inc.id}) cambio a estado ${status}.`);
    }
  }

  if (actualizados > 0 || eliminados > 0 || reintentados > 0) {
    log.info(`GLPI sync: ${actualizados} incidente(s) actualizados, ${eliminados} eliminados, ${reintentados} cierre(s) reintentados.`);
  }
}

/**
 * Un ticket abierto (status 1..4) se vuelve a resolver solo si se cumple TODO:
 *  1. Lo abrio el monitoreo: esta vinculado a un incidente (solo el motor
 *     escribe glpiTicketId) y su creador en GLPI es el usuario del monitor.
 *  2. Se normalizo: el servicio esta UP y el incidente ya registro la
 *     recuperacion; o el incidente quedo abierto pero el ultimo chequeo fue OK.
 *  3. Ninguna solucion del ticket es de otro usuario ni fue rechazada: si lo
 *     esta, alguien de la mesa lo reabrio a proposito y no se toca.
 *
 * Devuelve las soluciones del ticket si hay que reintentar, null si no.
 */
async function debeReintentarCierre(
  inc: IncidenteSync,
  creadorId: number | null,
): Promise<SolucionesTicket | null> {
  const monitorId = await glpi.idUsuarioMonitor();
  if (monitorId === null || creadorId !== monitorId) return null;

  if (inc.service.estadoActual !== ServiceStatus.UP) return null;
  if (!inc.horaRecuperacion) {
    const ultimo = await prisma.log.findFirst({
      where: { serviceId: inc.serviceId },
      orderBy: { timestamp: 'desc' },
      select: { errorMsg: true },
    });
    if (!ultimo || ultimo.errorMsg !== null) return null;
  }

  const soluciones = await glpi.revisarSoluciones(inc.glpiTicketId as number);
  return soluciones && soluciones.bloqueantes === 0 ? soluciones : null;
}

async function reintentarCierre(inc: IncidenteSync, soluciones: SolucionesTicket): Promise<boolean> {
  const ticketId = inc.glpiTicketId as number;
  log.info(`GLPI sync: ticket #${ticketId} sigue abierto con "${inc.service.nombre}" normalizado; reintentando cierre.`, {
    incidentId: inc.id,
  });

  // Si ya hay una solucion del monitor, el cierre anterior quedo a medias:
  // solo falta forzar el status, sin agregar otra solucion.
  const ok = await sincronizarCierreGlpi(
    inc.service,
    inc.id,
    ticketId,
    inc.horaRecuperacion ?? new Date(),
    soluciones.propias > 0,
  );
  if (ok && !inc.horaRecuperacion) {
    // El incidente habia quedado abierto con el servicio ya UP: se cierra
    // tambien en el portal (solo si nadie lo cerro mientras tanto).
    await prisma.incident.updateMany({
      where: { id: inc.id, horaRecuperacion: null },
      data: { horaRecuperacion: new Date() },
    });
  }
  return ok;
}
