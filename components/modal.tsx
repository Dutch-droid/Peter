'use client';
import { useEffect, useRef, useState } from 'react';
import { useRun } from './toast';
import type { Result } from '@/app/actions';

export function Modal({ open, onClose, title, children }: {
  open: boolean; onClose: () => void; title: string; children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="modal" onClose={onClose}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      {open && (
        <div className="modal-body">
          <div className="modal-head"><h2>{title}</h2>
            <button type="button" className="sec" onClick={onClose} aria-label="Close">✕</button></div>
          {children}
        </div>
      )}
    </dialog>
  );
}

/** A button that asks for confirmation in a dialog before running a server action. */
export function ConfirmButton({ label, title, message, action, onDone, danger, className }: {
  label: string; title: string; message: string; action: () => Promise<Result<unknown>>;
  onDone?: () => void; danger?: boolean; className?: string;
}) {
  const [open, setOpen] = useState(false);
  const { run, pending } = useRun();
  return (
    <>
      <button type="button" className={className ?? (danger ? 'bad' : '')} onClick={() => setOpen(true)}>{label}</button>
      <Modal open={open} onClose={() => setOpen(false)} title={title}>
        <p>{message}</p>
        <div className="actions">
          <button type="button" className="sec" onClick={() => setOpen(false)}>Cancel</button>
          <button type="button" className={danger ? 'bad' : ''} disabled={pending}
            onClick={() => run(action, () => { setOpen(false); onDone?.(); })}>
            {pending ? 'Working…' : label}</button>
        </div>
      </Modal>
    </>
  );
}
