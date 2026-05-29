import axios, { AxiosError } from 'axios';
import { env } from '../config/env';
import { log } from '../utils/logger';

/**
 * Cliente para el gateway OpenWA (rmyndharis/OpenWA, NestJS + whatsapp-web.js).
 *
 *  Contrato:
 *    POST {WHATSAPP_API_URL}/sessions/{sessionId}/messages/send-text
 *    Header: X-API-Key: <key>
 *    Body:   { "chatId": "<numero>@c.us", "text": "<mensaje>" }
 *
 *  - WHATSAPP_API_URL incluye el prefijo /api (ej http://IP:2785/api).
 *  - Requiere una sesion ya creada y conectada (QR escaneado) en OpenWA.
 *  - Tolerante a fallos: NUNCA lanza; si falla, logea y sigue. El monitoreo
 *    no se cae porque WhatsApp este caido o la sesion desconectada.
 *
 *  Formato de numero: codigo de pais + numero, sin signos. Ej: 573001112233.
 *  El sufijo de chat (@c.us contactos, @g.us grupos) se agrega solo.
 */
class WhatsAppClient {
  estaConfigurado(): boolean {
    return Boolean(
      env.whatsapp.enabled &&
        env.whatsapp.apiUrl &&
        env.whatsapp.apiKey &&
        env.whatsapp.sessionId &&
        env.whatsapp.recipients.length > 0,
    );
  }

  /**
   * Envia un texto a todos los destinatarios configurados.
   * Devuelve cuantos envios tuvieron exito. Nunca lanza.
   */
  async enviarAlerta(texto: string): Promise<number> {
    if (!this.estaConfigurado()) {
      log.warn('WhatsApp no configurado o deshabilitado; omito alerta.', {
        enabled: env.whatsapp.enabled,
        tieneSesion: Boolean(env.whatsapp.sessionId),
        destinatarios: env.whatsapp.recipients.length,
      });
      return 0;
    }

    let enviados = 0;
    for (const numero of env.whatsapp.recipients) {
      const ok = await this.enviarA(numero, texto);
      if (ok) enviados++;
    }
    log.info(`WhatsApp: alerta enviada a ${enviados}/${env.whatsapp.recipients.length} destinatarios.`);
    return enviados;
  }

  private url(): string {
    return `${env.whatsapp.apiUrl}/sessions/${encodeURIComponent(env.whatsapp.sessionId)}/messages/send-text`;
  }

  private async enviarA(numero: string, texto: string): Promise<boolean> {
    const chatId = numero.includes('@') ? numero : `${numero}${env.whatsapp.chatSuffix}`;
    try {
      const resp = await axios.post(
        this.url(),
        { chatId, text: texto },
        {
          timeout: env.whatsapp.timeoutMs,
          validateStatus: () => true,
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': env.whatsapp.apiKey,
          },
        },
      );

      if (resp.status < 200 || resp.status >= 300) {
        log.error('WhatsApp: envio fallo (HTTP).', {
          chatId,
          httpStatus: resp.status,
          data: resp.data,
        });
        return false;
      }
      return true;
    } catch (err) {
      this.logError(chatId, err);
      return false;
    }
  }

  private logError(chatId: string, err: unknown): void {
    const detalle: Record<string, unknown> = { chatId };
    if (axios.isAxiosError(err)) {
      const ax = err as AxiosError;
      detalle.code = ax.code;
      detalle.message = ax.message;
    } else if (err instanceof Error) {
      detalle.message = err.message;
    } else {
      detalle.message = String(err);
    }
    log.error('WhatsApp: envio fallo (excepcion).', detalle);
  }
}

export const whatsapp = new WhatsAppClient();
