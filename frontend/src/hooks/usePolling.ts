import { useCallback, useEffect, useRef, useState } from 'react';

interface PollingState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  refetch: () => void;
  // Actualiza el dato local sin ir al servidor (p.ej. con eventos en vivo).
  mutate: (fn: (prev: T | null) => T | null) => void;
}

/**
 * Ejecuta `fetcher` al montar y luego cada `intervalMs`. Mantiene el dato
 * anterior visible mientras refresca (no parpadea a "loading" en cada poll).
 * Con la pestana oculta no consulta; al volver a verla refresca de inmediato.
 */
export function usePolling<T>(fetcher: () => Promise<T>, intervalMs = 30_000): PollingState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const run = useCallback(async () => {
    try {
      const result = await fetcherRef.current();
      setData(result);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void run();
    const id = setInterval(() => {
      if (!document.hidden) void run();
    }, intervalMs);
    const alVolver = (): void => {
      if (!document.hidden) void run();
    };
    document.addEventListener('visibilitychange', alVolver);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', alVolver);
    };
  }, [run, intervalMs]);

  return { data, error, loading, refetch: run, mutate: setData };
}
