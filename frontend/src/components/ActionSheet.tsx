import type { ReactNode } from 'react';
import { Modal } from './Modal';

export interface Action {
  label: string;
  icon: ReactNode;
  onClick(): void;
  disabled?: boolean;
  danger?: boolean;
}

// What a mouse gets by hovering a row, as a list for fingers: opens from the
// bottom on a phone. Picking an action closes it.
export function ActionSheet({ title, actions, onClose }: { title: string; actions: Action[]; onClose(): void }) {
  return (
    <Modal title={title} onClose={onClose}>
      <div className="-mx-2">
        {actions.map((a) => (
          <button
            key={a.label}
            type="button"
            disabled={a.disabled}
            onClick={() => {
              onClose();
              a.onClick();
            }}
            className={`flex w-full items-center gap-3 rounded-lg px-2 py-3 text-left text-sm font-medium disabled:opacity-30 ${
              a.danger ? 'text-red-600 active:bg-red-50' : 'text-neutral-700 active:bg-neutral-100'
            }`}
          >
            <span className="flex h-5 w-5 shrink-0 items-center justify-center">{a.icon}</span>
            {a.label}
          </button>
        ))}
      </div>
    </Modal>
  );
}
