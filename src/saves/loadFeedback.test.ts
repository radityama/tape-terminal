import { expect, test } from 'vitest';
import { loadFailureMessage } from './loadFeedback';
import { SaveCorruptError, SaveVersionError } from './localStore';

test('load errors name the failure without showing untrusted save contents', () => {
  expect(loadFailureMessage({ ok: false, reason: 'missing' })).toMatch(/no longer available/i);
  expect(loadFailureMessage({ ok: false, reason: 'newer', error: new SaveVersionError(99, 1) })).toMatch(/newer version/i);
  const corrupt = new SaveCorruptError('<script>unsafe</script>');
  expect(loadFailureMessage({ ok: false, reason: 'corrupt', error: corrupt })).not.toContain('unsafe');
  expect(loadFailureMessage({ ok: false, reason: 'conflict' })).toContain('conflicting saves');
});
