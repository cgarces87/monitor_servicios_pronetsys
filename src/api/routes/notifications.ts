import { FastifyInstance } from 'fastify';
import { prisma } from '../../db/prisma';
import { obtenerConfig, whatsapp } from '../../services/whatsapp';
import { reiniciarEventosWhatsApp } from '../../services/whatsappEvents';

/**
 * Gestion del modulo de notificaciones (solo ADMIN).
 *
 *   GET    /api/notifications/whatsapp
 *   PUT    /api/notifications/whatsapp
 *   GET    /api/notifications/whatsapp/recipients
 *   POST   /api/notifications/whatsapp/recipients          { numero, etiqueta? }
 *   PATCH  /api/notifications/whatsapp/recipients/:id      { activo?, etiqueta? }
 *   DELETE /api/notifications/whatsapp/recipients/:id
 *   POST   /api/notifications/whatsapp/test                { texto, numero? }
 */
export async function registrarRutasNotificaciones(app: FastifyInstance): Promise<void> {
  const soloAdmin = { preHandler: [app.authenticate, app.requireAdmin] };

  // --- Config WhatsApp (singleton id=1) ---

  app.get('/api/notifications/whatsapp', soloAdmin, async () => {
    return obtenerConfig();
  });

  app.put<{
    Body: {
      whatsappEnabled?: boolean;
      whatsappApiUrl?: string | null;
      whatsappApiKey?: string | null;
      whatsappSessionId?: string | null;
      whatsappChatSuffix?: string;
      whatsappTimeoutMs?: number;
      notificarCaida?: boolean;
      notificarRecuperacion?: boolean;
    };
  }>('/api/notifications/whatsapp', soloAdmin, async (req, reply) => {
    const b = req.body ?? {};

    if (b.whatsappTimeoutMs !== undefined) {
      if (!Number.isInteger(b.whatsappTimeoutMs) || b.whatsappTimeoutMs < 1000 || b.whatsappTimeoutMs > 120_000) {
        return reply.code(400).send({ error: 'whatsappTimeoutMs debe ser entero entre 1000 y 120000' });
      }
    }
    if (b.whatsappApiUrl !== undefined && b.whatsappApiUrl !== null && b.whatsappApiUrl !== '') {
      if (!/^https?:\/\//i.test(b.whatsappApiUrl)) {
        return reply.code(400).send({ error: 'whatsappApiUrl debe iniciar con http:// o https://' });
      }
    }

    await obtenerConfig(); // garantiza la existencia de la fila id=1
    const actualizada = await prisma.notificacionConfig.update({
      where: { id: 1 },
      data: {
        whatsappEnabled: b.whatsappEnabled,
        whatsappApiUrl: b.whatsappApiUrl,
        whatsappApiKey: b.whatsappApiKey,
        whatsappSessionId: b.whatsappSessionId,
        whatsappChatSuffix: b.whatsappChatSuffix,
        whatsappTimeoutMs: b.whatsappTimeoutMs,
        notificarCaida: b.notificarCaida,
        notificarRecuperacion: b.notificarRecuperacion,
      },
    });

    // Reconectamos el listener de eventos para que tome la nueva config sin
    // requerir reinicio del servicio (fire-and-forget, tolerante a fallos).
    void reiniciarEventosWhatsApp().catch(() => undefined);

    return actualizada;
  });

  // --- Destinatarios ---

  app.get('/api/notifications/whatsapp/recipients', soloAdmin, async () => {
    const filas = await prisma.whatsappRecipient.findMany({
      orderBy: { id: 'asc' },
      include: { servicios: { select: { serviceId: true } } },
    });
    // Aplanar las suscripciones a un array de ids para el frontend.
    return filas.map((r) => ({
      id: r.id,
      numero: r.numero,
      etiqueta: r.etiqueta,
      activo: r.activo,
      bienvenidaEnviada: r.bienvenidaEnviada,
      bienvenidaEn: r.bienvenidaEn,
      creadoEn: r.creadoEn,
      serviceIds: r.servicios.map((s) => s.serviceId),
    }));
  });

  app.post<{ Body: { numero?: string; etiqueta?: string; serviceIds?: number[] } }>(
    '/api/notifications/whatsapp/recipients',
    soloAdmin,
    async (req, reply) => {
      const numero = (req.body?.numero ?? '').replace(/\D+/g, '');
      const etiqueta = (req.body?.etiqueta ?? '').trim() || null;
      if (numero.length < 7 || numero.length > 20) {
        return reply.code(400).send({ error: 'numero invalido (7-20 digitos, solo numeros con codigo de pais)' });
      }

      const serviceIds = await validarServiceIds(req.body?.serviceIds);
      if (typeof serviceIds === 'string') return reply.code(400).send({ error: serviceIds });

      const creado = await prisma.whatsappRecipient.create({
        data: {
          numero,
          etiqueta,
          servicios: { create: serviceIds.map((sid) => ({ serviceId: sid })) },
        },
      });
      return reply.code(201).send({ ...creado, serviceIds });
    },
  );

  app.patch<{
    Params: { id: string };
    Body: { activo?: boolean; etiqueta?: string | null; serviceIds?: number[] };
  }>(
    '/api/notifications/whatsapp/recipients/:id',
    soloAdmin,
    async (req, reply) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) return reply.code(400).send({ error: 'id invalido' });

      const existe = await prisma.whatsappRecipient.findUnique({ where: { id } });
      if (!existe) return reply.code(404).send({ error: 'destinatario no encontrado' });

      // Si vienen serviceIds, reemplazamos las suscripciones (sino, las dejamos como estaban).
      let nuevasSubs: number[] | null = null;
      if (req.body?.serviceIds !== undefined) {
        const v = await validarServiceIds(req.body.serviceIds);
        if (typeof v === 'string') return reply.code(400).send({ error: v });
        nuevasSubs = v;
      }

      const actualizado = await prisma.$transaction(async (tx) => {
        await tx.whatsappRecipient.update({
          where: { id },
          data: {
            activo: req.body?.activo,
            etiqueta: req.body?.etiqueta === undefined ? undefined : (req.body.etiqueta ?? null),
          },
        });
        if (nuevasSubs !== null) {
          await tx.whatsappRecipientService.deleteMany({ where: { recipientId: id } });
          if (nuevasSubs.length > 0) {
            await tx.whatsappRecipientService.createMany({
              data: nuevasSubs.map((sid) => ({ recipientId: id, serviceId: sid })),
            });
          }
        }
        return tx.whatsappRecipient.findUnique({
          where: { id },
          include: { servicios: { select: { serviceId: true } } },
        });
      });

      if (!actualizado) return reply.code(404).send({ error: 'destinatario no encontrado' });
      return {
        id: actualizado.id,
        numero: actualizado.numero,
        etiqueta: actualizado.etiqueta,
        activo: actualizado.activo,
        bienvenidaEnviada: actualizado.bienvenidaEnviada,
        bienvenidaEn: actualizado.bienvenidaEn,
        creadoEn: actualizado.creadoEn,
        serviceIds: actualizado.servicios.map((s) => s.serviceId),
      };
    },
  );

  // Devuelve number[] (ids unicos validos existentes) o string con mensaje de error.
  async function validarServiceIds(ids: number[] | undefined): Promise<number[] | string> {
    if (!ids || ids.length === 0) return [];
    if (!Array.isArray(ids)) return 'serviceIds debe ser un array de numeros';
    const unicos = Array.from(new Set(ids.filter((n) => Number.isInteger(n) && n > 0)));
    if (unicos.length === 0) return [];
    const existentes = await prisma.service.findMany({
      where: { id: { in: unicos } },
      select: { id: true },
    });
    if (existentes.length !== unicos.length) {
      return `Uno o mas servicios no existen (recibidos: ${unicos.length}, validos: ${existentes.length})`;
    }
    return unicos;
  }

  app.delete<{ Params: { id: string } }>(
    '/api/notifications/whatsapp/recipients/:id',
    soloAdmin,
    async (req, reply) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) return reply.code(400).send({ error: 'id invalido' });
      await prisma.whatsappRecipient.delete({ where: { id } }).catch(() => undefined);
      return { ok: true, id };
    },
  );

  // --- Historial de envios (auditoria) ---

  app.get<{ Querystring: { limit?: string; offset?: string; tipo?: string; exitoso?: string } }>(
    '/api/notifications/whatsapp/logs',
    soloAdmin,
    async (req) => {
      const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 500);
      const offset = Math.max(Number(req.query.offset) || 0, 0);

      const where: { tipo?: 'CAIDA' | 'RECUPERACION' | 'PRUEBA' | 'BIENVENIDA'; exitoso?: boolean } = {};
      const tipoRaw = (req.query.tipo ?? '').toUpperCase();
      if (tipoRaw === 'CAIDA' || tipoRaw === 'RECUPERACION' || tipoRaw === 'PRUEBA' || tipoRaw === 'BIENVENIDA') {
        where.tipo = tipoRaw;
      }
      if (req.query.exitoso === 'true') where.exitoso = true;
      if (req.query.exitoso === 'false') where.exitoso = false;

      const [filas, total] = await Promise.all([
        prisma.whatsappEnvio.findMany({
          where,
          orderBy: { timestamp: 'desc' },
          skip: offset,
          take: limit,
        }),
        prisma.whatsappEnvio.count({ where }),
      ]);
      return { total, limit, offset, filas };
    },
  );

  // --- Info de la sesion del bot (para el onboarding wa.me + QR) ---

  app.get('/api/notifications/whatsapp/bot-info', soloAdmin, async () => {
    const info = await whatsapp.obtenerInfoSesion();
    return info ?? { phone: null, status: 'desconocido', pushName: null, sessionId: null };
  });

  // --- Prueba de envio ---

  app.post<{ Body: { texto?: string; numero?: string } }>(
    '/api/notifications/whatsapp/test',
    soloAdmin,
    async (req, reply) => {
      const texto =
        (req.body?.texto ?? '').trim() ||
        'Prueba del Monitor Pronetsys: la integracion con WhatsApp funciona correctamente.';
      const numero = req.body?.numero ? req.body.numero.replace(/\D+/g, '') : undefined;
      if (numero !== undefined && (numero.length < 7 || numero.length > 20)) {
        return reply.code(400).send({ error: 'numero invalido' });
      }
      const r = await whatsapp.enviarPrueba(texto, numero);
      return r;
    },
  );
}
