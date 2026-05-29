import { Service, ServiceStatus } from '@prisma/client';
import { prisma } from '../db/prisma';
import { log } from '../utils/logger';
import { realizarChequeo } from './checker';
import { aplicarTransicion } from './stateManager';

/**
 * Ejecucion de un ciclo completo del motor de monitoreo.
 *
 *  1. Toma todos los servicios no pausados.
 *  2. Filtra los que ya estan "vencidos" segun su intervaloMonitoreo
 *     (comparando contra ultimoCheckEn).
 *  3. Lanza los chequeos en paralelo, registra el Log y la transicion
 *     de estado de manera aislada para que un fallo en uno no afecte
 *     a los demas.
 */
export async function ejecutarCiclo(): Promise<void> {
  const ahora = new Date();

  const servicios = await prisma.service.findMany({
    where: { estadoActual: { not: ServiceStatus.PAUSED } },
  });

  const pendientes = servicios.filter((s) => estaVencido(s, ahora));

  if (pendientes.length === 0) {
    log.info('Ciclo sin servicios vencidos.', { totales: servicios.length });
    return;
  }

  log.info(`Iniciando ciclo de chequeos.`, {
    totales: servicios.length,
    pendientes: pendientes.length,
  });

  await Promise.allSettled(pendientes.map((s) => procesarServicio(s)));
}

// Piso defensivo: nunca chequear mas seguido que cada 15s (aunque la BD
// tenga un valor menor por datos viejos o mal ingresados).
const INTERVALO_MIN_SEG = 15;

function estaVencido(service: Service, ahora: Date): boolean {
  if (!service.ultimoCheckEn) return true;
  const intervaloSeg = Math.max(service.intervaloMonitoreo, INTERVALO_MIN_SEG);
  const segundosTranscurridos = (ahora.getTime() - service.ultimoCheckEn.getTime()) / 1000;
  // Tolerancia de ~2s para no saltarse un ciclo por el jitter del cron.
  return segundosTranscurridos >= intervaloSeg - 2;
}

async function procesarServicio(service: Service): Promise<void> {
  try {
    const result = await realizarChequeo(service);

    await prisma.log.create({
      data: {
        serviceId: service.id,
        latenciaMs: result.latenciaMs,
        statusCode: result.statusCode ?? null,
        errorMsg: result.errorMsg?.substring(0, 500) ?? null,
      },
    });

    await prisma.service.update({
      where: { id: service.id },
      data: { ultimoCheckEn: new Date() },
    });

    await aplicarTransicion(service, result);

    log.info(
      `Check OK="${result.ok}" "${service.nombre}" status=${result.statusCode ?? 'n/a'} latencia=${result.latenciaMs}ms`,
      { serviceId: service.id },
    );
  } catch (err) {
    // Defensivo: si Prisma o algo interno falla, lo aislamos para no romper el ciclo.
    log.error(`Error procesando servicio "${service.nombre}"`, {
      serviceId: service.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
