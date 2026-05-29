import { FastifyInstance } from 'fastify';
import { Prisma, Role } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { prisma } from '../../db/prisma';

/**
 * Gestion de usuarios del dashboard. TODAS las rutas requieren rol ADMIN.
 *   GET    /api/users        -> lista (sin passwordHash)
 *   POST   /api/users        -> crear { username, password, role }
 *   PATCH  /api/users/:id     -> { role?, activo?, password? }
 *   DELETE /api/users/:id     -> eliminar
 *
 * Protecciones anti-bloqueo: un admin no puede eliminarse, desactivarse ni
 * degradarse a si mismo (evita quedarse sin acceso).
 */
export async function registrarRutasUsers(app: FastifyInstance): Promise<void> {
  const soloAdmin = { preHandler: [app.authenticate, app.requireAdmin] };

  app.get('/api/users', soloAdmin, async () => {
    return prisma.user.findMany({
      orderBy: { id: 'asc' },
      select: { id: true, username: true, role: true, activo: true, creadoEn: true },
    });
  });

  app.post<{ Body: { username?: string; password?: string; role?: string } }>(
    '/api/users',
    soloAdmin,
    async (req, reply) => {
      const username = (req.body?.username ?? '').trim();
      const password = req.body?.password ?? '';
      const role = parseRole(req.body?.role);

      if (username.length < 3 || username.length > 80) {
        return reply.code(400).send({ error: 'username debe tener entre 3 y 80 caracteres' });
      }
      if (password.length < 6) {
        return reply.code(400).send({ error: 'la contrasena debe tener al menos 6 caracteres' });
      }

      try {
        const passwordHash = await bcrypt.hash(password, 10);
        const creado = await prisma.user.create({
          data: { username, passwordHash, role },
          select: { id: true, username: true, role: true, activo: true, creadoEn: true },
        });
        return reply.code(201).send(creado);
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          return reply.code(409).send({ error: 'ya existe un usuario con ese username' });
        }
        throw err;
      }
    },
  );

  app.patch<{ Params: { id: string }; Body: { role?: string; activo?: boolean; password?: string } }>(
    '/api/users/:id',
    soloAdmin,
    async (req, reply) => {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) return reply.code(400).send({ error: 'id invalido' });

      const existe = await prisma.user.findUnique({ where: { id } });
      if (!existe) return reply.code(404).send({ error: 'usuario no encontrado' });

      const esYoMismo = req.user.id === id;
      const data: Prisma.UserUpdateInput = {};

      if (req.body?.role !== undefined) {
        const role = parseRole(req.body.role);
        if (esYoMismo && role !== Role.ADMIN) {
          return reply.code(400).send({ error: 'no puedes quitarte a ti mismo el rol de admin' });
        }
        data.role = role;
      }

      if (req.body?.activo !== undefined) {
        if (esYoMismo && req.body.activo === false) {
          return reply.code(400).send({ error: 'no puedes desactivar tu propia cuenta' });
        }
        data.activo = Boolean(req.body.activo);
      }

      if (req.body?.password !== undefined) {
        if (req.body.password.length < 6) {
          return reply.code(400).send({ error: 'la contrasena debe tener al menos 6 caracteres' });
        }
        data.passwordHash = await bcrypt.hash(req.body.password, 10);
      }

      const actualizado = await prisma.user.update({
        where: { id },
        data,
        select: { id: true, username: true, role: true, activo: true, creadoEn: true },
      });
      return actualizado;
    },
  );

  app.delete<{ Params: { id: string } }>('/api/users/:id', soloAdmin, async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return reply.code(400).send({ error: 'id invalido' });
    if (req.user.id === id) {
      return reply.code(400).send({ error: 'no puedes eliminar tu propia cuenta' });
    }

    const existe = await prisma.user.findUnique({ where: { id } });
    if (!existe) return reply.code(404).send({ error: 'usuario no encontrado' });

    await prisma.user.delete({ where: { id } });
    return { ok: true, id };
  });
}

function parseRole(raw: string | undefined): Role {
  return (raw ?? '').toUpperCase() === 'ADMIN' ? Role.ADMIN : Role.VIEWER;
}
