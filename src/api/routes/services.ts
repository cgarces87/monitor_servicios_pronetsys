import { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma';

type FilaUltimo = { serviceId: number; latenciaMs: number; statusCode: number | null };
type FilaStats = {
  serviceId: number;
  muestras: number;
  oks: number;
  promedio: number | null;
  minimo: number | null;
  maximo: number | null;
};
type FilaSerie = FilaUltimo & { ok: boolean; timestamp: Date };
type LogPunto = { latenciaMs: number; statusCode: number | null; ok: boolean; timestamp: Date };

/**
 * Rutas de servicios:
 *   GET /api/services                  -> lista con estado actual + ultima latencia
 *   GET /api/services/:id              -> detalle de un servicio
 *   GET /api/services/:id/uptime       -> % de uptime y estadisticas en una ventana
 *   GET /api/services/:id/logs         -> historico reciente para graficar latencia
 */
export async function registrarRutasServices(app: FastifyInstance): Promise<void> {
  // Lista de servicios con su ultimo log, uptime 24h y (opcional) los ultimos
  // N puntos de latencia para el mini-grafico de cada tarjeta. Todo sale en 3
  // consultas fijas, sin importar cuantos servicios haya: antes cada tarjeta
  // pedia /uptime y /logs por separado (2 peticiones x servicio).
  app.get<{ Querystring: { sparkline?: string } }>(
    '/api/services',
    { preHandler: [app.authenticate] },
    async (req) => {
      const puntos = Math.min(Math.max(Number(req.query.sparkline) || 0, 0), 100);

      const [servicios, ultimos, stats, series] = await Promise.all([
        prisma.service.findMany({ orderBy: { id: 'asc' } }),
        // LATERAL + LIMIT 1 usa el indice (service_id, timestamp) hacia atras.
        // (Un include { logs: { take: 1 } } de Prisma trae los logs de todos
        // los servicios y recorta en memoria: se degradaba con el historial.)
        prisma.$queryRaw<FilaUltimo[]>`
          SELECT s.id AS "serviceId", l.latencia_ms AS "latenciaMs", l.status_code AS "statusCode"
          FROM services s
          JOIN LATERAL (
            SELECT latencia_ms, status_code FROM logs
            WHERE service_id = s.id
            ORDER BY "timestamp" DESC
            LIMIT 1
          ) l ON true`,
        prisma.$queryRaw<FilaStats[]>`
          SELECT s.id AS "serviceId", a.*
          FROM services s
          CROSS JOIN LATERAL (${sqlEstadisticas(Prisma.sql`s.id`, 24)}) a`,
        puntos > 0
          ? prisma.$queryRaw<FilaSerie[]>`
              SELECT s.id AS "serviceId", p.latencia_ms AS "latenciaMs", p.status_code AS "statusCode",
                     p.error_msg IS NULL AS ok, p."timestamp"
              FROM services s
              CROSS JOIN LATERAL (
                SELECT latencia_ms, status_code, error_msg, "timestamp" FROM logs
                WHERE service_id = s.id
                ORDER BY "timestamp" DESC
                LIMIT ${puntos}::int
              ) p`
          : Promise.resolve([] as FilaSerie[]),
      ]);

      const ultimoPor = new Map(ultimos.map((u) => [u.serviceId, u]));
      const statsPor = new Map(stats.map((st) => [st.serviceId, st]));
      const seriePor = new Map<number, LogPunto[]>();
      // Vienen del mas reciente al mas viejo: unshift deja orden cronologico.
      for (const p of series) {
        const lista = seriePor.get(p.serviceId) ?? [];
        lista.unshift({ latenciaMs: p.latenciaMs, statusCode: p.statusCode, ok: p.ok, timestamp: p.timestamp });
        seriePor.set(p.serviceId, lista);
      }

      return servicios.map((s) => {
        const ultimo = ultimoPor.get(s.id);
        const st = statsPor.get(s.id);
        return {
          id: s.id,
          nombre: s.nombre,
          tipo: s.tipo,
          url: s.url,
          host: s.host,
          puerto: s.puerto,
          intervaloMonitoreo: s.intervaloMonitoreo,
          estadoActual: s.estadoActual,
          creadoEn: s.creadoEn,
          ultimoCheckEn: s.ultimoCheckEn,
          ultimaLatenciaMs: ultimo?.latenciaMs ?? null,
          ultimoStatusCode: ultimo?.statusCode ?? null,
          uptime24h: st ? formatearStats(st) : null,
          ...(puntos > 0 ? { sparkline: seriePor.get(s.id) ?? [] } : {}),
        };
      });
    },
  );

  // Detalle de un servicio.
  app.get<{ Params: { id: string } }>('/api/services/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return reply.code(400).send({ error: 'id invalido' });

    const s = await prisma.service.findUnique({ where: { id } });
    if (!s) return reply.code(404).send({ error: 'servicio no encontrado' });
    return s;
  });

  // Uptime y estadisticas en una ventana temporal (default 24h).
  app.get<{ Params: { id: string }; Querystring: { window?: string } }>(
    '/api/services/:id/uptime',
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) return reply.code(400).send({ error: 'id invalido' });

      const horas = parseVentanaHoras(req.query.window);

      // Agregado en Postgres: para 30d con chequeos cada 15s son ~170k filas
      // que antes viajaban completas a Node solo para contarlas.
      const [st] = await prisma.$queryRaw<FilaStats[]>`
        SELECT ${id}::int AS "serviceId", a.*
        FROM (${sqlEstadisticas(Prisma.sql`${id}::int`, horas)}) a`;

      return {
        serviceId: id,
        ventanaHoras: horas,
        ...formatearStats(st),
      };
    },
  );

  // Historico reciente de logs (para el grafico de latencia).
  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>(
    '/api/services/:id/logs',
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) return reply.code(400).send({ error: 'id invalido' });

      const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 1000);

      const logs = await prisma.log.findMany({
        where: { serviceId: id },
        orderBy: { timestamp: 'desc' },
        take: limit,
        select: { latenciaMs: true, statusCode: true, errorMsg: true, timestamp: true },
      });

      // Devolvemos en orden cronologico ascendente para graficar de izq a der.
      return logs.reverse().map((l) => ({
        latenciaMs: l.latenciaMs,
        statusCode: l.statusCode,
        ok: esOk(l),
        timestamp: l.timestamp,
      }));
    },
  );

  // ---- Escritura (solo ADMIN) ----
  const soloAdmin = { preHandler: [app.authenticate, app.requireAdmin] };

  // Crear servicio.
  app.post<{ Body: NuevoServicio }>('/api/services', soloAdmin, async (req, reply) => {
    const error = validarServicio(req.body);
    if (error) return reply.code(400).send({ error });

    const creado = await prisma.service.create({
      data: {
        nombre: req.body.nombre.trim(),
        ...campitosObjetivo(req.body),
        intervaloMonitoreo: req.body.intervaloMonitoreo ?? 60,
        // Un servicio nuevo arranca como UP; el motor corregira en el primer ciclo.
        estadoActual: 'UP',
      },
    });
    return reply.code(201).send(creado);
  });

  // Editar servicio (nombre, tipo, objetivo, intervalo).
  app.put<{ Params: { id: string }; Body: NuevoServicio }>(
    '/api/services/:id',
    soloAdmin,
    async (req, reply) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) return reply.code(400).send({ error: 'id invalido' });

      const error = validarServicio(req.body);
      if (error) return reply.code(400).send({ error });

      const existe = await prisma.service.findUnique({ where: { id } });
      if (!existe) return reply.code(404).send({ error: 'servicio no encontrado' });

      const actualizado = await prisma.service.update({
        where: { id },
        data: {
          nombre: req.body.nombre.trim(),
          ...campitosObjetivo(req.body),
          intervaloMonitoreo: req.body.intervaloMonitoreo ?? existe.intervaloMonitoreo,
        },
      });
      return actualizado;
    },
  );

  // Pausar / reanudar (cambia estado a PAUSED o UP).
  app.patch<{ Params: { id: string }; Body: { accion?: 'pause' | 'resume' } }>(
    '/api/services/:id/estado',
    soloAdmin,
    async (req, reply) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) return reply.code(400).send({ error: 'id invalido' });

      const accion = req.body?.accion;
      if (accion !== 'pause' && accion !== 'resume') {
        return reply.code(400).send({ error: 'accion debe ser "pause" o "resume"' });
      }

      const existe = await prisma.service.findUnique({ where: { id } });
      if (!existe) return reply.code(404).send({ error: 'servicio no encontrado' });

      // Al reanudar: UP, salvo que tenga un incidente abierto (se pauso estando
      // caido). Ese vuelve como DOWN para que el siguiente chequeo OK pase por
      // la transicion normal y cierre el incidente y su ticket GLPI; si volviera
      // como UP, el incidente quedaria abierto para siempre.
      let reanudarComo: 'UP' | 'DOWN' = 'UP';
      if (accion === 'resume') {
        const abierto = await prisma.incident.findFirst({
          where: { serviceId: id, horaRecuperacion: null },
          select: { id: true },
        });
        if (abierto) reanudarComo = 'DOWN';
      }

      const actualizado = await prisma.service.update({
        where: { id },
        data: { estadoActual: accion === 'pause' ? 'PAUSED' : reanudarComo },
      });
      return actualizado;
    },
  );

  // Eliminar servicio (borra en cascada sus logs e incidentes).
  app.delete<{ Params: { id: string } }>(
    '/api/services/:id',
    soloAdmin,
    async (req, reply) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) return reply.code(400).send({ error: 'id invalido' });

      const existe = await prisma.service.findUnique({ where: { id } });
      if (!existe) return reply.code(404).send({ error: 'servicio no encontrado' });

      await prisma.service.delete({ where: { id } });
      return { ok: true, id };
    },
  );
}

