import axios, { AxiosError, AxiosInstance } from 'axios';
import { env } from '../config/env';
import { log } from '../utils/logger';

/**
 * Cliente minimo para la API REST de GLPI.
 *
 *  - Se autentica por App-Token + User-Token (sin password, sin basic auth).
 *  - Stateless: cada operacion abre y mata su propia sesion. Asi evitamos
 *    lidiar con expiracion de session_token en un proceso de larga vida.
 *  - Tolerante a fallos: las excepciones de red NO se propagan al motor;
 *    se devuelven como null y se logean. El monitoreo nunca se cae por
 *    una falla en GLPI.
 *
 *  Statuses GLPI:  1=Nuevo  2=Asignado  3=Planificado  4=Pendiente
 *                  5=Resuelto  6=Cerrado
 */

const STATUS_RESOLVED = 5;
const STATUS_CLOSED   = 6;

const ETIQUETAS_ESTADO: Record<number, string> = {
  1: 'Nuevo',
  2: 'En curso (asignado)',
  3: 'En curso (planificado)',
  4: 'Pendiente',
  5: 'Resuelto',
  6: 'Cerrado',
};

/** Devuelve la etiqueta legible de un status GLPI (1..6). */
export function etiquetaEstadoGlpi(status: number | null | undefined): string | null {
  if (status === null || status === undefined) return null;
  return ETIQUETAS_ESTADO[status] ?? `Estado ${status}`;
}

export type CrearTicketInput = {
  titulo: string;
  contenido: string;
};

export type CerrarTicketInput = {
  ticketId: number;
  solucion: string;
  // true = el ticket ya tiene la solucion del monitor (un cierre anterior
  // quedo a medias): solo se fuerza el status final, sin duplicarla.
  soloEstado?: boolean;
};

export type SolucionesTicket = {
  propias: number;      // del usuario del monitor y no rechazadas
  bloqueantes: number;  // de otro usuario, o rechazadas (el ticket fue reabierto)
};

// ITILSolution.status en GLPI: 2=en espera, 3=aceptada, 4=rechazada.
const SOLUCION_RECHAZADA = 4;

export type EstadoTicketResultado =
  // creadorId = users_id_recipient (quien abrio el ticket en GLPI).
  | { tipo: 'ok'; status: number; creadorId: number | null }
  | { tipo: 'no_encontrado' }
  | { tipo: 'error' };

class GlpiClient {
  private http: AxiosInstance;
  // ID del usuario GLPI dueno del User-Token (el "bot" del monitor). Se
  // consulta una sola vez por proceso.
  private usuarioMonitorId: number | null = null;

  constructor() {
    this.http = axios.create({
      baseURL: env.glpi.url,
      timeout: env.glpi.timeoutMs,
      headers: { 'Content-Type': 'application/json' },
      validateStatus: () => true,
    });
  }

  /** True solo si todas las credenciales minimas estan presentes. */
  estaConfigurado(): boolean {
    return Boolean(env.glpi.url && env.glpi.appToken && env.glpi.userToken);
  }

  /** Abre sesion y devuelve el session_token. Lanza si falla. */
  private async abrirSesion(): Promise<string> {
    const resp = await this.http.get('/initSession', {
      headers: {
        'App-Token': env.glpi.appToken,
        Authorization: `user_token ${env.glpi.userToken}`,
      },
    });
    if (resp.status !== 200 || !resp.data?.session_token) {
      throw new Error(`initSession fallo: HTTP ${resp.status} ${JSON.stringify(resp.data)}`);
    }
    return resp.data.session_token as string;
  }

