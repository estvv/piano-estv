import { useEffect, type ReactNode } from 'react';
import { dangerButton, primaryButton, secondaryButton } from './ui';

interface ModalProps {
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: 'sm' | 'md' | 'lg';
  // Title in the middle, no close button: closed from outside or with Escape.
  centered?: boolean;
}

const WIDTHS = { sm: 'max-w-md', md: 'max-w-lg', lg: 'max-w-2xl' };

export function Modal({ title, subtitle, onClose, children, footer, width = 'sm', centered = false }: ModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 backdrop-blur-[2px] sm:p-4 animate-[fade-in_120ms_ease-out]"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className={`w-full ${WIDTHS[width]} max-h-[90dvh] flex flex-col bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl border border-neutral-200 animate-[pop-in_160ms_ease-out]`}
      >
        <div className={`flex ${subtitle ? 'items-start' : 'items-center'} ${centered ? 'justify-center' : 'justify-between'} gap-4 px-5 pt-5 pb-4 sm:px-6`}>
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-neutral-900 truncate">{title}</h2>
            {subtitle && <div className="text-sm text-neutral-500 mt-0.5">{subtitle}</div>}
          </div>
          {!centered && (
            <button
              onClick={onClose}
              className="-mr-2 shrink-0 p-1.5 rounded-lg text-neutral-400 hover:text-neutral-900 hover:bg-neutral-100 transition-colors"
              title="Fermer"
              type="button"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
        <div className="px-5 pb-6 overflow-y-auto overscroll-contain min-h-0 sm:px-6">{children}</div>
        {footer && <div className="px-5 py-4 sm:px-6 border-t border-neutral-100 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

// Replaces window.confirm: same look as the other dialogs.
export function ConfirmModal({ title, message, confirmLabel, danger, onConfirm, onClose }: {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
}) {
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className={secondaryButton}>Annuler</button>
          <button type="button" autoFocus onClick={async () => { await onConfirm(); onClose(); }} className={danger ? dangerButton : primaryButton}>
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="text-sm text-neutral-600">{message}</div>
    </Modal>
  );
}