type NuevoServicio = {
  nombre: string;
  tipo?: 'HTTP' | 'TCP';
  url?: string;          // requerido si tipo HTTP
  host?: string;         // requerido si tipo TCP
  puerto?: number;       // requerido si tipo TCP
  intervaloMonitoreo?: number;
};

function validarServicio(body: NuevoServicio | undefined): string | null {
  if (!body) return 'cuerpo requerido';
  if (!body.nombre || body.nombre.trim().length < 2) return 'nombre invalido (min 2 caracteres)';
  if (body.nombre.length > 150) return 'nombre demasiado largo (max 150)';

  const tipo = body.tipo ?? 'HTTP';
  if (tipo !== 'HTTP' && tipo !== 'TCP') return 'tipo debe ser "HTTP" o "TCP"';

  if (tipo === 'HTTP') {
    const url = (body.url ?? '').trim();
    if (!/^https?:\/\/.+/i.test(url)) return 'url invalida (debe iniciar con http:// o https://)';
    if (url.length > 500) return 'url demasiado larga (max 500)';
  } else {
    const host = (body.host ?? '').trim();
    if (!host) return 'host requerido para tipo TCP';
    if (host.length > 255) return 'host demasiado largo (max 255)';
    const puerto = body.puerto;
    if (!Number.isInteger(puerto) || (puerto as number) < 1 || (puerto as number) > 65535) {
      return 'puerto debe ser entero entre 1 y 65535';
    }
  }

  if (body.intervaloMonitoreo !== undefined) {
    const n = body.intervaloMonitoreo;
    // En SEGUNDOS: minimo 15s, maximo 86400s (24h).
    if (!Number.isInteger(n) || n < 15 || n > 86400) {
      return 'intervaloMonitoreo debe ser entero entre 15 y 86400 segundos (15s a 24h)';
    }
  }
  return null;
}

