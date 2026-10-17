'use client';

import React, { useEffect, useState } from 'react';
import {
  X,
  GoogleLogo,
  GithubLogo,
  EnvelopeSimple,
  SpinnerGap,
  WarningCircle,
  Trash,
  CloudArrowUp,
} from '@phosphor-icons/react';
import { useAuthStore } from '../../store/useAuthStore';
import { saveManager } from '../../saves/manager';
import { SaveMeta } from '../../saves/schema';

function Modal({ children, width = 'max-w-md' }: { children: React.ReactNode; width?: string }) {
  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 font-sans select-none">
      <div className={`bg-[var(--bg-1)] border border-[var(--line-strong)] rounded-[2px] ${width} w-full max-h-[85vh] flex flex-col shadow-2xl overflow-hidden`}>
        {children}
      </div>
    </div>
  );
}

function Header({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--line)]">
      <span className="text-[12px] uppercase tracking-wide text-[var(--text-1)]">{title}</span>
      <button
        onClick={onClose}
        aria-label="Close"
        className="p-1 rounded-[2px] text-[var(--text-3)] hover:text-[var(--text-1)] hover:bg-[var(--bg-2)] cursor-pointer"
      >
        <X size={14} />
      </button>
    </div>
  );
}

const primaryBtn =
  'w-full h-[30px] rounded-[2px] bg-[var(--accent)] text-black text-[12px] font-medium flex items-center justify-center space-x-1.5 cursor-pointer hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed';
const secondaryBtn =
  'w-full h-[30px] rounded-[2px] bg-[var(--bg-2)] border border-[var(--line)] text-[12px] text-[var(--text-1)] flex items-center justify-center space-x-1.5 cursor-pointer hover:bg-[var(--line)]';

function SignInDialog() {
  const closeDialog = useAuthStore((s) => s.closeDialog);
  const signInWithMagicLink = useAuthStore((s) => s.signInWithMagicLink);
  const signInWithOAuth = useAuthStore((s) => s.signInWithOAuth);
  const resendMagicLink = useAuthStore((s) => s.resendMagicLink);
  const emailSentTo = useAuthStore((s) => s.emailSentTo);
  const resendAvailableAt = useAuthStore((s) => s.resendAvailableAt);
  const loading = useAuthStore((s) => s.loading);
  const error = useAuthStore((s) => s.error);
  const clearError = useAuthStore((s) => s.clearError);

  const [email, setEmail] = useState('');
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const cooldown = Math.max(0, Math.ceil((resendAvailableAt - now) / 1000));

  if (emailSentTo) {
    return (
      <Modal>
        <Header title="Sign In" onClose={closeDialog} />
        <div className="p-4 space-y-3">
          <div className="flex items-start space-x-2 text-[12px] text-[var(--text-1)]">
            <EnvelopeSimple size={16} className="mt-0.5 text-[var(--accent)] shrink-0" />
            <span>
              Check your email. We sent a sign in link to <span className="font-mono">{emailSentTo}</span>.
            </span>
          </div>
          <button
            className={secondaryBtn}
            disabled={cooldown > 0 || loading}
            onClick={() => void resendMagicLink()}
          >
            {loading ? <SpinnerGap size={14} className="animate-spin" /> : null}
            {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend link'}
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal>
      <Header title="Sign In" onClose={closeDialog} />
      <div className="p-4 space-y-3">
        <p className="text-[11px] text-[var(--text-2)]">
          Signing in backs up your saves and syncs them across devices. You can keep playing as a guest.
        </p>

        <div className="space-y-1">
          <label htmlFor="signin-email" className="block text-[10px] uppercase tracking-wide text-[var(--text-3)]">
            Email
          </label>
          <input
            id="signin-email"
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (error) clearError();
            }}
            placeholder="you@example.com"
            className="w-full h-[30px] bg-[var(--bg-0)] border border-[var(--line)] rounded-[2px] px-2 text-[12px] text-[var(--text-1)] outline-none focus:border-[var(--accent)] font-mono"
          />
          {error ? <p className="text-[11px] text-[var(--down)]">{error}</p> : null}
        </div>

        <button className={primaryBtn} disabled={loading} onClick={() => void signInWithMagicLink(email)}>
          {loading ? <SpinnerGap size={14} className="animate-spin" /> : null}
          Send sign in link
        </button>

        <div className="flex items-center space-x-2 text-[10px] text-[var(--text-3)]">
          <span className="h-px flex-1 bg-[var(--line)]" />
          <span>or</span>
          <span className="h-px flex-1 bg-[var(--line)]" />
        </div>

        <button className={secondaryBtn} disabled={loading} onClick={() => void signInWithOAuth('github')}>
          <GithubLogo size={15} />
          Continue with GitHub
        </button>
        <button className={secondaryBtn} disabled={loading} onClick={() => void signInWithOAuth('google')}>
          <GoogleLogo size={15} />
          Continue with Google
        </button>
      </div>
    </Modal>
  );
}

