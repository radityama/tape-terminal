'use client';

import React, { useSyncExternalStore } from 'react';
import { CloudCheck, CloudSlash, HardDrives, SpinnerGap, WarningCircle, User, X } from '@phosphor-icons/react';
import { useTerminalStore } from '../../store/useTerminalStore';
import { useAuthStore } from '../../store/useAuthStore';
import type { SaveStatus } from '../../saves/manager';

const STATUS_TEXT: Record<SaveStatus, string> = {
  saved_locally: 'Saved locally',
  syncing: 'Syncing',
  synced: 'Synced',
  offline: 'Offline',
  sync_failed: 'Sync failed, retrying',
};

function StatusIcon({ status }: { status: SaveStatus }) {
  if (status === 'syncing') return <SpinnerGap size={13} className="animate-spin" />;
  if (status === 'synced') return <CloudCheck size={13} />;
  if (status === 'offline') return <CloudSlash size={13} />;
  if (status === 'sync_failed') return <WarningCircle size={13} />;
  return <HardDrives size={13} />;
}

export function SyncIndicator() {
  const saveStatus = useTerminalStore((s) => s.saveStatus);
  const signedIn = useAuthStore((s) => s.signedIn);
  const status: SaveStatus = signedIn ? saveStatus : 'saved_locally';

  return (
    <span className="hidden lg:flex items-center space-x-1 text-[10px] font-mono text-[var(--text-3)]">
      <StatusIcon status={status} />
      <span>{STATUS_TEXT[status]}</span>
    </span>
  );
}

export function UserMenuButton() {
  const configured = useAuthStore((s) => s.configured);
  const signedIn = useAuthStore((s) => s.signedIn);
  const openDialog = useAuthStore((s) => s.openDialog);

  if (!configured) return null;

  return (
    <button
      onClick={() => openDialog(signedIn ? 'account' : 'signin')}
      title={signedIn ? 'Account' : 'Sign in'}
      className="p-1.5 rounded-[2px] bg-[var(--bg-2)] hover:bg-[var(--line)] text-[var(--text-2)] hover:text-[var(--text-1)] border border-[var(--line)] cursor-pointer"
    >
      <User size={14} />
    </button>
  );
}

const NUDGE_KEY = 'tape_guest_nudge_dismissed';
const NUDGE_EVENT = 'tape-nudge';

function subscribeNudge(onChange: () => void) {
  window.addEventListener('storage', onChange);
  window.addEventListener(NUDGE_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener(NUDGE_EVENT, onChange);
  };
}

export function GuestNudge() {
  const configured = useAuthStore((s) => s.configured);
  const signedIn = useAuthStore((s) => s.signedIn);
  const openDialog = useAuthStore((s) => s.openDialog);
  const tutorialCompleted = useTerminalStore((s) => s.tutorialCompleted);
  const career = useTerminalStore((s) => s.snapshot?.career);
  const dismissed = useSyncExternalStore(
    subscribeNudge,
    () => window.localStorage.getItem(NUDGE_KEY) === '1',
    () => true
  );

  const rankOrder = (career as { rank?: { order?: number } } | undefined)?.rank?.order ?? 0;
  const visible = configured && !signedIn && !dismissed && tutorialCompleted && rankOrder >= 1;

  if (!visible) return null;

  const dismiss = () => {
    window.localStorage.setItem(NUDGE_KEY, '1');
    window.dispatchEvent(new Event(NUDGE_EVENT));
  };

  return (
    <div className="fixed bottom-3 left-1/2 -translate-x-1/2 z-40 flex items-center space-x-2 bg-[var(--bg-1)] border border-[var(--line-strong)] rounded-[2px] px-3 py-2 shadow-2xl text-[11px] text-[var(--text-1)]">
      <span>Saves live in this browser only. Sign in to back them up.</span>
      <button
        onClick={() => {
          dismiss();
          openDialog('signin');
        }}
        className="text-[var(--accent)] hover:underline cursor-pointer"
      >
        Sign in
      </button>
      <button onClick={dismiss} aria-label="Dismiss" className="text-[var(--text-3)] hover:text-[var(--text-1)] cursor-pointer">
        <X size={12} />
      </button>
    </div>
  );
}
