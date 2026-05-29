import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fastifyJwt from '@fastify/jwt';
import fastifyCookie from '@fastify/cookie';
import bcrypt from 'bcryptjs';
import { env } from '../config/env';
import { prisma } from '../db/prisma';
import { log } from '../utils/logger';

export interface JwtPayload {
  id: number;
  username: string;
  role: 'ADMIN' | 'VIEWER';
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: JwtPayload;
    user: JwtPayload;
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireAdmin: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

/**
 * Registra autenticacion basada en JWT guardado en una cookie httpOnly, y
 * expone las rutas de login/logout/me. Decora la instancia con:
 *   - authenticate: exige sesion valida (cualquier rol)
 *   - requireAdmin: exige rol ADMIN (usar siempre despues de authenticate)
 */
export async function registrarAuth(app: FastifyInstance): Promise<void> {
  if (!env.auth.jwtSecret) {
    throw new Error(
      '[auth] AUTH_JWT_SECRET es obligatorio cuando la API esta habilitada. ' +
        'Genera uno con: openssl rand -hex 32',
    );
  }

  await app.register(fastifyCookie);
  await app.register(fastifyJwt, {
    secret: env.auth.jwtSecret,
    cookie: { cookieName: env.auth.cookieName, signed: false },
    sign: { expiresIn: env.auth.tokenTtl },
  });

  app.decorate('authenticate', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      await req.jwtVerify();
    } catch {
      await reply.code(401).send({ error: 'No autenticado' });
    }
  });

  app.decorate('requireAdmin', async (req: FastifyRequest, reply: FastifyReply) => {
    if (req.user?.role !== 'ADMIN') {
      await reply.code(403).send({ error: 'Requiere rol de administrador' });
    }
  });

  // ---- Rutas ----

  app.post<{ Body: { username?: string; password?: string } }>(
    '/api/auth/login',
    async (req, reply) => {
      const username = (req.body?.username ?? '').trim();
      const password = req.body?.password ?? '';
      if (!username || !password) {
        return reply.code(400).send({ error: 'username y password son requeridos' });
      }

      const user = await prisma.user.findUnique({ where: { username } });
      // Comparar siempre (aunque no exista) para no filtrar usuarios por timing.
      const hash = user?.passwordHash ?? '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinv';
      const ok = await bcrypt.compare(password, hash);

      if (!user || !user.activo || !ok) {
        log.warn('Intento de login fallido.', { username });
        return reply.code(401).send({ error: 'Credenciales invalidas' });
      }

      const payload: JwtPayload = { id: user.id, username: user.username, role: user.role };
      const token = await reply.jwtSign(payload);

      reply.setCookie(env.auth.cookieName, token, {
        httpOnly: true,
        secure: env.auth.cookieSecure,
        sameSite: 'lax',
        path: '/',
      });

      return { id: user.id, username: user.username, role: user.role };
    },
  );

  app.post('/api/auth/logout', async (_req, reply) => {
    reply.clearCookie(env.auth.cookieName, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', { preHandler: [app.authenticate] }, async (req) => {
    return req.user;
  });

  // Cambio de la PROPIA contrasena (cualquier rol). Verifica la actual.
  app.post<{ Body: { currentPassword?: string; newPassword?: string } }>(
    '/api/auth/change-password',
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const currentPassword = req.body?.currentPassword ?? '';
      const newPassword = req.body?.newPassword ?? '';
      if (newPassword.length < 6) {
        return reply.code(400).send({ error: 'la nueva contrasena debe tener al menos 6 caracteres' });
      }

      const user = await prisma.user.findUnique({ where: { id: req.user.id } });
      if (!user || !user.activo) {
        return reply.code(401).send({ error: 'sesion invalida' });
      }

      const ok = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!ok) {
        return reply.code(400).send({ error: 'la contrasena actual es incorrecta' });
      }

      await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: await bcrypt.hash(newPassword, 10) },
      });
      return { ok: true };
    },
  );
}
