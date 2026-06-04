import axios, { AxiosError } from 'axios';
import { NotificacionConfig, TipoEnvioWhatsapp, WhatsappRecipient } from '@prisma/client';
import { prisma } from '../db/prisma';
import { env } from '../config/env';
import { log } from '../utils/logger';

/**
 * Cliente para el gateway OpenWA (rmyndharis/OpenWA, NestJS + whatsapp-web.js).
 *
 *  Contrato:
 *    POST {apiUrl}/sessions/{sessionId}/messages/send-text
 *    Header: X-API-Key: {apiKey}
 *    Body:   { "chatId": "<numero>@c.us", "text": "<mensaje>" }
 *
 *  La configuracion se lee SIEMPRE desde la BD (singleton notificacion_config +
 *  whatsapp_recipients), no del .env. El .env queda como fallback de PRIMERA
 *  ejecucion para sembrar la BD (ver inicializarConfigDesdeEnv).
 *
 *  Tolerante a fallos: NUNCA lanza; si falla, logea y sigue.
 */

export type Evento = 'caida' | 'recuperacion';

export type ResultadoEnvio = {
  enviados: number;
  fallidos: number;
  detalles: { numero: string; ok: boolean; error?: string }[];
};

type DestinatarioMin = { numero: string; etiqueta: string | null };

type ContextoEnvio = {
  tipo: TipoEnvioWhatsapp;
  serviceId?: number | null;
  incidentId?: number | null;
};

