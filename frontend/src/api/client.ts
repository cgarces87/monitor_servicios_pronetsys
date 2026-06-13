import type {
  BotInfo,
  Incidente,
  ListaEnvios,
  LogPunto,
  NotificacionConfig,
  ResultadoEnvioWhatsApp,
  Role,
  ServicioResumen,
  Summary,
  UptimeStats,
  User,
  UserAdmin,
  WhatsappRecipient,
} from '../types';

// Rutas relativas: en dev las proxea Vite, en prod las sirve Nginx.
const BASE = '/api';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

// Handler global para 401: AuthContext lo usa para volver al login si la
// sesion expira en cualquier peticion.
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  onUnauthorized = fn;
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

async function request<T>(method: Method, path: string, body?: unknown): Promise<T> {
  const resp = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    credentials: 'include',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (resp.status === 401) {
    if (onUnauthorized) onUnauthorized();
    throw new ApiError('No autenticado', 401);
  }

  if (!resp.ok) {
    let msg = `HTTP ${resp.status}`;
    try {
      const j = await resp.json();
      if (j?.error) msg = j.error;
    } catch {
      /* sin cuerpo JSON */
    }
    throw new ApiError(msg, resp.status);
  }

  if (resp.status === 204) return undefined as T;
  return (await resp.json()) as T;
}

export const api = {
  // --- Auth ---
  me: () => request<User>('GET', '/auth/me'),
  login: (username: string, password: string) =>
    request<User>('POST', '/auth/login', { username, password }),
  logout: () => request<{ ok: boolean }>('POST', '/auth/logout'),
  changeMyPassword: (currentPassword: string, newPassword: string) =>
    request<{ ok: boolean }>('POST', '/auth/change-password', { currentPassword, newPassword }),

  // --- Lectura ---
  summary: () => request<Summary>('GET', '/summary'),
  services: () => request<ServicioResumen[]>('GET', '/services'),
  incidents: (params: { open?: boolean; serviceId?: number; limit?: number } = {}) => {
    const qs = new URLSearchParams();
    if (params.open) qs.set('open', 'true');
    if (params.serviceId !== undefined) qs.set('serviceId', String(params.serviceId));
    if (params.limit !== undefined) qs.set('limit', String(params.limit));
    const q = qs.toString();
    return request<Incidente[]>('GET', `/incidents${q ? '?' + q : ''}`);
  },
  uptime: (id: number, window = '24h') =>
    request<UptimeStats>('GET', `/services/${id}/uptime?window=${window}`),
  logs: (id: number, limit = 100) =>
    request<LogPunto[]>('GET', `/services/${id}/logs?limit=${limit}`),

  // --- Escritura de servicios (solo ADMIN) ---
  createService: (data: ServicioInput) => request<ServicioResumen>('POST', '/services', data),
  updateService: (id: number, data: ServicioInput) =>
    request<ServicioResumen>('PUT', `/services/${id}`, data),
  setServiceState: (id: number, accion: 'pause' | 'resume') =>
    request<ServicioResumen>('PATCH', `/services/${id}/estado`, { accion }),
  deleteService: (id: number) => request<{ ok: boolean; id: number }>('DELETE', `/services/${id}`),

  // --- Gestion de usuarios (solo ADMIN) ---
  users: () => request<UserAdmin[]>('GET', '/users'),
  createUser: (data: { username: string; password: string; role: Role }) =>
    request<UserAdmin>('POST', '/users', data),
  updateUser: (id: number, data: { role?: Role; activo?: boolean; password?: string }) =>
    request<UserAdmin>('PATCH', `/users/${id}`, data),
  deleteUser: (id: number) => request<{ ok: boolean; id: number }>('DELETE', `/users/${id}`),

  // --- Notificaciones WhatsApp (solo ADMIN) ---
  whatsappConfig: () => request<NotificacionConfig>('GET', '/notifications/whatsapp'),
  updateWhatsappConfig: (data: Partial<Omit<NotificacionConfig, 'id' | 'actualizadoEn'>>) =>
    request<NotificacionConfig>('PUT', '/notifications/whatsapp', data),
  whatsappRecipients: () => request<WhatsappRecipient[]>('GET', '/notifications/whatsapp/recipients'),
  addWhatsappRecipient: (data: { numero: string; etiqueta?: string; serviceIds?: number[] }) =>
    request<WhatsappRecipient>('POST', '/notifications/whatsapp/recipients', data),
  updateWhatsappRecipient: (
    id: number,
    data: { activo?: boolean; etiqueta?: string | null; serviceIds?: number[] },
  ) => request<WhatsappRecipient>('PATCH', `/notifications/whatsapp/recipients/${id}`, data),
  deleteWhatsappRecipient: (id: number) =>
    request<{ ok: boolean; id: number }>('DELETE', `/notifications/whatsapp/recipients/${id}`),
  testWhatsapp: (texto: string, numero?: string) =>
    request<ResultadoEnvioWhatsApp>('POST', '/notifications/whatsapp/test', { texto, numero }),
  whatsappBotInfo: () => request<BotInfo>('GET', '/notifications/whatsapp/bot-info'),
  whatsappLogs: (params: { limit?: number; offset?: number; tipo?: string; exitoso?: 'true' | 'false' } = {}) => {
    const qs = new URLSearchParams();
    if (params.limit !== undefined) qs.set('limit', String(params.limit));
    if (params.offset !== undefined) qs.set('offset', String(params.offset));
    if (params.tipo) qs.set('tipo', params.tipo);
    if (params.exitoso) qs.set('exitoso', params.exitoso);
    const q = qs.toString();
    return request<ListaEnvios>('GET', `/notifications/whatsapp/logs${q ? '?' + q : ''}`);
  },
};

export interface ServicioInput {
  nombre: string;
  tipo: 'HTTP' | 'TCP';
  url?: string;
  host?: string;
  puerto?: number;
  intervaloMonitoreo: number;
}
