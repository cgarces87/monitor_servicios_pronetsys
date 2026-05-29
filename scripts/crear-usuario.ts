/**
 * Crea (o actualiza) un usuario del dashboard.
 *
 *   npm run user:create -- <username> <password> [admin|viewer]
 *
 * Si el rol se omite, se crea como ADMIN (util para el primer usuario).
 * Si el usuario ya existe, actualiza su password y rol (lo reactiva).
 */
import bcrypt from 'bcryptjs';
import { Role } from '@prisma/client';
import { prisma } from '../src/db/prisma';

async function main(): Promise<void> {
  const [username, password, roleArg] = process.argv.slice(2);

  if (!username || !password) {
    console.error('Uso: npm run user:create -- <username> <password> [admin|viewer]');
    process.exit(1);
  }
  if (password.length < 6) {
    console.error('La contrasena debe tener al menos 6 caracteres.');
    process.exit(1);
  }

  const role: Role = (roleArg ?? 'admin').toLowerCase() === 'viewer' ? Role.VIEWER : Role.ADMIN;
  const passwordHash = await bcrypt.hash(password, 10);

  const user = await prisma.user.upsert({
    where: { username },
    update: { passwordHash, role, activo: true },
    create: { username, passwordHash, role },
  });

  console.log(`[OK] Usuario "${user.username}" (${user.role}) creado/actualizado.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
