import { FastifyInstance } from 'fastify';
import { prisma } from '../../db/prisma';

/**
 * Rutas de servicios:
 *   GET /api/services                  -> lista con estado actual + ultima latencia
 *   GET /api/services/:id              -> detalle de un servicio
 *   GET /api/services/:id/uptime       -> % de uptime y estadisticas en una ventana
 *   GET /api/services/:id/logs         -> historico reciente para graficar latencia
 */
export async function registrarRutasServices(app: FastifyInstance): Promise<void> {
  // Lista de servicios con su ultimo log (estado + latencia mas reciente).
  app.get('/api/services', { preHandler: [app.authenticate] }, async () => {
    const servicios = await prisma.service.findMany({
      orderBy: { id: 'asc' },
      include: {
        logs: {
          orderBy: { timestamp: 'desc' },
          take: 1,
        },
      },
    });

    return servicios.map((s) => {
      const ultimo = s.logs[0];
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
      };
    });
  });

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
      const desde = new Date(Date.now() - horas * 3_600_000);

      const logs = await prisma.log.findMany({
        where: { serviceId: id, timestamp: { gte: desde } },
        select: { latenciaMs: true, statusCode: true, errorMsg: true },
      });

      const total = logs.length;
      // Un chequeo es exitoso si NO tiene errorMsg. Esto vale tanto para
      // HTTP (statusCode 2xx/3xx, errorMsg null) como para TCP (statusCode
      // null por naturaleza pero errorMsg null cuando el puerto responde).
      const oks = logs.filter((l) => esOk(l));
      const ok = oks.length;
      // Promedio/min/max solo sobre chequeos exitosos (los fallidos suelen
      // tener latencia = timeout y ensucian el promedio).
      const latencias = oks.map((l) => l.latenciaMs).filter((n) => n > 0);

      return {
        serviceId: id,
        ventanaHoras: horas,
        muestras: total,
        uptimePct: total === 0 ? null : Number(((ok / total) * 100).toFixed(3)),
        latenciaPromedioMs: latencias.length
          ? Math.round(latencias.reduce((a, b) => a + b, 0) / latencias.length)
          : null,
        latenciaMinMs: latencias.length ? Math.min(...latencias) : null,
        latenciaMaxMs: latencias.length ? Math.max(...latencias) : null,
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
        select: { latenciaMs: true, statusCode: true, timestamp: true },
      });

      // Devolvemos en orden cronologico ascendente para graficar de izq a der.
      return logs.reverse();
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

      const actualizado = await prisma.service.update({
        where: { id },
        // Al reanudar lo dejamos en UP; el motor reevalua en el siguiente ciclo.
        data: { estadoActual: accion === 'pause' ? 'PAUSED' : 'UP' },
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

// Un chequeo es exitoso si no quedo errorMsg registrado. Esto cubre HTTP
// (2xx/3xx -> errorMsg null) y TCP (puerto responde -> errorMsg null), sin
// depender de statusCode (que para TCP siempre es null).
function esOk(log: { errorMsg: string | null }): boolean {
  return log.errorMsg === null;
}
