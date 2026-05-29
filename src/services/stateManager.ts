import { Service, ServiceStatus } from '@prisma/client';
import { prisma } from '../db/prisma';
import { log } from '../utils/logger';
import type { CheckResult } from './checker';
import { glpi } from './glpi';
import { whatsapp } from './whatsapp';

/**
 * Aplica la transicion de estado de un servicio a partir del resultado del chequeo.
 *
 *   estado anterior  resultado   accion
 *   ---------------  ----------  -----------------------------------------------
 *   UP               ok          (sin cambios)
 *   UP               !ok         -> DOWN  + abrir Incident + crear ticket GLPI
 *   DOWN             ok          -> UP    + cerrar Incident + resolver ticket GLPI
 *   DOWN             !ok         (sin cambios — incidente sigue abierto)
 *   PAUSED           cualquiera  no deberia llegar aqui (el monitor lo filtra)
 *
 * Reglas:
 *  - La persistencia en Postgres se hace dentro de una transaccion.
 *  - Las llamadas a GLPI viven FUERA de la transaccion (HTTP no debe
 *    mantener filas bloqueadas en BD).
 *  - GLPI nunca rompe el flujo: si falla, el incidente queda registrado
 *    localmente con glpiTicketId = null y se logea el error.
 */
export async function aplicarTransicion(service: Service, result: CheckResult): Promise<void> {
  const previo = service.estadoActual;

  if (result.ok) {
    if (previo === ServiceStatus.DOWN) {
      await marcarUp(service, result);
    }
    return;
  }

  if (previo === ServiceStatus.UP) {
    await marcarDown(service, result);
  }
}

async function marcarDown(service: Service, result: CheckResult): Promise<void> {
  const detalle = result.errorMsg ?? 'Sin detalle';

  // 1) Persistir cambio de estado + (si aplica) abrir incidente.
  const incidentId = await prisma.$transaction(async (tx) => {
    await tx.service.update({
      where: { id: service.id },
      data: { estadoActual: ServiceStatus.DOWN },
    });

    // Idempotencia: si ya hay un incidente abierto, lo reutilizamos.
    const abierto = await tx.incident.findFirst({
      where: { serviceId: service.id, horaRecuperacion: null },
    });
    if (abierto) return abierto.id;

    const creado = await tx.incident.create({
      data: {
        serviceId: service.id,
        detalleError: detalle.substring(0, 1000),
      },
    });
    return creado.id;
  });

  log.alert(`Servicio CAIDO: "${service.nombre}" (${objetivo(service)}) -> ${detalle}`, {
    serviceId: service.id,
    incidentId,
    statusCode: result.statusCode,
    latenciaMs: result.latenciaMs,
  });

  // 2) Sincronizar con GLPI (fuera de la transaccion, tolerante a fallos).
  await sincronizarAperturaGlpi(service, detalle, incidentId);

  // 3) Notificar por WhatsApp (tolerante a fallos).
  await whatsapp.enviarAlerta(
    `🔴 *CAIDA detectada*\n\n` +
      `Servicio: ${service.nombre}\n` +
      `Objetivo: ${objetivo(service)}\n` +
      `Detalle: ${detalle}\n` +
      `Hora: ${new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' })}\n\n` +
      `— Monitor Pronetsys`,
  );
}

async function marcarUp(service: Service, result: CheckResult): Promise<void> {
  // 1) Encontrar incidente abierto ANTES de cerrarlo, para guardar su ticketId.
  const incidente = await prisma.incident.findFirst({
    where: { serviceId: service.id, horaRecuperacion: null },
  });

  // 2) Cerrar en BD.
  await prisma.$transaction(async (tx) => {
    await tx.service.update({
      where: { id: service.id },
      data: { estadoActual: ServiceStatus.UP },
    });
    await tx.incident.updateMany({
      where: { serviceId: service.id, horaRecuperacion: null },
      data: { horaRecuperacion: new Date() },
    });
  });

  log.info(`Servicio RECUPERADO: "${service.nombre}"`, {
    serviceId: service.id,
    incidentId: incidente?.id,
    statusCode: result.statusCode,
    latenciaMs: result.latenciaMs,
  });

  // 3) Resolver ticket en GLPI si existe.
  if (incidente?.glpiTicketId) {
    await sincronizarCierreGlpi(service, incidente.id, incidente.glpiTicketId);
  }

  // 4) Notificar recuperacion por WhatsApp (tolerante a fallos).
  const duracion = incidente
    ? formatearDuracion(Date.now() - incidente.horaCaida.getTime())
    : 'desconocida';
  await whatsapp.enviarAlerta(
    `🟢 *Servicio RECUPERADO*\n\n` +
      `Servicio: ${service.nombre}\n` +
      `Objetivo: ${objetivo(service)}\n` +
      `Duracion de la caida: ${duracion}\n` +
      `Hora: ${new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' })}\n\n` +
      `— Monitor Pronetsys`,
  );
}

