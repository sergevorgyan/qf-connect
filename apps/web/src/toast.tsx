import { useEffect, useState } from 'react';

type Toast = { id: number; text: string; kind: 'ok' | 'error' };
let next = 1;
let listeners: ((t: Toast[]) => void)[] = [];
let toasts: Toast[] = [];
const emit = () => listeners.forEach((l) => l(toasts));

/** Show a short confirmation (or error) in the corner of the screen. */
export function toast(text: string, kind: Toast['kind'] = 'ok') {
  const t = { id: next++, text, kind };
  toasts = [...toasts, t];
  emit();
  setTimeout(() => { toasts = toasts.filter((x) => x.id !== t.id); emit(); }, kind === 'error' ? 6000 : 3000);
}

export function Toaster() {
  const [list, setList] = useState(toasts);
  useEffect(() => { listeners.push(setList); return () => { listeners = listeners.filter((l) => l !== setList); }; }, []);
  return (
    <div className="toasts" aria-live="polite">
      {list.map((t) => <div key={t.id} className={`toast ${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>{t.kind === 'ok' ? '✓ ' : ''}{t.text}</div>)}
    </div>
  );
}
