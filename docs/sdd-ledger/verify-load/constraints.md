## Global Constraints

- **Tests:** run `node --test "move_portal/test/*.test.js"` from the repo root `G:\My Drive\Move-portal`. The quoted glob is required on Windows. The suite is 142/142 at the start and must end green with pristine output.
- **Branch:** `feat/v3-verification`. Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Don't push until the controller says so.
- **Truck statuses:** `loading · needs_fix · ready · departing · departed · receiving · approving · received` (two are new: `needs_fix` and `ready`).
- **Scanning and take-off** are allowed only in `loading`, `needs_fix` and `ready` (and never while a claim is held). Any pallet change on a `ready` truck sets it back to `loading`.
- **Departure:**
  - Only from `ready`.
  - Re-verify first. On a mismatch, set `needs_fix` and return the diffs; don't depart.
  - No manager gate.
  - The plan contains only `if_stamp` ops.
- **Correct the IF** is manager only. It goes through `move_tx.apply` and `verify.runOps` under the write mode:
  - `if_qty` is written in `qty` and `on`.
  - `if_create` is written only in `on`, and creates the IF **Packed**, not Shipped.
  - Dropping an IF is portal-only.
  - The approver is `c.user`.
- **A new IF is attached only by an explicit Add** (`truck_add_if`). Never attach one silently.
- **Removed:** `data.pending`, `savePending`, `depart_cancel`, `depart_skip_write`, the departures section of `approvals`, and the floor "send to manager" path.
- **Lesson:** `data.updateLoad(L, patch)` merges `patch.data` over the copy passed in. Always re-read with `data.getLoad(id)` right before an update, and re-check status and claim.
- **Never kill node processes by image name.** Jack's preview runs on :8765. Use `--port` and `--store` with a temp file for smoke tests.

