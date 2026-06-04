import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { api } from '../api/client';
import type { BotInfo, NotificacionConfig, ResultadoEnvioWhatsApp, ServicioResumen, TipoEnvioWhatsapp, WhatsappEnvio, WhatsappRecipient } from '../types';
import { formatearFecha } from '../utils/format';

export function NotificationsManager() {
  const [config, setConfig] = useState<NotificacionConfig | null>(null);
  const [dest, setDest] = useState<WhatsappRecipient[] | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [guardado, setGuardado] = useState(false);

  const recargar = useCallback(async () => {
    try {
      setError(null);
      const [c, d] = await Promise.all([api.whatsappConfig(), api.whatsappRecipients()]);
      setConfig(c);
      setDest(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void recargar();
  }, [recargar]);

  if (cargando) return <p className="text-slate-400">Cargando configuracion…</p>;
  if (error && !config) {
    return <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200">{error}</div>;
  }
  if (!config) return null;

  const guardar = async (parche: Partial<NotificacionConfig>): Promise<void> => {
    setGuardando(true);
    setGuardado(false);
    setError(null);
    try {
      const actualizada = await api.updateWhatsappConfig(parche);
      setConfig(actualizada);
      setGuardado(true);
      setTimeout(() => setGuardado(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="space-y-6">
      <h2 className="text-xl text-slate-800">Notificaciones por WhatsApp</h2>

      {error && (
        <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200">{error}</div>
      )}
      {guardado && (
        <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 ring-1 ring-emerald-200">
          Guardado.
        </div>
      )}

      <ConexionForm config={config} onGuardar={guardar} guardando={guardando} />
      <EventosForm config={config} onGuardar={guardar} guardando={guardando} />
      <Activacion />
      <Destinatarios dest={dest} onChanged={recargar} />
      <Prueba />
      <Historial />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-bloques
// ---------------------------------------------------------------------------

const inputCls =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20';

function ConexionForm({
  config,
  onGuardar,
  guardando,
}: {
  config: NotificacionConfig;
  onGuardar: (p: Partial<NotificacionConfig>) => Promise<void>;
  guardando: boolean;
}) {
  const [habilitado, setHabilitado] = useState(config.whatsappEnabled);
  const [apiUrl, setApiUrl] = useState(config.whatsappApiUrl ?? '');
  const [apiKey, setApiKey] = useState(config.whatsappApiKey ?? '');
  const [sessionId, setSessionId] = useState(config.whatsappSessionId ?? '');
  const [chatSuffix, setChatSuffix] = useState(config.whatsappChatSuffix);
  const [timeout, setTimeoutMs] = useState<number | ''>(config.whatsappTimeoutMs);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    await onGuardar({
      whatsappEnabled: habilitado,
      whatsappApiUrl: apiUrl.trim() || null,
      whatsappApiKey: apiKey.trim() || null,
      whatsappSessionId: sessionId.trim() || null,
      whatsappChatSuffix: chatSuffix,
      whatsappTimeoutMs: Number(timeout) || 15000,
    });
  };

  return (
    <form onSubmit={submit} className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
      <h3 className="mb-4 text-base text-slate-800">Conexion al gateway OpenWA</h3>

      <div className="mb-4 flex items-center gap-3">
        <label className="inline-flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={habilitado} onChange={(e) => setHabilitado(e.target.checked)} className="h-4 w-4" />
          Notificaciones por WhatsApp habilitadas
        </label>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="mb-1 block text-sm font-normal text-slate-600">API URL (incluye /api)</label>
          <input className={inputCls} value={apiUrl} onChange={(e) => setApiUrl(e.target.value)} placeholder="http://10.0.0.35:2785/api" />
        </div>
        <div className="sm:col-span-2">
          <label className="mb-1 block text-sm font-normal text-slate-600">API Key (X-API-Key)</label>
          <input className={inputCls} value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="owa_k1_..." />
        </div>
        <div>
          <label className="mb-1 block text-sm font-normal text-slate-600">Session ID</label>
          <input className={inputCls} value={sessionId} onChange={(e) => setSessionId(e.target.value)} placeholder="id de la sesion conectada" />
        </div>
        <div>
          <label className="mb-1 block text-sm font-normal text-slate-600">Sufijo de chat</label>
          <input className={inputCls} value={chatSuffix} onChange={(e) => setChatSuffix(e.target.value)} placeholder="@c.us" />
        </div>
        <div>
          <label className="mb-1 block text-sm font-normal text-slate-600">Timeout (ms)</label>
          <input
            type="number"
            min={1000}
            max={120000}
            className={inputCls}
            value={timeout}
            onChange={(e) => setTimeoutMs(e.target.value === '' ? '' : Number(e.target.value))}
          />
        </div>
      </div>

      <div className="mt-4 flex justify-end">
        <button type="submit" disabled={guardando} className="rounded-lg bg-brand px-4 py-2 text-sm text-white hover:bg-brand-dark disabled:opacity-60">
          {guardando ? 'Guardando…' : 'Guardar conexion'}
        </button>
      </div>
    </form>
  );
}

function EventosForm({
  config,
  onGuardar,
  guardando,
}: {
  config: NotificacionConfig;
  onGuardar: (p: Partial<NotificacionConfig>) => Promise<void>;
  guardando: boolean;
}) {
  const [caida, setCaida] = useState(config.notificarCaida);
  const [recup, setRecup] = useState(config.notificarRecuperacion);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    await onGuardar({ notificarCaida: caida, notificarRecuperacion: recup });
  };

  return (
    <form onSubmit={submit} className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
      <h3 className="mb-4 text-base text-slate-800">Eventos a notificar</h3>
      <div className="space-y-2 text-sm text-slate-700">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={caida} onChange={(e) => setCaida(e.target.checked)} className="h-4 w-4" />
          Notificar cuando un servicio se cae (UP → DOWN)
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={recup} onChange={(e) => setRecup(e.target.checked)} className="h-4 w-4" />
          Notificar cuando un servicio se recupera (DOWN → UP)
        </label>
      </div>
      <div className="mt-4 flex justify-end">
        <button type="submit" disabled={guardando} className="rounded-lg bg-brand px-4 py-2 text-sm text-white hover:bg-brand-dark disabled:opacity-60">
          {guardando ? 'Guardando…' : 'Guardar eventos'}
        </button>
      </div>
    </form>
  );
}

function Destinatarios({ dest, onChanged }: { dest: WhatsappRecipient[] | null; onChanged: () => Promise<void> }) {
  const [numero, setNumero] = useState('');
  const [etiqueta, setEtiqueta] = useState('');
  const [seleccion, setSeleccion] = useState<Set<number>>(new Set());
  const [agregando, setAgregando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [accionId, setAccionId] = useState<number | null>(null);
  const [botPhone, setBotPhone] = useState<string | null>(null);
  const [servicios, setServicios] = useState<ServicioResumen[]>([]);
  const [editandoSubs, setEditandoSubs] = useState<WhatsappRecipient | null>(null);

  useEffect(() => {
    api.whatsappBotInfo().then((i) => setBotPhone(i.phone)).catch(() => setBotPhone(null));
    api.services().then(setServicios).catch(() => setServicios([]));
  }, []);

  const toggleServicio = (id: number): void => {
    setSeleccion((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const agregar = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    setAgregando(true);

    // Abrimos la pestaña AHORA (mientras dura el gesto del usuario) para que
    // ningun popup-blocker la bloquee; luego la redirigimos cuando tengamos
    // el link de WhatsApp pre-formateado.
    const popup = botPhone ? window.open('about:blank', '_blank') : null;
    const etqLimpia = etiqueta.trim();
    const serviceIds = Array.from(seleccion);

    try {
      const creado = await api.addWhatsappRecipient({
        numero: numero.trim(),
        etiqueta: etqLimpia || undefined,
        serviceIds: serviceIds.length > 0 ? serviceIds : undefined,
      });
      setNumero('');
      setEtiqueta('');
      setSeleccion(new Set());
      await onChanged();

      if (popup && botPhone) {
        const textoActivacion = 'Hola, quiero activar las alertas del monitor de Pronetsys.';
        const linkActivacion = `https://wa.me/${botPhone}?text=${encodeURIComponent(textoActivacion)}`;
        const mensaje =
          `Hola${etqLimpia ? ' ' + etqLimpia : ''}, para activar tus alertas del ` +
          `Monitor Pronetsys toca este enlace y envia el mensaje al bot:\n\n${linkActivacion}`;
        popup.location.href = `https://wa.me/${creado.numero}?text=${encodeURIComponent(mensaje)}`;
      } else if (popup) {
        popup.close();
      }
    } catch (err) {
      if (popup) popup.close();
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAgregando(false);
    }
  };

  const toggle = async (d: WhatsappRecipient): Promise<void> => {
    setAccionId(d.id);
    try {
      await api.updateWhatsappRecipient(d.id, { activo: !d.activo });
      await onChanged();
    } finally {
      setAccionId(null);
    }
  };

  const eliminar = async (d: WhatsappRecipient): Promise<void> => {
    if (!confirm(`¿Eliminar destinatario ${d.numero}?`)) return;
    setAccionId(d.id);
    try {
      await api.deleteWhatsappRecipient(d.id);
      await onChanged();
    } finally {
      setAccionId(null);
    }
  };

  return (
    <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
      <h3 className="mb-4 text-base text-slate-800">Destinatarios</h3>

      <form onSubmit={agregar} className="mb-4 space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex-1 min-w-[180px]">
            <label className="mb-1 block text-xs font-normal text-slate-500">Numero (codigo pais + numero)</label>
            <input className={inputCls} value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="573001112233" required />
          </div>
          <div className="flex-1 min-w-[180px]">
            <label className="mb-1 block text-xs font-normal text-slate-500">Etiqueta (opcional)</label>
            <input className={inputCls} value={etiqueta} onChange={(e) => setEtiqueta(e.target.value)} placeholder="Soporte / Cristian / ..." />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-xs font-normal text-slate-500">
            Servicios a notificar — si no marcas ninguno, recibira alertas de TODOS los servicios.
          </label>
          {servicios.length === 0 ? (
            <p className="text-xs font-normal text-slate-400">No hay servicios registrados aun.</p>
          ) : (
            <div className="grid max-h-40 grid-cols-1 gap-1 overflow-auto rounded-lg border border-slate-200 p-2 sm:grid-cols-2">
              {servicios.map((s) => (
                <label key={s.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-slate-50">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={seleccion.has(s.id)}
                    onChange={() => toggleServicio(s.id)}
                  />
                  <span className="truncate text-slate-700">{s.nombre}</span>
                </label>
              ))}
            </div>
          )}
          <p className="mt-1 text-xs font-normal text-slate-400">
            {seleccion.size === 0
              ? 'Sin seleccion: recibira alertas de TODOS los servicios.'
              : `Seleccionados: ${seleccion.size} servicio(s).`}
          </p>
        </div>

        <div className="flex justify-end">
          <button type="submit" disabled={agregando} className="rounded-lg bg-brand px-4 py-2 text-sm text-white hover:bg-brand-dark disabled:opacity-60">
            {agregando ? 'Agregando…' : '+ Agregar'}
          </button>
        </div>
      </form>

      {error && (
        <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200">{error}</div>
      )}

      <table className="w-full text-left text-sm">
        <thead className="text-xs font-normal uppercase tracking-wide text-slate-500">
          <tr>
            <th className="py-2">Numero</th>
            <th className="py-2">Etiqueta</th>
            <th className="py-2">Activacion</th>
            <th className="py-2">Servicios</th>
            <th className="py-2">Estado</th>
            <th className="py-2 text-right">Acciones</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {!dest || dest.length === 0 ? (
            <tr><td colSpan={6} className="py-3 text-slate-400">Sin destinatarios.</td></tr>
          ) : (
            dest.map((d) => (
              <tr key={d.id}>
                <td className="py-2 text-slate-800">{d.numero}</td>
                <td className="py-2 font-normal text-slate-600">{d.etiqueta ?? '—'}</td>
                <td className="py-2">
                  {d.bienvenidaEnviada ? (
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700">
                      ✓ Activado
                    </span>
                  ) : (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700" title="Esperando que el destinatario envie un mensaje al bot">
                      ⏳ Pendiente
                    </span>
                  )}
                </td>
                <td className="py-2">
                  {d.serviceIds.length === 0 ? (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600" title="Recibe alertas de todos los servicios">
                      Todos
                    </span>
                  ) : (
                    <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700" title={d.serviceIds.map((id) => servicios.find((s) => s.id === id)?.nombre ?? `#${id}`).join(', ')}>
                      {d.serviceIds.length} servicio{d.serviceIds.length === 1 ? '' : 's'}
                    </span>
                  )}
                </td>
                <td className="py-2">
                  {d.activo ? <span className="text-estado-up">Activo</span> : <span className="text-slate-400">Inactivo</span>}
                </td>
                <td className="py-2">
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => setEditandoSubs(d)}
                      disabled={accionId === d.id}
                      className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-normal text-slate-600 hover:bg-slate-50 disabled:opacity-60"
                    >
                      Suscripciones
                    </button>
                    <button
                      onClick={() => void toggle(d)}
                      disabled={accionId === d.id}
                      className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-normal text-slate-600 hover:bg-slate-50 disabled:opacity-60"
                    >
                      {d.activo ? 'Desactivar' : 'Activar'}
                    </button>
                    <button
                      onClick={() => void eliminar(d)}
                      disabled={accionId === d.id}
                      className="rounded-lg border border-red-300 px-2.5 py-1 text-xs font-normal text-red-600 hover:bg-red-50 disabled:opacity-60"
                    >
                      Eliminar
                    </button>
                  </div>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      {editandoSubs && (
        <SuscripcionesModal
          recipient={editandoSubs}
          servicios={servicios}
          onClose={() => setEditandoSubs(null)}
          onSaved={async () => {
            setEditandoSubs(null);
            await onChanged();
          }}
        />
      )}
    </div>
  );
}

function SuscripcionesModal({
  recipient,
  servicios,
  onClose,
  onSaved,
}: {
  recipient: WhatsappRecipient;
  servicios: ServicioResumen[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [seleccion, setSeleccion] = useState<Set<number>>(new Set(recipient.serviceIds));
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (id: number): void => {
    setSeleccion((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const guardar = async (): Promise<void> => {
    setError(null);
    setGuardando(true);
    try {
      await api.updateWhatsappRecipient(recipient.id, { serviceIds: Array.from(seleccion) });
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-1 text-lg text-slate-800">Suscripciones</h3>
        <p className="mb-3 text-sm font-normal text-slate-500">
          {recipient.etiqueta ?? recipient.numero}
          {recipient.etiqueta ? <span className="text-slate-400"> · {recipient.numero}</span> : null}
        </p>

        <p className="mb-3 text-xs font-normal text-slate-500">
          Si no marcas ninguno, recibira alertas de TODOS los servicios.
        </p>

        {servicios.length === 0 ? (
          <p className="text-sm font-normal text-slate-400">No hay servicios registrados.</p>
        ) : (
          <div className="mb-3 grid max-h-72 grid-cols-1 gap-1 overflow-auto rounded-lg border border-slate-200 p-2">
            {servicios.map((s) => (
              <label key={s.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-slate-50">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={seleccion.has(s.id)}
                  onChange={() => toggle(s.id)}
                />
                <span className="truncate text-slate-700">{s.nombre}</span>
              </label>
            ))}
          </div>
        )}

        <p className="mb-3 text-xs font-normal text-slate-400">
          {seleccion.size === 0
            ? 'Sin seleccion: recibira alertas de TODOS los servicios.'
            : `Seleccionados: ${seleccion.size} servicio(s).`}
        </p>

        {error && (
          <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200">{error}</div>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-normal text-slate-600 hover:bg-slate-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void guardar()}
            disabled={guardando}
            className="rounded-lg bg-brand px-4 py-2 text-sm text-white hover:bg-brand-dark disabled:opacity-60"
          >
            {guardando ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Activacion() {
  const [info, setInfo] = useState<BotInfo | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [textoActivacion, setTextoActivacion] = useState('Hola, quiero activar las alertas del monitor de Pronetsys.');
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    api
      .whatsappBotInfo()
      .then((d) => {
        setInfo(d);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setCargando(false));
  }, []);

  const refrescar = async (): Promise<void> => {
    setCargando(true);
    try {
      setInfo(await api.whatsappBotInfo());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCargando(false);
    }
  };

  if (cargando) {
    return (
      <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200 text-sm text-slate-400">
        Consultando estado del bot…
      </div>
    );
  }

  if (error || !info?.phone) {
    return (
      <div className="rounded-xl bg-amber-50 p-5 ring-1 ring-amber-200">
        <h3 className="mb-2 text-base text-amber-900">Activación de destinatarios</h3>
        <p className="text-sm text-amber-800">
          No pude leer el número del bot en OpenWA. Verifica que la configuración del gateway esté guardada y que la sesión esté <span className="font-medium">ready</span>.
        </p>
        <button onClick={() => void refrescar()} className="mt-3 rounded-lg border border-amber-300 px-3 py-1 text-xs font-normal text-amber-800 hover:bg-amber-100">
          Reintentar
        </button>
      </div>
    );
  }

  const numero = info.phone;
  const textoCodificado = encodeURIComponent(textoActivacion);
  const waLink = `https://wa.me/${numero}?text=${textoCodificado}`;
  const conectada = info.status === 'ready';

  const copiarLink = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(waLink);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1800);
    } catch {
      /* silencioso */
    }
  };

  return (
    <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-base text-slate-800">Activación de destinatarios</h3>
        <span className={`rounded-full px-2 py-0.5 text-xs ${conectada ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
          {conectada ? `Bot conectado: ${numero}` : `Sesión: ${info.status || 'desconocido'}`}
        </span>
      </div>

      <p className="mb-4 text-sm font-normal text-slate-600">
        WhatsApp exige que cada destinatario <span className="font-medium">inicie la conversación</span> con el bot al menos una vez para empezar a recibir alertas (limitación del protocolo, no del monitor). Comparte este enlace o el QR con cada persona; al abrirlo desde su celular se enviará un mensaje pre-llenado al bot y queda activado.
      </p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_auto]">
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-normal text-slate-500">Texto que enviará el destinatario al bot</label>
            <input
              className={inputCls}
              value={textoActivacion}
              onChange={(e) => setTextoActivacion(e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-normal text-slate-500">Enlace de activación (wa.me)</label>
            <div className="flex gap-2">
              <input className={`${inputCls} font-mono text-xs`} value={waLink} readOnly onFocus={(e) => e.currentTarget.select()} />
              <button onClick={() => void copiarLink()} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-normal text-slate-600 hover:bg-slate-50">
                {copiado ? '¡Copiado!' : 'Copiar'}
              </button>
              <a href={waLink} target="_blank" rel="noreferrer" className="rounded-lg bg-brand px-3 py-2 text-sm text-white hover:bg-brand-dark">
                Probar
              </a>
            </div>
          </div>
          <ol className="list-decimal space-y-1 pl-5 text-xs font-normal text-slate-500">
            <li>El destinatario abre el enlace (o escanea el QR) desde su celular.</li>
            <li>WhatsApp abre la conversación con el bot y muestra el mensaje pre-llenado.</li>
            <li>Pulsa "Enviar". Listo: ya recibirá alertas en cuanto lo agregues como destinatario abajo.</li>
          </ol>
        </div>

        <div className="flex flex-col items-center justify-center">
          <div className="rounded-xl bg-white p-3 ring-1 ring-slate-200">
            <QRCodeSVG value={waLink} size={172} includeMargin={false} />
          </div>
          <span className="mt-2 text-xs font-normal text-slate-500">Escanear desde el celular del destinatario</span>
        </div>
      </div>
    </div>
  );
}

function Prueba() {
  const [texto, setTexto] = useState('Prueba del Monitor Pronetsys: la integracion con WhatsApp funciona correctamente.');
  const [numero, setNumero] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoEnvioWhatsApp | null>(null);
  const [error, setError] = useState<string | null>(null);

  const enviar = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    setResultado(null);
    setEnviando(true);
    try {
      const r = await api.testWhatsapp(texto, numero.trim() || undefined);
      setResultado(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <form onSubmit={enviar} className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
      <h3 className="mb-4 text-base text-slate-800">Prueba de envio</h3>

      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-sm font-normal text-slate-600">Mensaje</label>
          <textarea
            className={`${inputCls} min-h-[80px]`}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-normal text-slate-600">
            Numero destino (opcional — si lo dejas vacio envia a TODOS los activos)
          </label>
          <input
            className={inputCls}
            value={numero}
            onChange={(e) => setNumero(e.target.value)}
            placeholder="573001112233"
          />
        </div>
      </div>

      <div className="mt-4 flex justify-end">
        <button type="submit" disabled={enviando} className="rounded-lg bg-brand px-4 py-2 text-sm text-white hover:bg-brand-dark disabled:opacity-60">
          {enviando ? 'Enviando…' : 'Enviar prueba'}
        </button>
      </div>

      {error && (
        <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200">{error}</div>
      )}

      {resultado && (
        <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm ring-1 ring-slate-200">
          <div className="mb-2 text-slate-700">
            Resultado: <span className="text-estado-up">{resultado.enviados} OK</span> /
            <span className="ml-1 text-estado-down">{resultado.fallidos} fallidos</span>
          </div>
          <ul className="space-y-1 text-xs">
            {resultado.detalles.map((d, i) => (
              <li key={i} className="flex items-center gap-2">
                <span className={d.ok ? 'text-estado-up' : 'text-estado-down'}>{d.ok ? '✓' : '✗'}</span>
                <span className="text-slate-700">{d.numero}</span>
                {!d.ok && d.error && <span className="text-slate-500">— {d.error}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </form>
  );
}

// ---------------------------------------------------------------------------
// Historial de envios (auditoria)
// ---------------------------------------------------------------------------

const ETIQUETA_TIPO: Record<TipoEnvioWhatsapp, { label: string; clase: string }> = {
  CAIDA:        { label: 'Caida',        clase: 'bg-red-100 text-red-700' },
  RECUPERACION: { label: 'Recuperacion', clase: 'bg-emerald-100 text-emerald-700' },
  PRUEBA:       { label: 'Prueba',       clase: 'bg-slate-100 text-slate-600' },
  BIENVENIDA:   { label: 'Bienvenida',   clase: 'bg-blue-100 text-blue-700' },
};

const PAGINA = 25;

function Historial() {
  const [filas, setFilas] = useState<WhatsappEnvio[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [tipo, setTipo] = useState<'' | TipoEnvioWhatsapp>('');
  const [exitoso, setExitoso] = useState<'' | 'true' | 'false'>('');
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [textoExpandido, setTextoExpandido] = useState<number | null>(null);

  const cargar = useCallback(async (off: number) => {
    setCargando(true);
    setError(null);
    try {
      const r = await api.whatsappLogs({
        limit: PAGINA,
        offset: off,
        tipo: tipo || undefined,
        exitoso: exitoso || undefined,
      });
      setFilas(r.filas);
      setTotal(r.total);
      setOffset(r.offset);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCargando(false);
    }
  }, [tipo, exitoso]);

  useEffect(() => {
    void cargar(0);
  }, [cargar]);

  const haySig = offset + PAGINA < total;
  const hayAnt = offset > 0;

  return (
    <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-base text-slate-800">Historial de envios</h3>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <select
            value={tipo}
            onChange={(e) => setTipo(e.target.value as '' | TipoEnvioWhatsapp)}
            className="rounded-lg border border-slate-300 px-2 py-1 text-sm"
          >
            <option value="">Todos los tipos</option>
            <option value="CAIDA">Caida</option>
            <option value="RECUPERACION">Recuperacion</option>
            <option value="PRUEBA">Prueba</option>
            <option value="BIENVENIDA">Bienvenida</option>
          </select>
          <select
            value={exitoso}
            onChange={(e) => setExitoso(e.target.value as '' | 'true' | 'false')}
            className="rounded-lg border border-slate-300 px-2 py-1 text-sm"
          >
            <option value="">Todos</option>
            <option value="true">Solo exitosos</option>
            <option value="false">Solo fallidos</option>
          </select>
          <button
            onClick={() => void cargar(0)}
            disabled={cargando}
            className="rounded-lg border border-slate-300 px-3 py-1 font-normal text-slate-600 hover:bg-slate-50 disabled:opacity-60"
          >
            {cargando ? '…' : 'Refrescar'}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200">{error}</div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs font-normal uppercase tracking-wide text-slate-500">
            <tr>
              <th className="py-2">Hora</th>
              <th className="py-2">Tipo</th>
              <th className="py-2">Destinatario</th>
              <th className="py-2">Resultado</th>
              <th className="py-2">Detalle</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filas.length === 0 ? (
              <tr><td colSpan={5} className="py-3 text-slate-400">Sin envios registrados.</td></tr>
            ) : (
              filas.map((f) => {
                const meta = ETIQUETA_TIPO[f.tipo];
                const expandido = textoExpandido === f.id;
                return (
                  <tr key={f.id}>
                    <td className="py-2 font-normal text-slate-600 whitespace-nowrap">{formatearFecha(f.timestamp)}</td>
                    <td className="py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs ${meta.clase}`}>{meta.label}</span>
                    </td>
                    <td className="py-2">
                      <div className="text-slate-800">{f.destinatarioEtiqueta ?? '—'}</div>
                      <div className="text-xs font-normal text-slate-400">{f.destinatarioNumero}</div>
                    </td>
                    <td className="py-2">
                      {f.exitoso ? (
                        <span className="text-estado-up">✓ OK</span>
                      ) : (
                        <span className="text-estado-down">✗ Fallo</span>
                      )}
                    </td>
                    <td className="py-2 max-w-[420px]">
                      {!f.exitoso && f.errorMsg && (
                        <div className="mb-1 truncate text-xs text-red-600" title={f.errorMsg}>{f.errorMsg}</div>
                      )}
                      <div
                        className={`text-xs font-normal text-slate-600 cursor-pointer ${expandido ? 'whitespace-pre-wrap' : 'truncate'}`}
                        onClick={() => setTextoExpandido(expandido ? null : f.id)}
                        title="Click para expandir/colapsar"
                      >
                        {f.texto}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex items-center justify-between text-xs font-normal text-slate-500">
        <span>
          Mostrando {filas.length === 0 ? 0 : offset + 1}–{offset + filas.length} de {total}
        </span>
        <div className="flex gap-2">
          <button
            onClick={() => void cargar(Math.max(0, offset - PAGINA))}
            disabled={!hayAnt || cargando}
            className="rounded-lg border border-slate-300 px-3 py-1 hover:bg-slate-50 disabled:opacity-50"
          >
            ← Anteriores
          </button>
          <button
            onClick={() => void cargar(offset + PAGINA)}
            disabled={!haySig || cargando}
            className="rounded-lg border border-slate-300 px-3 py-1 hover:bg-slate-50 disabled:opacity-50"
          >
            Siguientes →
          </button>
        </div>
      </div>
    </div>
  );
}