  /** Mata la sesion (best effort, nunca lanza). */
  private async matarSesion(sessionToken: string): Promise<void> {
    try {
      await this.http.get('/killSession', {
        headers: this.authHeaders(sessionToken),
      });
    } catch (err) {
      log.warn('killSession fallo (ignorado).', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private authHeaders(sessionToken: string): Record<string, string> {
    return {
      'App-Token': env.glpi.appToken,
      'Session-Token': sessionToken,
    };
  }

  /**
   * Crea un ticket nuevo en GLPI. Devuelve el ID del ticket creado o null
   * si la operacion falla (red, auth, 5xx, etc.). Nunca lanza.
   */
  async crearTicket(input: CrearTicketInput): Promise<number | null> {
    if (!this.estaConfigurado()) {
      log.warn('GLPI no configurado; omito crearTicket.');
      return null;
    }

    let session: string | null = null;
    try {
      session = await this.abrirSesion();

      const body = {
        input: {
          name: input.titulo.substring(0, 250),
          content: input.contenido,
          urgency: env.glpi.defaultUrgency,
          impact: env.glpi.defaultImpact,
          entities_id: env.glpi.entityId,
          ...(env.glpi.categoryId !== null
            ? { itilcategories_id: env.glpi.categoryId }
            : {}),
        },
      };

      const resp = await this.http.post('/Ticket', body, {
        headers: this.authHeaders(session),
      });

      if (resp.status < 200 || resp.status >= 300) {
        throw new Error(`POST /Ticket -> HTTP ${resp.status} ${JSON.stringify(resp.data)}`);
      }

      // Respuesta puede venir como {id, message} o como array si fueran multiples.
      const payload = Array.isArray(resp.data) ? resp.data[0] : resp.data;
      const id = Number(payload?.id);
      if (!Number.isFinite(id) || id <= 0) {
        throw new Error(`Respuesta inesperada de GLPI: ${JSON.stringify(resp.data)}`);
      }
      return id;
    } catch (err) {
      this.logError('crearTicket', err);
      return null;
    } finally {
      if (session) await this.matarSesion(session);
    }
  }

  /**
   * Marca un ticket como Resuelto (o Cerrado, segun config) y agrega la
   * descripcion de la solucion. Devuelve true si tuvo exito, false si fallo.
   */
  async cerrarTicket(input: CerrarTicketInput): Promise<boolean> {
    if (!this.estaConfigurado()) {
      log.warn('GLPI no configurado; omito cerrarTicket.', { ticketId: input.ticketId });
      return false;
    }

    let session: string | null = null;
    try {
      session = await this.abrirSesion();
      const headers = this.authHeaders(session);

      // 1) Agregar ITILSolution (esto suele dejar el ticket en estado "Resuelto")
      if (!input.soloEstado) {
        const solucion = await this.http.post(
          '/ITILSolution',
          {
            input: {
              itemtype: 'Ticket',
              items_id: input.ticketId,
              content: input.solucion,
            },
          },
          { headers },
        );
        if (solucion.status < 200 || solucion.status >= 300) {
          throw new Error(`POST /ITILSolution -> HTTP ${solucion.status} ${JSON.stringify(solucion.data)}`);
        }
      }

      // 2) Forzar el status final segun config (defensivo: GLPI podria no haberlo
      //    marcado automaticamente si la categoria/template no lo permite).
      const statusFinal =
        env.glpi.resolveMode === 'closed' ? STATUS_CLOSED : STATUS_RESOLVED;

      const upd = await this.http.put(
        `/Ticket/${input.ticketId}`,
        { input: { status: statusFinal } },
        { headers },
      );
      if (upd.status < 200 || upd.status >= 300) {
        throw new Error(`PUT /Ticket/${input.ticketId} -> HTTP ${upd.status} ${JSON.stringify(upd.data)}`);
      }

      return true;
    } catch (err) {
      this.logError('cerrarTicket', err, { ticketId: input.ticketId });
      return false;
    } finally {
      if (session) await this.matarSesion(session);
    }
  }

  /**
   * Lee el status actual de un ticket en GLPI.
   *   { tipo: 'ok', status }   -> ticket existe; status 1..6
   *   { tipo: 'no_encontrado' } -> GLPI confirma que el ticket fue eliminado (404 item-not-found)
   *   { tipo: 'error' }         -> fallo transitorio (red/auth/5xx/URL) -> NO asumir que no existe
   * Nunca lanza.
   */
  async obtenerEstadoTicket(ticketId: number): Promise<EstadoTicketResultado> {
    return (await this.obtenerEstadosTickets([ticketId])).get(ticketId) ?? { tipo: 'error' };
  }

  /**
   * Igual que obtenerEstadoTicket pero para varios tickets con UNA sola sesion
   * (la sincronizacion consulta cientos por ronda). Nunca lanza: los tickets
   * que no se pudieron leer quedan como { tipo: 'error' }.
   */
  async obtenerEstadosTickets(ticketIds: number[]): Promise<Map<number, EstadoTicketResultado>> {
    const resultado = new Map<number, EstadoTicketResultado>();
    if (!this.estaConfigurado() || ticketIds.length === 0) return resultado;

    let session: string | null = null;
    try {
      session = await this.abrirSesion();
      for (const ticketId of ticketIds) {
        resultado.set(ticketId, await this.leerTicket(session, ticketId));
      }
    } catch (err) {
      this.logError('obtenerEstadosTickets', err, { tickets: ticketIds.length });
    } finally {
      if (session) await this.matarSesion(session);
    }
    return resultado;
  }

  private async leerTicket(session: string, ticketId: number): Promise<EstadoTicketResultado> {
    try {
      const resp = await this.http.get(`/Ticket/${ticketId}`, {
        headers: this.authHeaders(session),
      });

      // Solo lo tratamos como "no existe" si es 404 Y el cuerpo de GLPI lo
      // confirma (item not found). Un 404 generico (URL/ruta mal) NO cuenta,
      // para evitar borrar incidentes por una mala configuracion.
      if (resp.status === 404 && /not[_ ]?found/i.test(JSON.stringify(resp.data ?? ''))) {
        return { tipo: 'no_encontrado' };
      }
      if (resp.status < 200 || resp.status >= 300) {
        throw new Error(`GET /Ticket/${ticketId} -> HTTP ${resp.status} ${JSON.stringify(resp.data)}`);
      }
      const status = Number(resp.data?.status);
      const creador = Number(resp.data?.users_id_recipient);
      return Number.isFinite(status)
        ? { tipo: 'ok', status, creadorId: Number.isFinite(creador) && creador > 0 ? creador : null }
        : { tipo: 'error' };
    } catch (err) {
      this.logError('obtenerEstadoTicket', err, { ticketId });
      return { tipo: 'error' };
    }
  }

  /**
   * ID del usuario GLPI con el que opera el monitor (el que crea los tickets).
   * null si no se pudo determinar. Nunca lanza.
   */
  async idUsuarioMonitor(): Promise<number | null> {
    if (this.usuarioMonitorId !== null || !this.estaConfigurado()) return this.usuarioMonitorId;

    let session: string | null = null;
    try {
      session = await this.abrirSesion();
      const resp = await this.http.get('/getFullSession', { headers: this.authHeaders(session) });
      if (resp.status < 200 || resp.status >= 300) {
        throw new Error(`GET /getFullSession -> HTTP ${resp.status} ${JSON.stringify(resp.data)}`);
      }
      const id = Number(resp.data?.session?.glpiID);
      if (!Number.isFinite(id) || id <= 0) throw new Error('getFullSession sin glpiID');
      this.usuarioMonitorId = id;
      return id;
    } catch (err) {
      this.logError('idUsuarioMonitor', err);
      return null;
    } finally {
      if (session) await this.matarSesion(session);
    }
  }

  /**
   * Clasifica las soluciones (ITILSolution) del ticket segun su autor y si
   * fueron rechazadas. null si no se pudo consultar. Nunca lanza.
   */
  async revisarSoluciones(ticketId: number): Promise<SolucionesTicket | null> {
    const monitorId = await this.idUsuarioMonitor();
    if (monitorId === null) return null;

    let session: string | null = null;
    try {
      session = await this.abrirSesion();
      const resp = await this.http.get(`/Ticket/${ticketId}/ITILSolution`, {
        headers: this.authHeaders(session),
      });
      if (resp.status < 200 || resp.status >= 300) {
        throw new Error(`GET /Ticket/${ticketId}/ITILSolution -> HTTP ${resp.status} ${JSON.stringify(resp.data)}`);
      }
      const lista: Array<{ users_id?: number; status?: number }> = Array.isArray(resp.data) ? resp.data : [];
      const bloqueantes = lista.filter(
        (s) => Number(s.users_id) !== monitorId || Number(s.status) === SOLUCION_RECHAZADA,
      ).length;
      return { propias: lista.length - bloqueantes, bloqueantes };
    } catch (err) {
      this.logError('revisarSoluciones', err, { ticketId });
      return null;
    } finally {
      if (session) await this.matarSesion(session);
    }
  }

  private logError(operacion: string, err: unknown, meta: Record<string, unknown> = {}): void {
    const detalle: Record<string, unknown> = { operacion, ...meta };
    if (axios.isAxiosError(err)) {
      const ax = err as AxiosError;
      detalle.code = ax.code;
      detalle.message = ax.message;
      if (ax.response) {
        detalle.httpStatus = ax.response.status;
        detalle.responseData = ax.response.data;
      }
    } else if (err instanceof Error) {
      detalle.message = err.message;
    } else {
      detalle.message = String(err);
    }
    log.error(`GLPI ${operacion} fallo.`, detalle);
  }
}

export const glpi = new GlpiClient();
