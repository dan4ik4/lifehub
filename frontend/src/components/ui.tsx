import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, Check, CheckCircle2, CircleAlert, Leaf, LoaderCircle, X } from 'lucide-react';

export function Logo({ compact = false }: { compact?: boolean }) {
  return <span className="brand"><span className="brand-mark"><Leaf size={22} strokeWidth={1.8} /></span>{!compact && <span>life<span className="brand-light">hub</span><span className="brand-dot">.</span></span>}</span>;
}

export function Modal({ title, description, onClose, children, className = '' }: { title: string; description?: string; onClose: () => void; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const active = document.activeElement as HTMLElement | null;
    const dialog = ref.current; dialog?.showModal();
    dialog?.querySelector<HTMLInputElement>('input:not([disabled]):not([type="hidden"]), textarea:not([disabled])')?.focus();
    const previous = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { dialog?.close(); document.body.style.overflow = previous; active?.focus(); };
  }, []);
  return createPortal(<dialog className={`modal ${className}`} ref={ref} onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) { const r = event.currentTarget.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) onClose(); } }} aria-label={title}>
    <div className="modal-shell"><header className="modal-heading"><div><h2>{title}</h2>{description && <p>{description}</p>}</div><button className="icon-button" onClick={onClose} aria-label="Закрыть окно"><X size={20} /></button></header>{children}</div>
  </dialog>, document.body);
}

export function ConfirmDialog({ title, description, onClose, onConfirm, confirmLabel = 'Удалить' }: { title: string; description: string; onClose: () => void; onConfirm: () => Promise<void>; confirmLabel?: string }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  return <Modal title={title} onClose={() => !busy && onClose()} className="confirm-modal"><div className="modal-body"><div className="confirm-symbol"><CircleAlert size={24} /></div><p>{description}</p>{error && <p className="field-error" role="alert">{error}</p>}</div><footer className="modal-footer"><button className="button secondary" disabled={busy} onClick={onClose}>Отмена</button><button className="button danger" disabled={busy} onClick={async () => { setBusy(true); try { await onConfirm(); onClose(); } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось выполнить действие'); } finally { setBusy(false); } }}>{busy ? <LoaderCircle className="spinner" size={16} /> : null}{confirmLabel}</button></footer></Modal>;
}

export function CheckButton({ checked, busy = false, onClick, label }: { checked: boolean; busy?: boolean; onClick: () => void; label: string }) {
  return <button type="button" role="checkbox" aria-checked={checked} aria-label={label} disabled={busy} className={`check-button ${checked ? 'is-checked' : ''}`} onClick={onClick}>{busy ? <LoaderCircle size={13} className="spinner" /> : checked ? <Check size={14} strokeWidth={3} /> : null}</button>;
}

export function EmptyState({ title, text, action, onAction, icon }: { title: string; text: string; action?: string; onAction?: () => void; icon?: ReactNode }) {
  return <div className="empty-state"><div className="empty-symbol">{icon || <CheckCircle2 size={28} strokeWidth={1.5} />}</div><h3>{title}</h3><p>{text}</p>{action && <button className="button secondary" onClick={onAction}>{action}<ArrowRight size={15} /></button>}</div>;
}
