import { useState, type FormEvent } from 'react';
import { api, type ServicioInput } from '../api/client';
import type { MonitorType, ServicioResumen } from '../types';

interface Props {
  initial: ServicioResumen | null; // null => crear; objeto => editar
  onClose: () => void;
  onSaved: () => void;
}

type Unidad = 'seg' | 'min' | 'h';
const FACTOR: Record<Unidad, number> = { seg: 1, min: 60, h: 3600 };
const MIN_SEG = 15;
const MAX_SEG = 86400; // 24h

// Descompone segundos en {valor, unidad} usando la unidad mas grande que divide exacto.
function descomponer(segundos: number): { valor: number; unidad: Unidad } {
  if (segundos >= 3600 && segundos % 3600 === 0) return { valor: segundos / 3600, unidad: 'h' };
  if (segundos >= 60 && segundos % 60 === 0) return { valor: segundos / 60, unidad: 'min' };
  return { valor: segundos, unidad: 'seg' };
}

export function ServiceFormModal({ initial, onClose, onSaved }: Props) {
  const esEdicion = initial !== null;
  const inicial = descomponer(initial?.intervaloMonitoreo ?? 60);
  const [nombre, setNombre] = useState(initial?.nombre ?? '');
  const [tipo, setTipo] = useState<MonitorType>(initial?.tipo ?? 'HTTP');
  const [url, setUrl] = useState(initial?.url ?? '');
  const [host, setHost] = useState(initial?.host ?? '');
  const [puerto, setPuerto] = useState<number | ''>(initial?.puerto ?? '');
  const [intValor, setIntValor] = useState<number | ''>(inicial.valor);
  const [intUnidad, setIntUnidad] = useState<Unidad>(inicial.unidad);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const segundos = Number(intValor) * FACTOR[intUnidad];

  const onSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    if (!Number.isInteger(segundos) || segundos < MIN_SEG || segundos > MAX_SEG) {
      setError('El intervalo debe estar entre 15 segundos y 24 horas.');
      return;
    }
    setGuardando(true);
    try {
      const data: ServicioInput = {
        nombre: nombre.trim(),
        tipo,
        intervaloMonitoreo: segundos,
        ...(tipo === 'HTTP'
          ? { url: url.trim() }
          : { host: host.trim(), puerto: Number(puerto) }),
      };
      if (esEdicion && initial) {
        await api.updateService(initial.id, data);
      } else {
        await api.createService(data);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar.');
    } finally {
      setGuardando(false);
    }
  };

  const inputCls =
    'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-4 text-lg text-slate-800">
          {esEdicion ? 'Editar servicio' : 'Agregar servicio'}
        </h2>

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-normal text-slate-600">Nombre</label>
            <input
              type="text"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              className={inputCls}
              required
              minLength={2}
              maxLength={150}
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-normal text-slate-600">Tipo de monitoreo</label>
            <div className="flex gap-2">
              <TipoBtn activo={tipo === 'HTTP'} onClick={() => setTipo('HTTP')} label="Web (HTTP/HTTPS)" />
              <TipoBtn activo={tipo === 'TCP'} onClick={() => setTipo('TCP')} label="Puerto (TCP)" />
            </div>
          </div>

          {tipo === 'HTTP' ? (
            <div>
              <label className="mb-1 block text-sm font-normal text-slate-600">URL</label>
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://..."
                className={inputCls}
                required
              />
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-2">
                <label className="mb-1 block text-sm font-normal text-slate-600">Host / IP</label>
                <input
                  type="text"
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  placeholder="db.interno.local o 10.0.0.5"
                  className={inputCls}
                  required
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-normal text-slate-600">Puerto</label>
                <input
                  type="number"
                  value={puerto}
                  onChange={(e) => setPuerto(e.target.value === '' ? '' : Number(e.target.value))}
                  min={1}
                  max={65535}
                  placeholder="5432"
                  className={inputCls}
                  required
                />
              </div>
            </div>
          )}

          <div>
            <label className="mb-1 block text-sm font-normal text-slate-600">
              Intervalo de monitoreo
            </label>
            <div className="flex gap-2">
              <input
                type="number"
                value={intValor}
                onChange={(e) => setIntValor(e.target.value === '' ? '' : Number(e.target.value))}
                min={1}
                className="w-28 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                required
              />
              <select
                value={intUnidad}
                onChange={(e) => setIntUnidad(e.target.value as Unidad)}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
              >
                <option value="seg">Segundos</option>
                <option value="min">Minutos</option>
                <option value="h">Horas</option>
              </select>
            </div>
            <p className="mt-1 text-xs font-normal text-slate-400">
              Entre 15 segundos y 24 horas. {Number.isFinite(segundos) ? `(= ${segundos}s)` : ''}
            </p>
          </div>

          {error && (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-normal text-slate-600 hover:bg-slate-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={guardando}
              className="rounded-lg bg-brand px-4 py-2 text-sm text-white hover:bg-brand-dark disabled:opacity-60"
            >
              {guardando ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function TipoBtn({ activo, onClick, label }: { activo: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded-lg border px-3 py-2 text-sm transition ${
        activo
          ? 'border-brand bg-brand text-white'
          : 'border-slate-300 bg-white font-normal text-slate-600 hover:bg-slate-50'
      }`}
    >
      {label}
    </button>
  );
}
