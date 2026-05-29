import axios, { AxiosError } from 'axios';
import net from 'net';
import { env } from '../config/env';

export type CheckResult = {
  ok: boolean;          // true => servicio respondiendo en rango aceptable (2xx/3xx)
  statusCode: number | null;
  latenciaMs: number;
  errorMsg: string | null;
};

// Forma minima de un servicio para decidir como chequearlo.
export type ObjetivoChequeo = {
  tipo: 'HTTP' | 'TCP';
  url: string | null;
  host: string | null;
  puerto: number | null;
};

/**
 * Dispatcher: ejecuta el chequeo apropiado segun el tipo de servicio.
 * NUNCA lanza; siempre devuelve un CheckResult.
 */
export async function realizarChequeo(objetivo: ObjetivoChequeo): Promise<CheckResult> {
  if (objetivo.tipo === 'TCP') {
    if (!objetivo.host || !objetivo.puerto) {
      return { ok: false, statusCode: null, latenciaMs: 0, errorMsg: 'TCP sin host/puerto' };
    }
    return checkTcp(objetivo.host, objetivo.puerto);
  }
  if (!objetivo.url) {
    return { ok: false, statusCode: null, latenciaMs: 0, errorMsg: 'HTTP sin url' };
  }
  return checkUrl(objetivo.url);
}

/**
 * Ejecuta un GET HTTP contra la URL del servicio y devuelve el resultado
 * normalizado. NUNCA lanza excepciones: cualquier fallo de red, DNS, timeout
 * o TLS se devuelve como ok=false con un errorMsg descriptivo, para que el
 * cron del monitor no se caiga si una URL falla catastroficamente.
 */
export async function checkUrl(url: string): Promise<CheckResult> {
  const inicio = Date.now();
  try {
    const resp = await axios.get(url, {
      timeout: env.httpTimeoutMs,
      validateStatus: () => true, // queremos manejar todos los status nosotros
      maxRedirects: 5,
      headers: { 'User-Agent': env.httpUserAgent },
    });

    const latenciaMs = Date.now() - inicio;
    const ok = resp.status >= 200 && resp.status < 400;
    return {
      ok,
      statusCode: resp.status,
      latenciaMs,
      errorMsg: ok ? null : `HTTP ${resp.status} ${resp.statusText ?? ''}`.trim(),
    };
  } catch (err) {
    const latenciaMs = Date.now() - inicio;
    return {
      ok: false,
      statusCode: null,
      latenciaMs,
      errorMsg: clasificarError(err),
    };
  }
}

/**
 * Chequeo TCP: intenta abrir una conexion al host:puerto. ok=true si el
 * puerto acepta la conexion. Mide la latencia del handshake. NUNCA lanza.
 */
export function checkTcp(host: string, puerto: number): Promise<CheckResult> {
  return new Promise<CheckResult>((resolve) => {
    const inicio = Date.now();
    const socket = new net.Socket();
    let resuelto = false;

    const finalizar = (ok: boolean, errorMsg: string | null): void => {
      if (resuelto) return;
      resuelto = true;
      socket.destroy();
      resolve({ ok, statusCode: null, latenciaMs: Date.now() - inicio, errorMsg });
    };

    socket.setTimeout(env.httpTimeoutMs);
    socket.once('connect', () => finalizar(true, null));
    socket.once('timeout', () => finalizar(false, `TIMEOUT tras ${env.httpTimeoutMs}ms`));
    socket.once('error', (err: NodeJS.ErrnoException) => finalizar(false, clasificarTcp(err)));

    try {
      socket.connect(puerto, host);
    } catch (err) {
      finalizar(false, err instanceof Error ? err.message : 'Error TCP desconocido');
    }
  });
}

function clasificarTcp(err: NodeJS.ErrnoException): string {
  switch (err.code) {
    case 'ECONNREFUSED':
      return 'Conexion rechazada (puerto cerrado, ECONNREFUSED)';
    case 'ENOTFOUND':
      return 'Host no resuelto (ENOTFOUND)';
    case 'ETIMEDOUT':
      return 'TIMEOUT de conexion (ETIMEDOUT)';
    case 'EHOSTUNREACH':
      return 'Host inalcanzable (EHOSTUNREACH)';
    case 'ECONNRESET':
      return 'Conexion reseteada (ECONNRESET)';
    default:
      return err.code ? `Error TCP: ${err.code}` : err.message || 'Error TCP desconocido';
  }
}

function clasificarError(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const ax = err as AxiosError;
    if (ax.code === 'ECONNABORTED') return `TIMEOUT tras ${env.httpTimeoutMs}ms`;
    if (ax.code === 'ENOTFOUND')    return 'DNS no resuelto (ENOTFOUND)';
    if (ax.code === 'ECONNREFUSED') return 'Conexion rechazada (ECONNREFUSED)';
    if (ax.code === 'ECONNRESET')   return 'Conexion reseteada (ECONNRESET)';
    if (ax.code === 'EAI_AGAIN')    return 'Fallo DNS temporal (EAI_AGAIN)';
    if (ax.code)                    return `Error de red: ${ax.code}`;
    return ax.message || 'Error desconocido de Axios';
  }
  if (err instanceof Error) return err.message;
  return 'Error desconocido';
}
