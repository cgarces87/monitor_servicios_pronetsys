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
