export type EstadoServicio = 'UP' | 'DOWN' | 'PAUSED';

export type MonitorType = 'HTTP' | 'TCP';

export type Role = 'ADMIN' | 'VIEWER';

export interface User {
  id: number;
  username: string;
  role: Role;
}

export interface UserAdmin {
  id: number;
  username: string;
  role: Role;
  activo: boolean;
  creadoEn: string;
}

export interface NotificacionConfig {
  id: number;
  whatsappEnabled: boolean;
  whatsappApiUrl: string | null;
  whatsappApiKey: string | null;
  whatsappSessionId: string | null;
  whatsappChatSuffix: string;
  whatsappTimeoutMs: number;
  notificarCaida: boolean;
  notificarRecuperacion: boolean;
  actualizadoEn: string;
}

export interface WhatsappRecipient {
  id: number;
  numero: string;
  etiqueta: string | null;
  activo: boolean;
  bienvenidaEnviada: boolean;
  bienvenidaEn: string | null;
  creadoEn: string;
}

export interface BotInfo {
  phone: string | null;
  status: string;
  pushName: string | null;
  sessionId: string | null;
}

export interface ResultadoEnvioWhatsApp {
  enviados: number;
  fallidos: number;
  detalles: { numero: string; ok: boolean; error?: string }[];
}

export type TipoEnvioWhatsapp = 'CAIDA' | 'RECUPERACION' | 'PRUEBA' | 'BIENVENIDA';

export interface WhatsappEnvio {
  id: number;
  tipo: TipoEnvioWhatsapp;
  destinatarioNumero: string;
  destinatarioEtiqueta: string | null;
  texto: string;
  exitoso: boolean;
  errorMsg: string | null;
  serviceId: number | null;
  incidentId: number | null;
  timestamp: string;
}

export interface ListaEnvios {
  total: number;
  limit: number;
  offset: number;
  filas: WhatsappEnvio[];
}

export interface ServicioResumen {
  id: number;
  nombre: string;
  tipo: MonitorType;
  url: string | null;
  host: string | null;
  puerto: number | null;
  intervaloMonitoreo: number;
  estadoActual: EstadoServicio;
  creadoEn: string;
  ultimoCheckEn: string | null;
  ultimaLatenciaMs: number | null;
  ultimoStatusCode: number | null;
}

export interface Summary {
  totalServicios: number;
  up: number;
  down: number;
  paused: number;
  incidentesAbiertos: number;
  ts: string;
}

export interface Incidente {
  id: number;
  serviceId: number;
  servicioNombre: string;
  servicioUrl: string;
  horaCaida: string;
  horaRecuperacion: string | null;
  abierto: boolean;
  duracionMs: number;
  detalleError: string | null;
  glpiTicketId: number | null;
  glpiEstado: number | null;
  glpiEstadoLabel: string | null;
  glpiEstadoSyncEn: string | null;
}

export interface UptimeStats {
  serviceId: number;
  ventanaHoras: number;
  muestras: number;
  uptimePct: number | null;
  latenciaPromedioMs: number | null;
  latenciaMinMs: number | null;
  latenciaMaxMs: number | null;
}

export interface LogPunto {
  latenciaMs: number;
  statusCode: number | null;
  timestamp: string;
}
