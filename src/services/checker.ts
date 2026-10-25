import axios, { AxiosError } from 'axios';
import http from 'http';
import https from 'https';
import net from 'net';
import type { Readable } from 'stream';
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

// Agentes SIN keep-alive. Desde Node 19 el agente global reutiliza sockets:
// entre chequeos (15s+) el servidor suele cerrar la conexion ociosa y el
// siguiente GET cae en un socket muerto -> ECONNRESET / "socket hang up"
// esporadicos que no son caidas reales. Ademas cada chequeo debe medir un
// handshake completo (DNS + TCP + TLS), no una conexion ya abierta.
const httpAgent = new http.Agent({ keepAlive: false });
const httpsAgent = new https.Agent({ keepAlive: false });

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
 *
 * Solo se esperan los headers: el cuerpo no se descarga ni se descomprime.
 * Asi la latencia es tiempo-a-primera-respuesta, no depende del tamano de la
 * pagina, y el decoder Brotli/gzip de Node nunca procesa bytes de terceros
 * (ver CVE-2026-111497).
 */
export async function checkUrl(url: string): Promise<CheckResult> {
  const inicio = Date.now();
  try {
    const resp = await axios.get<Readable>(url, {
      timeout: env.httpTimeoutMs,
      // `timeout` de axios es inactividad del socket; la senal es el tope
      // total (DNS lento, servidores que gotean bytes, cadenas de redirects).
      signal: AbortSignal.timeout(env.httpTimeoutMs),
      validateStatus: () => true, // queremos manejar todos los status nosotros
      maxRedirects: 5,
      responseType: 'stream',
      decompress: false,
      httpAgent,
      httpsAgent,
      headers: { 'User-Agent': env.httpUserAgent, 'Accept-Encoding': 'identity' },
    });

    const latenciaMs = Date.now() - inicio;
    resp.data.destroy();
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
      clearTimeout(tope);
      socket.destroy();
      resolve({ ok, statusCode: null, latenciaMs: Date.now() - inicio, errorMsg });
    };

    // setTimeout del socket es por inactividad y no cubre la resolucion DNS;
    // este tope asegura que el chequeo nunca dure mas que HTTP_TIMEOUT_MS.
    const tope = setTimeout(
      () => finalizar(false, `TIMEOUT tras ${env.httpTimeoutMs}ms`),
      env.httpTimeoutMs,
    );
    socket.setTimeout(env.httpTimeoutMs);
    socket.once('connect', () => finalizar(true, null));
    socket.once('timeout', () => finalizar(false, `TIMEOUT tras ${env.httpTimeoutMs}ms`));
    socket.once('error', (err: NodeJS.ErrnoException) => finalizar(false, clasificarCodigo(err.code) ?? (err.message || 'Error TCP desconocido')));

    try {
      socket.connect(puerto, host);
    } catch (err) {
      finalizar(false, err instanceof Error ? err.message : 'Error TCP desconocido');
    }
  });
}

/** Traduce codigos de error de red/TLS de Node a un texto legible. */
function clasificarCodigo(code: string | undefined): string | null {
  switch (code) {
    case undefined:
      return null;
    case 'ECONNABORTED':
    case 'ETIMEDOUT':
    case 'ERR_CANCELED':
      return `TIMEOUT tras ${env.httpTimeoutMs}ms`;
    case 'ENOTFOUND':
      return 'DNS no resuelto (ENOTFOUND)';
    case 'EAI_AGAIN':
      return 'Fallo DNS temporal (EAI_AGAIN)';
    case 'ECONNREFUSED':
      return 'Conexion rechazada (puerto cerrado, ECONNREFUSED)';
    case 'ECONNRESET':
      return 'Conexion reseteada (ECONNRESET)';
    case 'EHOSTUNREACH':
      return 'Host inalcanzable (EHOSTUNREACH)';
    case 'ENETUNREACH':
      return 'Red inalcanzable (ENETUNREACH)';
    case 'EPROTO':
      return 'Error de protocolo TLS (EPROTO)';
    case 'ERR_FR_TOO_MANY_REDIRECTS':
      return 'Demasiadas redirecciones';
    case 'CERT_HAS_EXPIRED':
      return 'Certificado TLS vencido (CERT_HAS_EXPIRED)';
    case 'DEPTH_ZERO_SELF_SIGNED_CERT':
    case 'SELF_SIGNED_CERT_IN_CHAIN':
      return `Certificado TLS autofirmado (${code})`;
    case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
    case 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY':
      return `Cadena de certificado TLS incompleta (${code})`;
    case 'ERR_TLS_CERT_ALTNAME_INVALID':
      return 'Certificado TLS no corresponde al dominio (ERR_TLS_CERT_ALTNAME_INVALID)';
    default:
      return `Error de red: ${code}`;
  }
}

function clasificarError(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const ax = err as AxiosError;
    const causa = (ax.cause as NodeJS.ErrnoException | undefined)?.code;
    return clasificarCodigo(ax.code ?? causa) ?? (ax.message || 'Error desconocido de Axios');
  }
  if (err instanceof Error) return err.message;
  return 'Error desconocido';
}
