import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const servicios = [
    { nombre: 'Portal Corporativo Pronetsys', url: 'https://www.pronetsys.com.co', intervaloMonitoreo: 60 },
    { nombre: 'Mesa de Ayuda GLPI',           url: 'https://soporte.pronetsys.com.co/glpi', intervaloMonitoreo: 60 },
    { nombre: 'Prueba de conectividad (Google 204)', url: 'https://www.google.com/generate_204', intervaloMonitoreo: 60 },
  ];

  for (const s of servicios) {
    await prisma.service.upsert({
      where: { id: 0 }, // no existira; forzamos crear
      update: {},
      create: s,
    }).catch(async () => {
      // upsert con id=0 fallara siempre; usamos create directo evitando duplicados por URL
      const existe = await prisma.service.findFirst({ where: { url: s.url } });
      if (!existe) await prisma.service.create({ data: s });
    });
  }

  console.log('[seed] Servicios iniciales cargados.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
