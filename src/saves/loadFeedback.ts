import type { LoadOutcome } from './manager';

// Fixed player-facing copy. Never interpolate raw save details, they are untrusted input.
export function loadFailureMessage(outcome: Exclude<LoadOutcome, { ok: true }>): string {
  switch (outcome.reason) {
    case 'missing':
      return 'This save is no longer available.';
    case 'newer':
      return 'This save needs a newer version of TAPE.';
    case 'corrupt':
      return 'This save is damaged and could not be loaded.';
    case 'conflict':
      return 'This device and cloud have conflicting saves. Both copies are preserved.';
  }
}