function AccountDialog() {
  const closeDialog = useAuthStore((s) => s.closeDialog);
  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);
  const deleteCloudSaves = useAuthStore((s) => s.deleteCloudSaves);
  const loading = useAuthStore((s) => s.loading);

  const [removeOnSignOut, setRemoveOnSignOut] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [cloudCount, setCloudCount] = useState(0);

  useEffect(() => {
    const store = saveManager as unknown as { cloud?: unknown };
    void store;
    void saveManager.listAllSlots().then((slots) => setCloudCount(slots.filter((s) => s.cloudUpdatedAt !== undefined).length));
  }, []);

  return (
    <Modal>
      <Header title="Account" onClose={closeDialog} />
      <div className="p-4 space-y-3 text-[12px]">
        <div className="space-y-1">
          <div className="text-[10px] uppercase tracking-wide text-[var(--text-3)]">Email</div>
          <div className="font-mono text-[var(--text-1)]">{user?.email ?? 'Unknown'}</div>
        </div>

        <div className="space-y-1">
          <div className="text-[10px] uppercase tracking-wide text-[var(--text-3)]">Connected providers</div>
          <div className="text-[var(--text-1)]">
            {user?.providers.length ? user.providers.join(', ') : 'Email link'}
          </div>
        </div>

        <label className="flex items-start space-x-2 text-[11px] text-[var(--text-2)] cursor-pointer">
          <input
            type="checkbox"
            checked={removeOnSignOut}
            onChange={(e) => setRemoveOnSignOut(e.target.checked)}
            className="mt-0.5 accent-[var(--accent)]"
          />
          <span>Also remove cloud synced saves from this device after signing out</span>
        </label>

        <button className={secondaryBtn} disabled={loading} onClick={() => void signOut({ removeCloudSaves: removeOnSignOut })}>
          Sign out
        </button>

        <div className="pt-2 border-t border-[var(--line)] space-y-2">
          {confirmDelete ? (
            <div className="space-y-2">
              <div className="flex items-start space-x-2 text-[11px] text-[var(--down)]">
                <WarningCircle size={15} className="mt-0.5 shrink-0" />
                <span>
                  This deletes {cloudCount} cloud {cloudCount === 1 ? 'save' : 'saves'} from your account. Saves on
                  this device stay. This cannot be undone.
                </span>
              </div>
              <button
                className={`${primaryBtn} bg-[var(--down)] text-black`}
                disabled={loading}
                onClick={() => void deleteCloudSaves().then(() => setConfirmDelete(false))}
              >
                <Trash size={14} />
                Delete cloud saves
              </button>
              <button className={secondaryBtn} onClick={() => setConfirmDelete(false)}>
                Cancel
              </button>
            </div>
          ) : (
            <button
              className="w-full h-[30px] rounded-[2px] border border-[var(--down)] text-[var(--down)] text-[12px] flex items-center justify-center space-x-1.5 cursor-pointer hover:bg-[var(--down)]/10"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash size={14} />
              Delete my cloud saves
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}

function ClaimSavesDialog() {
  const closeDialog = useAuthStore((s) => s.closeDialog);
  const [local, setLocal] = useState<SaveMeta[]>([]);
  const [cloudSlots, setCloudSlots] = useState<Set<number>>(new Set());
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [occupied, setOccupied] = useState<number | null>(null);

  useEffect(() => {
    void saveManager.listSlots().then((slots) => {
      setLocal(slots);
      setChecked(new Set(slots.map((s) => s.slot)));
    });
    void saveManager.listAllSlots().then((slots) => {
      setCloudSlots(new Set(slots.filter((s) => s.cloudUpdatedAt !== undefined).map((s) => s.slot)));
    });
  }, []);

  const upload = async () => {
    setBusy(true);
    try {
      for (const slot of checked) {
        if (cloudSlots.has(slot)) {
          setOccupied(slot);
          setBusy(false);
          return;
        }
      }
      for (const slot of checked) await saveManager.uploadSlot(slot);
      closeDialog();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal>
      <Header title="Upload Local Saves" onClose={closeDialog} />
      <div className="p-4 space-y-3 text-[12px]">
        <p className="text-[11px] text-[var(--text-2)]">
          These saves live on this device only. Choose which ones to upload to your account.
        </p>

        {local.length === 0 ? (
          <p className="text-[11px] text-[var(--text-3)]">No local saves on this device.</p>
        ) : (
          <ul className="space-y-1">
            {local.map((save) => (
              <li key={save.slot} className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={checked.has(save.slot)}
                  onChange={(e) => {
                    const next = new Set(checked);
                    if (e.target.checked) next.add(save.slot);
                    else next.delete(save.slot);
                    setChecked(next);
                  }}
                  className="accent-[var(--accent)]"
                />
                <span className="text-[var(--text-1)]">
                  Slot {save.slot}: {save.name}
                </span>
                <span className="text-[var(--text-3)] font-mono text-[11px]">
                  Day {save.simDay} | ${Math.round(save.equity).toLocaleString()}
                </span>
                {cloudSlots.has(save.slot) ? (
                  <span className="text-[10px] text-[var(--down)]">Cloud slot in use</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {occupied !== null ? (
          <p className="text-[11px] text-[var(--down)]">
            Slot {occupied} already has a cloud save. Open it from the title screen to choose which to keep.
          </p>
        ) : null}

        <button className={primaryBtn} disabled={busy || checked.size === 0} onClick={() => void upload()}>
          {busy ? <SpinnerGap size={14} className="animate-spin" /> : <CloudArrowUp size={14} />}
          Upload to my account
        </button>
      </div>
    </Modal>
  );
}

function describe(meta: SaveMeta | null) {
  if (!meta) return 'No save';
  return `${meta.name} | Rank ${meta.rank ?? 'Intern'} | $${Math.round(meta.equity).toLocaleString()} | Day ${meta.simDay} | Seq ${meta.seq ?? 0} | ${new Date(meta.updatedAt).toLocaleString()} | ${meta.deviceId}`;
}

function ConflictDialog() {
  const closeDialog = useAuthStore((s) => s.closeDialog);
  const conflict = useAuthStore((s) => s.conflict);
  const [local, setLocal] = useState<SaveMeta | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const slot = conflict?.slot ?? 1;

  useEffect(() => {
    if (!conflict) return;
    void saveManager.listSlots().then((slots) => setLocal(slots.find((s) => s.slot === conflict.slot) ?? null));
  }, [conflict]);

  const run = async (action: 'keep' | 'use' | 'both') => {
    if (!conflict) return;
    setBusy(true);
    try {
      if (action === 'keep') {
        await saveManager.keepLocal(conflict.slot, conflict.remoteRevision);
        closeDialog();
      } else if (action === 'use') {
        await saveManager.useCloud(conflict.slot);
        closeDialog();
      } else {
        const result = await saveManager.keepBoth(conflict.slot);
        if (result.status === 'full') setMessage('No free slot to keep both. Free a slot and try again.');
        else closeDialog();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal width="max-w-lg">
      <Header title={`Save Conflict in Slot ${slot}`} onClose={closeDialog} />
      <div className="p-4 space-y-3 text-[12px]">
        <p className="text-[11px] text-[var(--text-2)]">
          This slot was changed on another device. Choose which copy to keep. Nothing is overwritten until you choose.
        </p>

        <div className="grid grid-cols-1 gap-2">
          <div className="bg-[var(--bg-0)] border border-[var(--line)] rounded-[2px] p-2">
            <div className="text-[10px] uppercase tracking-wide text-[var(--accent)]">This device</div>
            <div className="text-[11px] text-[var(--text-1)]">{describe(local)}</div>
          </div>
          <div className="bg-[var(--bg-0)] border border-[var(--line)] rounded-[2px] p-2">
            <div className="text-[10px] uppercase tracking-wide text-[var(--accent)]">Cloud</div>
            <div className="text-[11px] text-[var(--text-1)]">{describe(conflict?.remote ?? null)}</div>
          </div>
        </div>

        {message ? <p className="text-[11px] text-[var(--down)]">{message}</p> : null}

        <div className="grid grid-cols-3 gap-2">
          <button className={secondaryBtn} disabled={busy} onClick={() => void run('keep')}>
            Keep this device
          </button>
          <button className={secondaryBtn} disabled={busy} onClick={() => void run('use')}>
            Use cloud
          </button>
          <button className={secondaryBtn} disabled={busy} onClick={() => void run('both')}>
            Keep both
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function AuthDialogs() {
  const dialog = useAuthStore((s) => s.dialog);
  if (dialog === 'signin') return <SignInDialog />;
  if (dialog === 'account') return <AccountDialog />;
  if (dialog === 'claim') return <ClaimSavesDialog />;
  if (dialog === 'conflict') return <ConflictDialog />;
  return null;
}
