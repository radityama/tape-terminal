'use client';

import React, { useEffect, useId, useRef } from 'react';
import { X } from '@phosphor-icons/react';

// The shared dialog surface. Every modal in the app renders through it so keyboard
// behavior, focus restoration and the visual shell stay in one place.
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface DialogProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  width?: string;
  descriptionId?: string;
  // Destructive confirmations use alertdialog so assistive tech announces the interruption.
  destructive?: boolean;
}

export function Dialog({ title, onClose, children, width = 'max-w-md', descriptionId, destructive = false }: DialogProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  // Keep the latest handler without re-running the focus effect on every render.
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;

    const focusables = () =>
      panel ? Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null) : [];

    // The safe action opts into the initial focus; otherwise the first control takes it.
    const preferred = panel?.querySelector<HTMLElement>('[data-autofocus]') ?? focusables()[0];
    (preferred ?? panel)?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab') return;

      const items = focusables();
      if (items.length === 0) {
        event.preventDefault();
        panel?.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      const outside = !panel?.contains(active);

      if (event.shiftKey && (active === first || outside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || outside)) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, []);

  return (
    <div
      className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 font-sans select-none"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeRef.current();
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role={destructive ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className={`bg-[var(--bg-1)] border border-[var(--line-strong)] rounded-[2px] ${width} w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden`}
      >
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--line)]">
          <h2 id={titleId} className="text-[12px] uppercase tracking-wide text-[var(--text-1)]">
            {title}
          </h2>
          <button
            type="button"
            onClick={() => closeRef.current()}
            aria-label="Close"
            className="p-1 rounded-[2px] text-[var(--text-3)] hover:text-[var(--text-1)] hover:bg-[var(--bg-2)] cursor-pointer"
          >
            <X size={14} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export interface ConfirmDialogProps {
  title: string;
  children: React.ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}

// A destructive confirmation. Cancel takes the initial focus, the header is announced,
// and Escape always cancels.
export function ConfirmDialog({ title, children, confirmLabel, onConfirm, onCancel, busy = false }: ConfirmDialogProps) {
  const descriptionId = useId();
  return (
    <Dialog title={title} onClose={onCancel} descriptionId={descriptionId} destructive>
      <div id={descriptionId} className="p-4 space-y-2 font-mono text-[11px] leading-relaxed text-[var(--text-2)]">{children}</div>
      <div className="px-4 pb-4 flex justify-end gap-2">
        <button
          type="button"
          data-autofocus
          onClick={onCancel}
          className="h-[30px] px-3 rounded-[2px] bg-[var(--bg-2)] border border-[var(--line)] text-[12px] text-[var(--text-1)] hover:bg-[var(--line)] cursor-pointer"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className="h-[30px] px-3 rounded-[2px] bg-[var(--accent)] text-black text-[12px] font-medium hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
        >
          {confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}
