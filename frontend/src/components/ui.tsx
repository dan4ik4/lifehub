import { t } from '../lib/language';
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
    const dialog = ref.current;
    if (!dialog) return;
    const active = document.activeElement as HTMLElement | null;
    const viewport = window.visualViewport;
    const syncViewport = () => {
      const keyboardOpen = viewport && viewport.scale === 1 && window.innerHeight - viewport.height > 80;
      dialog.toggleAttribute('data-keyboard-open', Boolean(keyboardOpen));
      if (keyboardOpen) {
        dialog.style.setProperty('--dialog-visible-height', viewport.height + 'px');
        dialog.style.setProperty('--dialog-visible-top', viewport.offsetTop + 'px');
      }
    };
    dialog.showModal();
    if (!window.matchMedia('(pointer: coarse), (max-width: 760px)').matches && !dialog.classList.contains('assistant-modal')) {
      dialog.querySelector<HTMLElement>('input:not([disabled]):not([type="hidden"]):not([type="file"]), textarea:not([disabled])')?.focus({preventScroll:true});
    }
    syncViewport();
    viewport?.addEventListener('resize', syncViewport);
    viewport?.addEventListener('scroll', syncViewport);
    return () => {
      viewport?.removeEventListener('resize', syncViewport);
      viewport?.removeEventListener('scroll', syncViewport);
      dialog.close();
      active?.focus({preventScroll:true});
    };
  }, []);
  return createPortal(<dialog className={`modal ${className}`} ref={ref} onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) { const r = event.currentTarget.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) onClose(); } }} aria-label={title}>
    <div className="modal-shell"><header className="modal-heading"><div><h2>{title}</h2>{description && <p>{description}</p>}</div><button className="icon-button" onClick={onClose} aria-label={t("Закрыть окно")}><X size={20} /></button></header>{children}</div>
  </dialog>, document.body);
}

export function ConfirmDialog({ title, description, onClose, onConfirm, confirmLabel = t("Удалить") }: { title: string; description: string; onClose: () => void; onConfirm: () => Promise<void>; confirmLabel?: string }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  return <Modal title={title} onClose={() => !busy && onClose()} className="confirm-modal"><div className="modal-body"><div className="confirm-symbol"><CircleAlert size={24} /></div><p>{description}</p>{error && <p className="field-error" role="alert">{error}</p>}</div><footer className="modal-footer"><button className="button secondary" disabled={busy} onClick={onClose}>{t("Отмена")}</button><button className="button danger" disabled={busy} onClick={async () => { setBusy(true); try { await onConfirm(); onClose(); } catch (e) { setError(e instanceof Error ? e.message : t("Не удалось выполнить действие")); } finally { setBusy(false); } }}>{busy ? <LoaderCircle className="spinner" size={16} /> : null}{confirmLabel}</button></footer></Modal>;
}

export function CheckButton({ checked, busy = false, onClick, label }: { checked: boolean; busy?: boolean; onClick: () => void; label: string }) {
  return <button type="button" role="checkbox" aria-checked={checked} aria-label={label} disabled={busy} className={`check-button ${checked ? 'is-checked' : ''}`} onClick={onClick}>{busy ? <LoaderCircle size={13} className="spinner" /> : checked ? <Check size={14} strokeWidth={3} /> : null}</button>;
}

export function EmptyState({ title, text, action, onAction, icon }: { title: string; text: string; action?: string; onAction?: () => void; icon?: ReactNode }) {
  return <div className="empty-state"><div className="empty-symbol">{icon || <CheckCircle2 size={28} strokeWidth={1.5} />}</div><h3>{title}</h3><p>{text}</p>{action && <button className="button secondary" onClick={onAction}>{action}<ArrowRight size={15} /></button>}</div>;
}
