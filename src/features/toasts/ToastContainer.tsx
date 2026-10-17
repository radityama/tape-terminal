'use client';

import React from 'react';
import { useTerminalStore } from '../../store/useTerminalStore';
import { CheckCircle, Warning, Info, X } from '@phosphor-icons/react';

export function ToastContainer() {
  const toasts = useTerminalStore((s) => s.toasts);
  const removeToast = useTerminalStore((s) => s.removeToast);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col space-y-2 pointer-events-none max-w-sm w-full">
      {toasts.map((t) => {
        const isSuccess = t.type === 'success';
        const isError = t.type === 'error';

        return (
          <div
            key={t.id}
            className={`pointer-events-auto p-3 rounded-[2px] border shadow-2xl flex items-start space-x-2.5 transition-all duration-150 bg-[var(--bg-1)] font-sans ${
              isSuccess
                ? 'border-[var(--up)] text-[var(--up)]'
                : isError
                ? 'border-[var(--down)] text-[var(--down)]'
                : 'border-[var(--accent)] text-[var(--accent)]'
            }`}
          >
            <div className="shrink-0 mt-0.5">
              {isSuccess ? (
                <CheckCircle size={15} weight="bold" />
              ) : isError ? (
                <Warning size={15} weight="bold" />
              ) : (
                <Info size={15} weight="bold" />
              )}
            </div>

            <div className="flex-1 min-w-0">
              <div className="font-mono text-[11px] font-bold leading-tight">
                {t.title}
              </div>
              <div className="text-[11px] text-[var(--text-2)] mt-0.5 leading-snug font-sans">
                {t.message}
              </div>
            </div>

            <button
              onClick={() => removeToast(t.id)}
              className="text-[var(--text-3)] hover:text-[var(--text-1)] cursor-pointer p-0.5"
            >
              <X size={12} weight="bold" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
