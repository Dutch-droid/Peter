'use client';
import { createContext, useCallback, useContext, useState, useTransition } from 'react';
import type { Result } from '@/app/actions';

type Toast = { id: number; kind: 'ok' | 'error'; text: string };
const Ctx = createContext<(kind: Toast['kind'], text: string) => void>(() => {});

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((kind: Toast['kind'], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);

/** Runs a server action, shows its outcome as a toast, and calls onOk on success. */
export function useRun() {
  const toast = useToast();
  const [pending, start] = useTransition();
  function run<T>(fn: () => Promise<Result<T>>, onOk?: (r: Extract<Result<T>, { ok: true }>) => void) {
    start(async () => {
      try {
        const r = await fn();
        if (r.ok) {
          toast('ok', r.message ?? 'Saved');
          onOk?.(r);
        } else toast('error', r.error);
      } catch {
        toast('error', 'Something went wrong. Please try again.');
      }
    });
  }
  return { run, pending };
}
