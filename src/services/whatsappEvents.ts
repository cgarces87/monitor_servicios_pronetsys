import { io, type Socket } from 'socket.io-client';
import { prisma } from '../db/prisma';
import { log } from '../utils/logger';
import { obtenerConfig, whatsapp } from './whatsapp';

/**
 * Escucha eventos `message.received` del gateway OpenWA via Socket.IO. Cuando
 * un destinatario YA REGISTRADO le manda cualquier mensaje al bot por primera
 * vez (bienvenidaEnviada=false), le contesta con un mensaje de bienvenida y
 * lo marca como activado. Asi el destinatario sabe que ya quedo "presentado"
 * y el monitor confirma que la conversacion esta establecida (workaround del
 * LID de whatsapp-web.js).
 *
 * Reconexion manual con backoff de 30s para sobrevivir reinicios del gateway.
 */

let socket: Socket | null = null;
let reintentoTimer: NodeJS.Timeout | null = null;
let detenidoExpliciamente = false;

const RECONEXION_MS = 30_000;

async function conectar(): Promise<void> {
  detenidoExpliciamente = false;
  const c = await obtenerConfig();
  if (!c.whatsappEnabled || !c.whatsappApiUrl || !c.whatsappApiKey || !c.whatsappSessionId) {
    log.info('Eventos WhatsApp: config incompleta o deshabilitada, no se conecta.');
    return;
  }

  // apiUrl viene con /api al final; quitamos eso para llegar a /events.
  const base = c.whatsappApiUrl.replace(/\/+$/, '').replace(/\/api$/, '');
  log.info(`Eventos WhatsApp: conectando Socket.IO a ${base}/events ...`);

  socket = io(`${base}/events`, {
    transports: ['websocket'],
    extraHeaders: { 'X-API-Key': c.whatsappApiKey },
    auth: { 'X-API-Key': c.whatsappApiKey },
    reconnection: false, // hacemos backoff manual
  });

  socket.on('connect', () => {
    log.info('Eventos WhatsApp: conectado. Suscribiendo a message.received...');
    socket?.emit('message', {
      type: 'subscribe',
      sessionId: c.whatsappSessionId,
      events: ['message.received'],
      requestId: 'monitor-pronetsys',
    });
  });

  socket.on('message', (msg: unknown) => {
    void manejarEvento(msg);
  });

  socket.on('disconnect', (reason: string) => {
    log.warn(`Eventos WhatsApp: desconectado (${reason}). Reintento en ${RECONEXION_MS / 1000}s.`);
    programarReconexion();
  });

  socket.on('connect_error', (err: Error) => {
    log.warn(`Eventos WhatsApp: error de conexion: ${err.message}. Reintento en ${RECONEXION_MS / 1000}s.`);
    programarReconexion();
  });
}

async function manejarEvento(msg: unknown): Promise<void> {
  try {
    const m = msg as { type?: string; payload?: { event?: string; data?: { from?: string; body?: string } } };
    if (m?.type !== 'event' || m?.payload?.event !== 'message.received') return;

    const fromRaw = m.payload?.data?.from ?? '';
    const numero = fromRaw.split('@')[0].replace(/\D+/g, '');
    if (!numero) return;

    const recipient = await prisma.whatsappRecipient.findFirst({
      where: { numero, activo: true, bienvenidaEnviada: false },
    });
    if (!recipient) return;

    log.info(`Eventos WhatsApp: activacion detectada para ${numero}. Enviando bienvenida...`);
    const texto =
      `✅ ¡Activacion confirmada!\n\n` +
      `Hola${recipient.etiqueta ? ' ' + recipient.etiqueta : ''}, has sido registrado para recibir ` +
      `alertas del *Monitor Pronetsys*. A partir de ahora te llegaran notificaciones cuando un ` +
      `servicio se caiga o se recupere.\n\n` +
      `— Monitor Pronetsys`;

    const ok = await whatsapp.enviarBienvenida(numero, recipient.etiqueta, texto);
    if (ok) {
      await prisma.whatsappRecipient.update({
        where: { id: recipient.id },
        data: { bienvenidaEnviada: true, bienvenidaEn: new Date() },
      });
      log.info(`Eventos WhatsApp: bienvenida enviada a ${numero}.`);
    } else {
      log.warn(`Eventos WhatsApp: no se pudo enviar la bienvenida a ${numero}.`);
    }
  } catch (err) {
    log.error('Eventos WhatsApp: error procesando mensaje recibido.', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function programarReconexion(): void {
  if (detenidoExpliciamente || reintentoTimer) return;
  reintentoTimer = setTimeout(() => {
    reintentoTimer = null;
    if (!detenidoExpliciamente) void conectar();
  }, RECONEXION_MS);
}

export async function iniciarEventosWhatsApp(): Promise<void> {
  await conectar();
}

/** Reinicia la suscripcion. Util tras guardar nueva config desde la UI. */
export async function reiniciarEventosWhatsApp(): Promise<void> {
  detenerEventosWhatsApp();
  // pequena pausa para evitar reconexion inmediata sobre un socket recien cerrado
  await new Promise((r) => setTimeout(r, 250));
  await conectar();
}

export function detenerEventosWhatsApp(): void {
  detenidoExpliciamente = true;
  if (reintentoTimer) {
    clearTimeout(reintentoTimer);
    reintentoTimer = null;
  }
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
}