class WhatsAppClient {
  /** True solo si la config minima de BD esta lista y hay destinatarios activos. */
  /**
   * Consulta a OpenWA el estado de la sesion configurada y devuelve la info
   * util para onboarding (numero del bot, status, nombre). null si falla.
   */
  async obtenerInfoSesion(): Promise<{
    phone: string;
    status: string;
    pushName: string | null;
    sessionId: string;
  } | null> {
    const c = await obtenerConfig();
    if (!c.whatsappApiUrl || !c.whatsappApiKey || !c.whatsappSessionId) return null;
    const baseUrl = c.whatsappApiUrl.replace(/\/+$/, '');
    const url = `${baseUrl}/sessions/${encodeURIComponent(c.whatsappSessionId)}`;
    try {
      const resp = await axios.get(url, {
        timeout: c.whatsappTimeoutMs,
        validateStatus: () => true,
        headers: { 'X-API-Key': c.whatsappApiKey },
      });
      if (resp.status < 200 || resp.status >= 300) {
        log.warn('OpenWA: GET session devolvio no-2xx', { httpStatus: resp.status });
        return null;
      }
      const d = resp.data;
      if (!d || typeof d.phone !== 'string') return null;
      return {
        phone: d.phone,
        status: String(d.status ?? ''),
        pushName: typeof d.pushName === 'string' ? d.pushName : null,
        sessionId: c.whatsappSessionId,
      };
    } catch (err) {
      log.warn('OpenWA: fallo al leer info de sesion', {
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  async estaConfigurado(): Promise<boolean> {
    const c = await obtenerConfig();
    if (!c.whatsappEnabled || !c.whatsappApiUrl || !c.whatsappApiKey || !c.whatsappSessionId) return false;
    const dest = await obtenerDestinatariosActivos();
    return dest.length > 0;
  }

  /**
   * Envia una alerta de evento (caida o recuperacion). Respeta los flags
   * notificarCaida / notificarRecuperacion. Devuelve el numero de envios OK.
   * Cada intento se persiste en `whatsapp_envios` para auditoria.
   */
  async enviarAlerta(
    texto: string,
    evento: Evento,
    extra?: { serviceId?: number | null; incidentId?: number | null },
  ): Promise<number> {
    const c = await obtenerConfig();
    if (!c.whatsappEnabled) {
      log.warn(`WhatsApp deshabilitado; omito alerta de ${evento}.`);
      return 0;
    }
    if (evento === 'caida' && !c.notificarCaida) return 0;
    if (evento === 'recuperacion' && !c.notificarRecuperacion) return 0;

    // Si la alerta corresponde a un servicio especifico, filtramos por
    // suscripciones; si no, mandamos a todos los activos.
    const dest = extra?.serviceId
      ? await obtenerDestinatariosParaServicio(extra.serviceId)
      : await obtenerDestinatariosActivos();
    if (dest.length === 0) {
      log.warn('WhatsApp sin destinatarios activos para este servicio; omito alerta.', {
        serviceId: extra?.serviceId ?? null,
      });
      return 0;
    }

    const r = await this.enviarATodos(c, dest, texto, {
      tipo: evento === 'caida' ? TipoEnvioWhatsapp.CAIDA : TipoEnvioWhatsapp.RECUPERACION,
      serviceId: extra?.serviceId ?? null,
      incidentId: extra?.incidentId ?? null,
    });
    log.info(`WhatsApp: alerta de ${evento} enviada a ${r.enviados}/${dest.length} destinatarios.`);
    return r.enviados;
  }

  /**
   * Envia un mensaje de prueba a todos los destinatarios activos (o a uno
   * solo si se pasa `aNumero`). Ignora los flags de eventos. Devuelve detalle
   * por destinatario para que el panel muestre quien recibio y quien no.
   */
  async enviarPrueba(texto: string, aNumero?: string): Promise<ResultadoEnvio> {
    const c = await obtenerConfig();
    if (!c.whatsappEnabled) {
      return { enviados: 0, fallidos: 0, detalles: [] };
    }

    const dest: DestinatarioMin[] = aNumero
      ? [{ numero: aNumero, etiqueta: null }]
      : (await obtenerDestinatariosActivos()).map((d) => ({ numero: d.numero, etiqueta: d.etiqueta }));

    return this.enviarATodos(c, dest, texto, { tipo: TipoEnvioWhatsapp.PRUEBA });
  }

  /** Envia el mensaje de bienvenida que confirma la activacion. */
  async enviarBienvenida(numero: string, etiqueta: string | null, texto: string): Promise<boolean> {
    const c = await obtenerConfig();
    if (!c.whatsappEnabled) return false;
    const r = await this.enviarATodos(c, [{ numero, etiqueta }], texto, {
      tipo: TipoEnvioWhatsapp.BIENVENIDA,
    });
    return r.enviados > 0;
  }

  private async enviarATodos(
    c: NotificacionConfig,
    dest: DestinatarioMin[],
    texto: string,
    ctx: ContextoEnvio,
  ): Promise<ResultadoEnvio> {
    const detalles: ResultadoEnvio['detalles'] = [];
    for (const d of dest) {
      const res = await this.enviarA(c, d, texto, ctx);
      detalles.push({ numero: d.numero, ok: res.ok, error: res.error });
    }
    const enviados = detalles.filter((x) => x.ok).length;
    return { enviados, fallidos: detalles.length - enviados, detalles };
  }

  private async enviarA(
    c: NotificacionConfig,
    d: DestinatarioMin,
    texto: string,
    ctx: ContextoEnvio,
  ): Promise<{ ok: boolean; error?: string }> {
    const numero = d.numero;
    const chatId = numero.includes('@') ? numero : `${numero}${c.whatsappChatSuffix}`;
    const baseUrl = (c.whatsappApiUrl ?? '').replace(/\/+$/, '');
    const url = `${baseUrl}/sessions/${encodeURIComponent(c.whatsappSessionId ?? '')}/messages/send-text`;

    let resultado: { ok: boolean; error?: string };
    try {
      const resp = await axios.post(
        url,
        { chatId, text: texto },
        {
          timeout: c.whatsappTimeoutMs,
          validateStatus: () => true,
          headers: { 'Content-Type': 'application/json', 'X-API-Key': c.whatsappApiKey ?? '' },
        },
      );
      if (resp.status < 200 || resp.status >= 300) {
        const msg = `HTTP ${resp.status} ${typeof resp.data === 'object' ? JSON.stringify(resp.data) : String(resp.data)}`;
        log.error('WhatsApp: envio fallo (HTTP).', { chatId, httpStatus: resp.status });
        resultado = { ok: false, error: msg };
      } else {
        resultado = { ok: true };
      }
    } catch (err) {
      const msg = axios.isAxiosError(err)
        ? `${(err as AxiosError).code ?? 'error'}: ${(err as AxiosError).message}`
        : err instanceof Error
          ? err.message
          : String(err);
      log.error('WhatsApp: envio fallo (excepcion).', { chatId, error: msg });
      resultado = { ok: false, error: msg };
    }

    // Persistir log de auditoria (best-effort; nunca rompe el envio).
    try {
      await prisma.whatsappEnvio.create({
        data: {
          tipo: ctx.tipo,
          destinatarioNumero: numero,
          destinatarioEtiqueta: d.etiqueta,
          texto: texto.substring(0, 4000),
          exitoso: resultado.ok,
          errorMsg: resultado.error ? resultado.error.substring(0, 500) : null,
          serviceId: ctx.serviceId ?? null,
          incidentId: ctx.incidentId ?? null,
        },
      });
    } catch (e) {
      log.warn('No se pudo persistir log de envio WhatsApp.', {
        error: e instanceof Error ? e.message : String(e),
      });
    }

    return resultado;
  }
}

export const whatsapp = new WhatsAppClient();

// ---------------------------------------------------------------------------
// Helpers de configuracion en BD
// ---------------------------------------------------------------------------

const CONFIG_ID = 1;

/** Obtiene la fila singleton; la crea con defaults si no existe. */
export async function obtenerConfig(): Promise<NotificacionConfig> {
  const existente = await prisma.notificacionConfig.findUnique({ where: { id: CONFIG_ID } });
  if (existente) return existente;
  return prisma.notificacionConfig.create({ data: { id: CONFIG_ID } });
}

export async function obtenerDestinatariosActivos(): Promise<WhatsappRecipient[]> {
  return prisma.whatsappRecipient.findMany({ where: { activo: true }, orderBy: { id: 'asc' } });
}

/**
 * Destinatarios activos que deben recibir alertas de un servicio especifico.
 * Regla: si un destinatario NO tiene suscripciones (catch-all) -> incluido.
 *        Si tiene suscripciones -> incluido solo si tiene a este servicio.
 */
export async function obtenerDestinatariosParaServicio(serviceId: number): Promise<WhatsappRecipient[]> {
  return prisma.whatsappRecipient.findMany({
    where: {
      activo: true,
      OR: [
        { servicios: { none: {} } },
        { servicios: { some: { serviceId } } },
      ],
    },
    orderBy: { id: 'asc' },
  });
}

/**
 * Compatibilidad: en el PRIMER arranque tras migrar, si la config en BD esta
 * vacia y el .env tiene valores antiguos de WhatsApp, los sembramos. Despues
 * de la primera escritura por UI, el .env queda irrelevante.
 */
export async function inicializarConfigDesdeEnv(): Promise<void> {
  const c = await obtenerConfig();
  const sembrarConfig = !c.whatsappApiUrl && !c.whatsappApiKey && !c.whatsappSessionId;
  if (sembrarConfig && (env.whatsapp.apiUrl || env.whatsapp.apiKey || env.whatsapp.sessionId)) {
    await prisma.notificacionConfig.update({
      where: { id: CONFIG_ID },
      data: {
        whatsappEnabled: env.whatsapp.enabled,
        whatsappApiUrl: env.whatsapp.apiUrl || null,
        whatsappApiKey: env.whatsapp.apiKey || null,
        whatsappSessionId: env.whatsapp.sessionId || null,
        whatsappChatSuffix: env.whatsapp.chatSuffix,
        whatsappTimeoutMs: env.whatsapp.timeoutMs,
      },
    });
    log.info('Config de WhatsApp sembrada desde .env (compat de primer arranque).');
  }

  const totalDest = await prisma.whatsappRecipient.count();
  if (totalDest === 0 && env.whatsapp.recipients.length > 0) {
    await prisma.whatsappRecipient.createMany({
      data: env.whatsapp.recipients.map((n) => ({ numero: n })),
    });
    log.info(`Destinatarios WhatsApp sembrados desde .env: ${env.whatsapp.recipients.length}.`);
  }
}
