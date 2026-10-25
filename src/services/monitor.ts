import { Service, ServiceStatus } from '@prisma/client';
import { env } from '../config/env';
import { prisma } from '../db/prisma';
import { log } from '../utils/logger';
import { realizarChequeo, type CheckResult } from './checker';
import { aplicarTransicion } from './stateManager';
import { emitirEvento } from './eventos';

/**
 * Planificador del motor de monitoreo. Se invoca en cada tick del cron:
 *
 *  1. Toma todos los servicios no pausados.
 *  2. Filtra los que ya estan "vencidos" segun su intervaloMonitoreo
 *     (comparando contra ultimoCheckEn) y que no tengan un chequeo en curso.
 *  3. Los encola en un pool de concurrencia limitada y RETORNA sin esperar:
 *     un servicio lento (timeout de 10s, reintentos de confirmacion) ya no
 *     retrasa al resto ni hace que se salten ticks completos.
 */
export async function ejecutarCiclo(): Promise<void> {
  const ahora = new Date();

  const servicios = await prisma.service.findMany({
    where: { estadoActual: { not: ServiceStatus.PAUSED } },
  });

  const pendientes = servicios.filter((s) => !enCurso.has(s.id) && estaVencido(s, ahora));

  if (pendientes.length === 0) return;

  log.info(`Encolando chequeos.`, {
    totales: servicios.length,
    pendientes: pendientes.length,
    enCurso: enCurso.size,
  });

  for (const s of pendientes) {
    enCurso.add(s.id);
    void limitar(() => procesarServicio(s)).finally(() => enCurso.delete(s.id));
  }
}

// Servicios con un chequeo en vuelo (evita duplicarlos entre ticks).
const enCurso = new Set<number>();

// Lanzar todos los chequeos a la vez satura el pool de libuv (4 hilos para
// DNS) y la red: los ultimos en la cola agotan su timeout esperando turno y
// aparecen como caidas en cadena. Se limita la cantidad simultanea.
const limitar = crearLimitador(env.monitor.concurrencia);

function crearLimitador(max: number): <T>(fn: () => Promise<T>) => Promise<T> {
  let activos = 0;
  const cola: Array<() => void> = [];
  const siguiente = (): void => {
    if (activos >= max) return;
    const tarea = cola.shift();
    if (!tarea) return;
    activos++;
    tarea();
  };
  return <T>(fn: () => Promise<T>) =>
    new Promise<T>((resolve, reject) => {
      cola.push(() => {
        fn()
          .then(resolve, reject)
          .finally(() => {
            activos--;
            siguiente();
          });
      });
      siguiente();
    });
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

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Chequea un servicio. Si estaba UP y el chequeo falla, repite el chequeo
 * hasta MONITOR_REINTENTOS veces antes de declararlo CAIDO: un paquete perdido
 * o un reset aislado no debe abrir ticket en GLPI ni mandar WhatsApp.
 */
async function chequearConConfirmacion(service: Service): Promise<CheckResult> {
  let result = await realizarChequeo(service);
  if (result.ok || service.estadoActual !== ServiceStatus.UP) return result;

  for (let intento = 1; intento <= env.monitor.reintentos; intento++) {
    log.warn(`Fallo en "${service.nombre}" (${result.errorMsg}); confirmando ${intento}/${env.monitor.reintentos}...`, {
      serviceId: service.id,
    });
    await esperar(env.monitor.esperaReintentoMs);
    result = await realizarChequeo(service);
    if (result.ok) break;
  }
  return result;
}

async function procesarServicio(service: Service): Promise<void> {
  try {
    const result = await chequearConConfirmacion(service);
    const ahora = new Date();

    await prisma.log.create({
      data: {
        serviceId: service.id,
        latenciaMs: result.latenciaMs,
        statusCode: result.statusCode ?? null,
        errorMsg: result.errorMsg?.substring(0, 500) ?? null,
        timestamp: ahora,
      },
    });

    await prisma.service.update({
      where: { id: service.id },
      data: { ultimoCheckEn: ahora },
    });

    const estado = await aplicarTransicion(service, result);

    emitirEvento({
      tipo: 'check',
      serviceId: service.id,
      estado,
      latenciaMs: result.latenciaMs,
      statusCode: result.statusCode,
      ok: result.ok,
      ts: ahora.toISOString(),
    });

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
