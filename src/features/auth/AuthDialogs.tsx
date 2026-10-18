'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  GoogleLogo,
  GithubLogo,
  EnvelopeSimple,
  SpinnerGap,
  Trash,
  CloudArrowUp,
} from '@phosphor-icons/react';
import { useAuthStore } from '../../store/useAuthStore';
import { saveManager } from '../../saves/manager';
import { SaveMeta } from '../../saves/schema';
import { ConfirmDialog, Dialog } from '../dialog/Dialog';

const primaryBtn =
  'w-full h-[30px] rounded-[2px] bg-[var(--accent)] text-[var(--bg-0)] text-[12px] font-medium flex items-center justify-center space-x-1.5 cursor-pointer hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed';
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
      <Dialog title="Sign In" onClose={closeDialog}>
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
      </Dialog>
    );
  }

  return (
    <Dialog title="Sign In" onClose={closeDialog}>
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
    </Dialog>
  );
}

function AccountDialog() {
  const closeDialog = useAuthStore((s) => s.closeDialog);
  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);
  const deleteCloudSaves = useAuthStore((s) => s.deleteCloudSaves);
  const loading = useAuthStore((s) => s.loading);
  const deletingCloud = useAuthStore((s) => s.deletingCloud);
  const authError = useAuthStore((s) => s.error);
  const enableCloudSync = useAuthStore((s) => s.enableCloudSync);

  const [removeOnSignOut, setRemoveOnSignOut] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmationOwner, setConfirmationOwner] = useState<string | null>(null);
  const [confirmEnable, setConfirmEnable] = useState(false);
  const [syncState, setSyncState] = useState(() => saveManager.getCloudSyncState());
  const [cloudCount, setCloudCount] = useState<number | null>(null);
  const [listError, setListError] = useState(false);
  const [deletionError, setDeletionError] = useState<string | null>(null);
  const operationRef = useRef(0);
  const busyRef = useRef(false);

  const refreshCount = useCallback(async () => {
    const accountId = useAuthStore.getState().user?.id;
    try {
      const slots = await saveManager.listAllSlots();
      if (useAuthStore.getState().user?.id !== accountId) return;
      setCloudCount(slots.filter((slot) => slot.cloudUpdatedAt !== undefined).length);
      setListError(false);
    } catch {
      setCloudCount(null);
      setListError(true);
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(() => { setSyncState(saveManager.getCloudSyncState()); void refreshCount(); });
    return () => { operationRef.current += 1; };
  }, [refreshCount, user?.id]);

  const deleteConfirmed = async () => {
    if (busyRef.current || deletingCloud || !user) return;
    busyRef.current = true;
    const request = ++operationRef.current;
    const accountId = user.id;
    setDeletionError(null);
    try {
      const result = await deleteCloudSaves();
      if (request !== operationRef.current || useAuthStore.getState().user?.id !== accountId) return;
      setConfirmDelete(false);
      setSyncState(saveManager.getCloudSyncState());
      setCloudCount((count) => count === null ? null : Math.max(0, count - result.deletedSlots.length));
      if (result.status === 'success') closeDialog();
      else setDeletionError(result.message);
      if (result.status !== 'success') void refreshCount();
    } catch {
      if (request === operationRef.current) setDeletionError('Could not verify cloud deletion. Retry after checking your account.');
    } finally {
      busyRef.current = false;
    }
  };

  if (confirmDelete && confirmationOwner === user?.id && cloudCount !== null) {
    return (
      <ConfirmDialog
        title="Delete cloud saves?"
        confirmLabel={deletingCloud ? 'Deleting cloud saves…' : `Delete ${cloudCount} cloud ${cloudCount === 1 ? 'save' : 'saves'}`}
        onCancel={() => { if (!busyRef.current && !deletingCloud) setConfirmDelete(false); }}
        onConfirm={() => void deleteConfirmed()}
        busy={loading || deletingCloud}
      >
        <p>
          This deletes {cloudCount} cloud {cloudCount === 1 ? 'save' : 'saves'} from your account. Saves on this
          device stay. This cannot be undone.
        </p>
        {deletingCloud ? <p role="status">Checking each cloud save. Keep this dialog open.</p> : null}
      </ConfirmDialog>
    );
  }

  if (confirmEnable) {
    return <ConfirmDialog title="Enable cloud sync?" confirmLabel="Enable cloud sync" onCancel={() => setConfirmEnable(false)} onConfirm={() => {
      enableCloudSync();
      setSyncState(saveManager.getCloudSyncState());
      setConfirmEnable(false);
    }}>
      <p>Local saves may be uploaded to your account again. Deleted cloud saves may be recreated after conflict checks.</p>
    </ConfirmDialog>;
  }

  return (
    <Dialog title="Account" onClose={() => { if (!busyRef.current && !deletingCloud) closeDialog(); }}>
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
            disabled={cloudCount === null}
            onChange={(e) => setRemoveOnSignOut(e.target.checked)}
            className="mt-0.5 accent-[var(--accent)]"
          />
          <span>Delete my cloud saves before signing out</span>
        </label>

        <button className={secondaryBtn} disabled={loading || deletingCloud} onClick={() => { setDeletionError(null); void signOut({ removeCloudSaves: removeOnSignOut }); }}>
          Sign out
        </button>
        {(deletionError || authError) && <p role="alert" className="text-[11px] text-[var(--down)]">{deletionError ?? authError}</p>}

        {syncState !== 'active' ? <div className="space-y-2 text-[11px] text-[var(--text-2)]">
          <p role="status">Cloud sync is {syncState === 'disabled_after_deletion' ? 'disabled after deletion' : 'paused while deletion is incomplete'}. Local saves remain on this device.</p>
          {syncState === 'disabled_after_deletion' ? <button className={secondaryBtn} onClick={() => setConfirmEnable(true)}>Enable cloud sync again</button> : null}
        </div> : null}

        <div className="pt-2 border-t border-[var(--line)] space-y-2">
          {listError ? (
            <p role="alert" className="text-[11px] text-[var(--down)]">
              Could not check cloud saves. Close and reopen Account to try again.
            </p>
          ) : null}
          <button
            className="w-full h-[30px] rounded-[2px] border border-[var(--line)] text-[var(--text-1)] text-[12px] flex items-center justify-center space-x-1.5 cursor-pointer hover:bg-[var(--bg-2)] disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={cloudCount === null || loading || deletingCloud}
            onClick={() => { setDeletionError(null); setConfirmationOwner(user?.id ?? null); setConfirmDelete(true); }}
          >
            <Trash size={14} />
            Delete my cloud saves
          </button>
        </div>
      </div>
    </Dialog>
  );
}

