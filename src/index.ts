import cron from 'node-cron';
import { FastifyInstance } from 'fastify';
import { env } from './config/env';
import { prisma } from './db/prisma';
import { log } from './utils/logger';
import { ejecutarCiclo } from './services/monitor';
import { iniciarApi } from './api/server';
import { glpi } from './services/glpi';
import { sincronizarEstadosGlpi } from './services/glpiSync';
import { inicializarConfigDesdeEnv } from './services/whatsapp';
import { iniciarEventosWhatsApp, detenerEventosWhatsApp } from './services/whatsappEvents';

let ciclando = false;
let sincronizandoGlpi = false;
let apiServer: FastifyInstance | null = null;

async function tick(): Promise<void> {
  // Anti-solapamiento: si un ciclo aun no termina, saltamos el siguiente.
  if (ciclando) {
    log.warn('Ciclo anterior aun en ejecucion; este tick se omite.');
    return;
  }
  ciclando = true;
  try {
    await ejecutarCiclo();
  } catch (err) {
    log.error('Fallo no controlado en ciclo principal.', {
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    ciclando = false;
  }
}

async function tickGlpiSync(): Promise<void> {
  if (sincronizandoGlpi) return;
  sincronizandoGlpi = true;
  try {
    await sincronizarEstadosGlpi();
  } catch (err) {
    log.error('Fallo en sincronizacion de estados GLPI.', {
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    sincronizandoGlpi = false;
  }
}

async function main(): Promise<void> {
  log.info('Monitor Pronetsys iniciando...', {
    cron: env.monitorCron,
    tz: env.tz,
    httpTimeoutMs: env.httpTimeoutMs,
  });

  // Verificar conexion a la BD antes de programar el cron.
  await prisma.$queryRaw`SELECT 1`;
  log.info('Conexion a PostgreSQL OK.');

  // Sembrar la config de notificaciones desde .env en el primer arranque
  // (despues de la migracion). Tras la primera escritura por UI, el .env
  // queda irrelevante.
  await inicializarConfigDesdeEnv();

  // Listener de eventos de WhatsApp (bienvenida automatica al activar).
  // No bloqueante: si la sesion aun no esta lista, reintenta cada 30s.
  void iniciarEventosWhatsApp();

  // Levantar la API HTTP de lectura (si esta habilitada).
  apiServer = await iniciarApi();

  // Primer tick inmediato al arrancar, util para validar el motor sin esperar 1 min.
  await tick();

  cron.schedule(env.monitorCron, () => { void tick(); }, { timezone: env.tz });
  log.info(`Cron programado. Esperando ticks segun "${env.monitorCron}".`);

  // Sincronizacion inversa de estados GLPI -> portal (solo si GLPI esta configurado).
  if (glpi.estaConfigurado()) {
    cron.schedule(env.glpi.syncCron, () => { void tickGlpiSync(); }, { timezone: env.tz });
    log.info(`Sync de estados GLPI programado: "${env.glpi.syncCron}".`);
  }
}

main().catch(async (err) => {
  log.error('Arranque fallido.', { error: err instanceof Error ? err.message : String(err) });
  await prisma.$disconnect();
  process.exit(1);
});

// Apagado limpio
const apagar = async (signal: string) => {
  log.info(`Recibida senal ${signal}. Cerrando conexiones...`);
  detenerEventosWhatsApp();
  if (apiServer) await apiServer.close().catch(() => undefined);
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGINT',  () => void apagar('SIGINT'));
process.on('SIGTERM', () => void apagar('SIGTERM'));
