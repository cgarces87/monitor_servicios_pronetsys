/**
 * Prueba de conectividad con GLPI sin esperar una caida real.
 *
 *   npm run test:glpi            -> crea un ticket de prueba (queda abierto)
 *   npm run test:glpi -- --close -> crea el ticket y lo resuelve/cierra
 *
 * Util para validar GLPI_APP_TOKEN / GLPI_USER_TOKEN / GLPI_URL del .env.
 */
import { glpi } from '../src/services/glpi';
import { env } from '../src/config/env';

async function main(): Promise<void> {
  console.log('--- Prueba GLPI ---');
  console.log('URL:', env.glpi.url || '(vacia)');
  console.log('App-Token:', env.glpi.appToken ? 'presente' : 'FALTA');
  console.log('User-Token:', env.glpi.userToken ? 'presente' : 'FALTA');
  console.log('Entity ID:', env.glpi.entityId);

  if (!glpi.estaConfigurado()) {
    console.error('\n[ERROR] GLPI no esta configurado. Llena GLPI_URL, GLPI_APP_TOKEN y GLPI_USER_TOKEN en .env.');
    process.exit(1);
  }

  console.log('\nCreando ticket de prueba...');
  const ticketId = await glpi.crearTicket({
    titulo: '[PRUEBA] Monitor Pronetsys - conectividad API',
    contenido:
      'Ticket de prueba generado por scripts/test-glpi.ts para validar la ' +
      'integracion del sistema de monitoreo con GLPI. Puede cerrarse sin accion.',
  });

  if (!ticketId) {
    console.error('\n[ERROR] No se pudo crear el ticket. Revisa los logs de error de arriba (tokens, permisos del usuario, API habilitada en GLPI).');
    process.exit(1);
  }

  console.log(`\n[OK] Ticket creado en GLPI con ID #${ticketId}.`);
  console.log(`     Verificalo en: ${env.glpi.url.replace('/apirest.php', '')}/front/ticket.form.php?id=${ticketId}`);

  if (process.argv.includes('--close')) {
    console.log('\nResolviendo/cerrando el ticket de prueba...');
    const ok = await glpi.cerrarTicket({
      ticketId,
      solucion: 'Cierre automatico de la prueba de conectividad del monitor.',
    });
    console.log(ok ? '[OK] Ticket resuelto/cerrado.' : '[ERROR] No se pudo cerrar el ticket.');
  } else {
    console.log('\n(El ticket quedo ABIERTO. Corre con "-- --close" para probar tambien el cierre.)');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
