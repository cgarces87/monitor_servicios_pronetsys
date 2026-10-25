import { env } from '../config/env';
import { prisma } from '../db/prisma';
import { log } from '../utils/logger';

const LOTE = 20_000;

/**
 * Borra los logs de chequeo mas viejos que LOG_RETENTION_DAYS (0 = no borrar).
 *
 * Con chequeos cada 15s cada servicio genera ~5.760 filas/dia, asi que sin
 * retencion la tabla crece sin limite. Se borra por servicio y en lotes para
 * aprovechar el indice (service_id, timestamp) y no bloquear la tabla en una
 * sola transaccion gigante.
 */
export async function purgarLogsAntiguos(): Promise<void> {
  const dias = env.retencion.logsDias;
  if (dias <= 0) return;

  const servicios = await prisma.service.findMany({ select: { id: true } });
  let total = 0;
  for (const s of servicios) {
    for (;;) {
      // Prisma guarda DateTime como timestamp UTC sin zona: comparamos contra
      // now() en UTC para no depender del TimeZone de la sesion de Postgres.
      const borrados = await prisma.$executeRaw`
        DELETE FROM logs WHERE id IN (
          SELECT id FROM logs
          WHERE service_id = ${s.id}::int
            AND "timestamp" < (now() AT TIME ZONE 'UTC') - make_interval(days => ${dias}::int)
          LIMIT ${LOTE}::int
        )`;
      total += borrados;
      if (borrados < LOTE) break;
    }
  }

  if (total > 0) log.info(`Retencion: ${total} logs con mas de ${dias} dias eliminados.`);
}
