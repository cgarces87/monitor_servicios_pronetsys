/**
 * Prueba de envio por WhatsApp (open-wa) sin esperar una caida real.
 *
 *   npm run test:whatsapp
 *
 * Valida WHATSAPP_API_URL / WHATSAPP_API_KEY / WHATSAPP_RECIPIENTS del .env.
 */
import { whatsapp } from '../src/services/whatsapp';
import { env } from '../src/config/env';

async function main(): Promise<void> {
  console.log('--- Prueba WhatsApp (open-wa) ---');
  console.log('Habilitado:', env.whatsapp.enabled);
  console.log('API URL:', env.whatsapp.apiUrl || '(vacia)');
  console.log('API Key:', env.whatsapp.apiKey ? 'presente' : '(vacia)');
  console.log('Session ID:', env.whatsapp.sessionId || '(vacia)');
  console.log('Destinatarios:', env.whatsapp.recipients.length ? env.whatsapp.recipients.join(', ') : '(ninguno)');

  if (!whatsapp.estaConfigurado()) {
    console.error('\n[ERROR] WhatsApp no configurado. Revisa WHATSAPP_ENABLED=true, WHATSAPP_API_URL, WHATSAPP_API_KEY, WHATSAPP_SESSION_ID y WHATSAPP_RECIPIENTS en .env.');
    process.exit(1);
  }

  console.log('\nEnviando mensaje de prueba...');
  const enviados = await whatsapp.enviarAlerta(
    '🔔 Prueba del Monitor Pronetsys: la integracion con WhatsApp funciona correctamente.',
  );

  if (enviados > 0) {
    console.log(`\n[OK] Mensaje enviado a ${enviados} destinatario(s).`);
    process.exit(0);
  } else {
    console.error('\n[ERROR] No se pudo enviar a ningun destinatario. Revisa los logs de error de arriba (open-wa corriendo, API key, sesion de WhatsApp activa).');
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