function ClaimSavesDialog() {
  const closeDialog = useAuthStore((s) => s.closeDialog);
  const [local, setLocal] = useState<SaveMeta[] | null>(null);
  const [cloudSlots, setCloudSlots] = useState<Set<number> | null>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [occupied, setOccupied] = useState<number | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  const loadSlots = useCallback(async () => {
    try {
      const [localSlots, mergedSlots] = await Promise.all([saveManager.listSlots(), saveManager.listAllSlots()]);
      setLocal(localSlots);
      setCloudSlots(new Set(mergedSlots.filter((s) => s.cloudUpdatedAt !== undefined).map((s) => s.slot)));
      setChecked(new Set(localSlots.map((s) => s.slot)));
      setListError(null);
    } catch {
      setLocal(null);
      setCloudSlots(null);
      setChecked(new Set());
      setListError('Could not check local and cloud saves. Try again.');
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(loadSlots);
  }, [loadSlots]);

  const upload = async () => {
    if (busy || local === null || cloudSlots === null || listError) return;
    setBusy(true);
    try {
      for (const slot of checked) {
        if (cloudSlots.has(slot)) {
          setOccupied(slot);
          return;
        }
      }
      for (const slot of checked) await saveManager.uploadSlot(slot);
      closeDialog();
    } catch {
      setListError('Could not upload saves. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title="Upload Local Saves" onClose={closeDialog}>
      <div className="p-4 space-y-3 text-[12px]">
        <p className="text-[11px] text-[var(--text-2)]">
          These saves live on this device only. Choose which ones to upload to your account.
        </p>

        {local === null ? (
          !listError ? <p className="text-[11px] text-[var(--text-3)]">Checking saves...</p> : null
        ) : local.length === 0 ? (
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
                {cloudSlots?.has(save.slot) ? (
                  <span className="text-[10px] text-[var(--down)]">Cloud slot in use</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {listError ? (
          <div className="space-y-2">
            <p role="alert" className="text-[11px] text-[var(--down)]">{listError}</p>
            <button
              className={secondaryBtn}
              onClick={() => {
                setLocal(null);
                setCloudSlots(null);
                setChecked(new Set());
                setOccupied(null);
                setListError(null);
                void loadSlots();
              }}
            >
              Retry
            </button>
          </div>
        ) : null}

        {occupied !== null ? (
          <p className="text-[11px] text-[var(--down)]">
            Slot {occupied} already has a cloud save. Open it from the title screen to choose which to keep.
          </p>
        ) : null}

        <button
          className={primaryBtn}
          disabled={busy || local === null || cloudSlots === null || !!listError || checked.size === 0}
          onClick={() => void upload()}
        >
          {busy ? <SpinnerGap size={14} className="animate-spin" /> : <CloudArrowUp size={14} />}
          Upload to my account
        </button>
      </div>
    </Dialog>
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
        const result = await saveManager.keepLocal(conflict.slot, conflict.remoteRevision);
        if (result.status === 'synced') closeDialog();
        else if (result.status === 'conflict') {
          useAuthStore.setState({ conflict: result.conflict });
          setMessage('The cloud copy changed again. Review its updated details before retrying.');
        } else setMessage('Could not keep this device copy. Try again.');
      } else if (action === 'use') {
        const result = await saveManager.useCloud(conflict.slot);
        if (result.status === 'synced') closeDialog();
        else setMessage('Could not safely load the cloud copy. Try again.');
      } else {
        const result = await saveManager.keepBoth(conflict.slot);
        if (result.status === 'full') setMessage('No free slot to keep both. Free a slot and try again.');
        else if (result.status === 'failed') setMessage('Could not safely keep both copies. Check your saves and retry.');
        else closeDialog();
      }
    } catch {
      setMessage('Could not verify the saves. Retry when storage is available.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title={`Save Conflict in Slot ${slot}`} onClose={closeDialog} width="max-w-lg">
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
    </Dialog>
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