/**
 * Devuelve los campos de objetivo a persistir segun el tipo, dejando en null
 * los del otro tipo (asi al cambiar HTTP<->TCP no quedan datos huerfanos).
 */
function campitosObjetivo(body: NuevoServicio): {
  tipo: 'HTTP' | 'TCP';
  url: string | null;
  host: string | null;
  puerto: number | null;
} {
  const tipo = body.tipo ?? 'HTTP';
  if (tipo === 'TCP') {
    return { tipo, url: null, host: (body.host ?? '').trim(), puerto: body.puerto ?? null };
  }
  return { tipo, url: (body.url ?? '').trim(), host: null, puerto: null };
}

function parseVentanaHoras(window: string | undefined): number {
  switch ((window ?? '24h').toLowerCase()) {
    case '1h':
      return 1;
    case '6h':
      return 6;
    case '12h':
      return 12;
    case '24h':
      return 24;
    case '7d':
      return 24 * 7;
    case '30d':
      return 24 * 30;
    default:
      return 24;
  }
}

/**
 * Subconsulta de estadisticas de un servicio en las ultimas `horas`.
 *
 * Un chequeo es exitoso si NO tiene errorMsg: vale tanto para HTTP (2xx/3xx)
 * como para TCP (statusCode null por naturaleza). Promedio/min/max solo sobre
 * exitosos: los fallidos suelen tener latencia = timeout y ensucian el promedio.
 *
 * Prisma guarda DateTime como timestamp UTC sin zona; se compara contra now()
 * en UTC para no depender del TimeZone de la sesion de Postgres.
 */
function sqlEstadisticas(serviceId: Prisma.Sql, horas: number): Prisma.Sql {
  return Prisma.sql`
    SELECT count(*)::int AS muestras,
           count(*) FILTER (WHERE error_msg IS NULL)::int AS oks,
           round(avg(latencia_ms) FILTER (WHERE error_msg IS NULL AND latencia_ms > 0))::int AS promedio,
           min(latencia_ms) FILTER (WHERE error_msg IS NULL AND latencia_ms > 0) AS minimo,
           max(latencia_ms) FILTER (WHERE error_msg IS NULL AND latencia_ms > 0) AS maximo
    FROM logs
    WHERE service_id = ${serviceId}
      AND "timestamp" >= (now() AT TIME ZONE 'UTC') - make_interval(hours => ${horas}::int)`;
}

function formatearStats(st: FilaStats | undefined) {
  const muestras = st?.muestras ?? 0;
  return {
    muestras,
    uptimePct: muestras === 0 ? null : Number((((st?.oks ?? 0) / muestras) * 100).toFixed(3)),
    latenciaPromedioMs: st?.promedio ?? null,
    latenciaMinMs: st?.minimo ?? null,
    latenciaMaxMs: st?.maximo ?? null,
  };
}

// Un chequeo es exitoso si no quedo errorMsg registrado. Esto cubre HTTP
// (2xx/3xx -> errorMsg null) y TCP (puerto responde -> errorMsg null), sin
// depender de statusCode (que para TCP siempre es null).
function esOk(log: { errorMsg: string | null }): boolean {
  return log.errorMsg === null;
}