function formatearDuracion(ms: number): string {
  const seg = Math.floor(ms / 1000);
  const min = Math.floor(seg / 60);
  const horas = Math.floor(min / 60);
  if (horas > 0) return `${horas}h ${min % 60}m`;
  if (min > 0) return `${min}m ${seg % 60}s`;
  return `${seg}s`;
}

// ---------------------------------------------------------------------------
// Sincronizacion con GLPI
// ---------------------------------------------------------------------------

async function sincronizarAperturaGlpi(
  service: Service,
  detalle: string,
  incidentId: number,
): Promise<void> {
  if (!glpi.estaConfigurado()) {
    log.alert(`[ALERTA] Preparando webhook para ${process.env.GLPI_URL || 'soporte.pronetsys.com.co/glpi'}... (GLPI no configurado: se omite creacion de ticket)`, {
      incidentId,
      servicio: service.nombre,
    });
    return;
  }

  // Si este incidente ya tiene ticket (caso raro: re-trigger), no duplicar.
  const inc = await prisma.incident.findUnique({ where: { id: incidentId } });
  if (inc?.glpiTicketId) {
    log.info(`Incidente #${incidentId} ya tiene ticket GLPI #${inc.glpiTicketId}; no recreo.`);
    return;
  }

  const titulo = `[CAIDA] ${service.nombre}`;
  const contenido = armarContenidoTicket(service, detalle);

  const ticketId = await glpi.crearTicket({ titulo, contenido });
  if (!ticketId) {
    log.error('No se pudo crear ticket en GLPI. El incidente queda registrado localmente sin glpi_ticket_id.', {
      incidentId,
      servicio: service.nombre,
    });
    return;
  }

  await prisma.incident.update({
    where: { id: incidentId },
    data: { glpiTicketId: ticketId },
  });

  log.info(`Ticket GLPI #${ticketId} creado para incidente #${incidentId}.`, {
    servicio: service.nombre,
  });
}

async function sincronizarCierreGlpi(
  service: Service,
  incidentId: number,
  ticketId: number,
): Promise<void> {
  if (!glpi.estaConfigurado()) {
    log.warn(`GLPI no configurado; no resuelvo ticket #${ticketId} aunque el servicio se recupero.`);
    return;
  }

  const solucion =
    `El monitor de Pronetsys detecto la recuperacion automatica del servicio "${service.nombre}" ` +
    `(${objetivo(service)}) a las ${new Date().toISOString()}. ` +
    `Este ticket fue resuelto automaticamente por el sistema de monitoreo.`;

  const ok = await glpi.cerrarTicket({ ticketId, solucion });

  if (ok) {
    log.info(`Ticket GLPI #${ticketId} marcado como ${process.env.GLPI_AUTO_RESOLVE_AS === 'closed' ? 'cerrado' : 'resuelto'}.`, {
      incidentId,
    });
  } else {
    log.error('No se pudo resolver ticket GLPI tras recuperacion.', {
      incidentId,
      ticketId,
    });
  }
}

function armarContenidoTicket(service: Service, detalle: string): string {
  return [
    `Servicio:    ${service.nombre}`,
    `Tipo:        ${service.tipo}`,
    `Objetivo:    ${objetivo(service)}`,
    `Detectado:   ${new Date().toISOString()}`,
    `Error:       ${detalle}`,
    ``,
    `Este ticket fue creado automaticamente por el sistema de monitoreo`,
    `de infraestructura de Pronetsys (monitor.pronetsys.com.co).`,
    `Sera resuelto automaticamente cuando el servicio vuelva a responder OK.`,
  ].join('\n');
}

/** Texto del objetivo monitoreado: la URL (HTTP) o host:puerto (TCP). */
function objetivo(service: Pick<Service, 'tipo' | 'url' | 'host' | 'puerto'>): string {
  if (service.tipo === 'TCP') return `${service.host ?? '?'}:${service.puerto ?? '?'}`;
  return service.url ?? '';
}
