import { useCallback, useEffect, useState } from 'react';
import { api } from './api';

export function useData<T>(path: string | null, refreshMs?: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    if (!path) return;
    api<T>(path).then((d) => { setData(d); setError(null); }, (e) => setError(e.message));
  }, [path]);
  useEffect(() => {
    load();
    if (!refreshMs) return;
    const id = setInterval(load, refreshMs);
    return () => clearInterval(id);
  }, [load, refreshMs]);
  return { data, error, reload: load };
}
