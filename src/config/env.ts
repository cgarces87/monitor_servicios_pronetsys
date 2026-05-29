import dotenv from 'dotenv';

dotenv.config();

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === '') {
    throw new Error(`[config] Variable de entorno requerida: ${name}`);
  }
  return v;
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

export type GlpiResolveMode = 'solved' | 'closed';

function parseResolveMode(raw: string | undefined): GlpiResolveMode {
  return raw === 'closed' ? 'closed' : 'solved';
}

function maybeInt(name: string): number | null {
  const raw = process.env[name];
  if (!raw || raw.trim() === '') return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

export const env = {
  databaseUrl: required('DATABASE_URL'),
  httpTimeoutMs: int('HTTP_TIMEOUT_MS', 10_000),
  httpUserAgent: process.env.HTTP_USER_AGENT ?? 'PronetsysMonitor/0.1',
  // Cada 15s (6 campos: el primero son segundos). Permite intervalos finos por servicio.
  monitorCron: process.env.MONITOR_CRON ?? '*/15 * * * * *',
  tz: process.env.TZ ?? 'America/Bogota',

  glpi: {
    url: process.env.GLPI_URL ?? '',
    appToken: process.env.GLPI_APP_TOKEN ?? '',
    userToken: process.env.GLPI_USER_TOKEN ?? '',
    entityId: int('GLPI_ENTITY_ID', 0),
    categoryId: maybeInt('GLPI_TICKET_CATEGORY_ID'),
    defaultUrgency: int('GLPI_DEFAULT_URGENCY', 4),
    defaultImpact: int('GLPI_DEFAULT_IMPACT', 4),
    timeoutMs: int('GLPI_TIMEOUT_MS', 15_000),
    resolveMode: parseResolveMode(process.env.GLPI_AUTO_RESOLVE_AS),
    // Cron de sincronizacion del estado de tickets GLPI -> portal (cada 2 min).
    syncCron: process.env.GLPI_SYNC_CRON ?? '0 */2 * * * *',
  },

  api: {
    enabled: (process.env.API_ENABLED ?? 'true').toLowerCase() !== 'false',
    port: int('API_PORT', 3000),
    host: process.env.API_HOST ?? '127.0.0.1',
    // Origen permitido para CORS. En produccion detras de Nginx mismo dominio
    // no hace falta; util en desarrollo (Vite en :5173).
    corsOrigin: process.env.API_CORS_ORIGIN ?? 'http://localhost:5173',
  },

  auth: {
    // Secreto para firmar los JWT. OBLIGATORIO si la API esta habilitada.
    jwtSecret: process.env.AUTH_JWT_SECRET ?? '',
    // Duracion del token de sesion.
    tokenTtl: process.env.AUTH_TOKEN_TTL ?? '8h',
    // Cookie Secure: true en produccion (HTTPS). Poner false para dev en http local.
    cookieSecure: (process.env.AUTH_COOKIE_SECURE ?? 'true').toLowerCase() !== 'false',
    cookieName: process.env.AUTH_COOKIE_NAME ?? 'monitor_token',
  },

  whatsapp: {
    enabled: (process.env.WHATSAPP_ENABLED ?? 'false').toLowerCase() === 'true',
    // URL base del gateway OpenWA, incluyendo el prefijo /api.
    // Ej: http://IP_DEL_SERVIDOR:2785/api
    apiUrl: (process.env.WHATSAPP_API_URL ?? '').replace(/\/+$/, ''),
    // Se envia en el header X-API-Key.
    apiKey: process.env.WHATSAPP_API_KEY ?? '',
    // ID (o nombre) de la sesion de WhatsApp ya conectada en OpenWA.
    sessionId: process.env.WHATSAPP_SESSION_ID ?? '',
    // Sufijo de chat: @c.us para contactos, @g.us para grupos.
    chatSuffix: process.env.WHATSAPP_CHAT_SUFFIX ?? '@c.us',
    // Destinatarios separados por coma (ej "573001112233,573004445566").
    recipients: (process.env.WHATSAPP_RECIPIENTS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
    timeoutMs: int('WHATSAPP_TIMEOUT_MS', 15_000),
  },
};
