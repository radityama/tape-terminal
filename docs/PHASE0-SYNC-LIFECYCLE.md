# Cloud sync after deletion

Cloud sync has three states for the currently signed-in account:

| State | Cloud writes | Exit |
| --- | --- | --- |
| Active | Allowed after normal conflict checks | A deletion request pauses writes. |
| Paused for deletion | Queued and retried writes remain local | A failed preflight resumes active sync; a partial deletion stays paused until retry or sign-out. |
| Disabled after deletion | No automatic cloud writes | The user explicitly chooses to enable sync again, acknowledging that local saves may be uploaded. Sign-out clears this account state. |

Successful deletion must never call `setCloudStore(null)` while the account is still signed in. The cloud adapter remains available for inspection and explicit actions, but writes stay disabled. A repeated same-user auth event leaves the decision intact. A different account gets a new adapter and an active state, while old in-flight operations may only affect the old account and cannot update the new account's sync state.

If deletion completes but sign-out fails, the signed-in account remains in the disabled state. Local saves remain untouched. If listing fails before any deletion, sync resumes and pending local progress is scheduled again. A pause timeout likewise resumes safely because no deletion has started. Partial deletion does not resume writes, avoiding resurrection of the rows that were deleted.
