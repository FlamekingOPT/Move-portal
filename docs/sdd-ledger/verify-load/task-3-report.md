# Task 3 report: departure only from Ready; remove pending and skip-write

**Status:** DONE. Commit `4d51b3d` "feat(verify-load): departure only from Ready (re-verified, stamp-only); remove pending and skip-write" on `feat/v3-verification` (not pushed).

## TDD evidence
- **RED:** I appended 9 portal tests and 1 verify test, and switched the `departed()` helper to the new `readyTruck()`. Result: 28 failing.
  - The new tests failed because a truck that had been verified could not depart from `ready`, and because `no_ifs` didn't exist yet.
  - Every receipt, unload and report test failed through `departed()`.
- **GREEN:** after implementing and adapting the old tests, `node --test "move_portal/test/*.test.js"` gives **165/165 pass**, with clean output.
- Suite count: 165 before and 165 after. I added 10 tests and 1 replacement UI test, and dropped 11 old tests (listed below).

## Implementation
- **`move_verify.js`**
  - `verifyLoad` adds a `no_ifs` diff when the truck has no live IF, so such a truck can never be `ready`.
  - `diffText`:
    - `no_ifs` gives "This truck has no IF → add one".
    - `plan_mismatch` gives a fallback text (safety net).
  - `shadowRows` no longer emits "Skipped edit" rows. Stamps and receipts are unchanged.
- **`sl_move_portal.js`**
  - `pending` is gone from `isOpen`, `truckSummary`, `departInput` and `departData`.
  - Removed: `savePending`, `NEEDS_MGR`, `depart_cancel`, `depart_skip_write`, the `approvals.departures` section, `retries[].errorKey`/`errorOp`, and `errorKey` in `finishDepart`. `depart_retry` is kept.
  - New `checkTruck(x, c, opt)` is the verify rule with no write. `verifyTruck` uses it.
  - `departPlan(x, inp, c, chk)` plans from the IFs and pallets a matched check used. The "Nothing is loaded" guard is kept.
  - `planMismatch(plan)`: any correction or unplanned IF becomes a `plan_mismatch` diff, which is treated as a mismatch.
  - `toNeedsFix(id, m, c, claim?)` re-reads the truck, then writes `needs_fix` with the new `data.verify` and `ifs`, plus `claim:''`, `workingAt:0` and `phase:''`. When it releases our claim, it also clears the departure state written with that claim.
  - **`depart_preview`:** must be `ready` ("Verify the load first"). It then runs `verifyTruck`.
    - On a mismatch it returns `{needsFix, diffs, suggestions, view}`.
    - Otherwise it returns the stamp-only plan.
  - **`depart_confirm`** (floor allowed, no manager gate):
    1. Guard: `ready`, no claim, no depart.
    2. `claimLoad`'s extraData callback re-verifies and plans from the guarded `cur`. On a mismatch it throws, so no claim is taken, and it returns `needsFix`. On a match, the claim write carries depart, plan, alloc, ifs and writes.
    3. If the loaded pallets changed between that check and the claim, it re-checks from the claimed state, which is now frozen. A mismatch releases the claim to `needs_fix`; a match rewrites the plan under `assertClaim`.
    4. Then `finishDepart`.
  - `departData` no longer has `requestedBy`/`pending`. `approvedBy` is `c.mgr ? c.user : ''`.
  - `approvals` counts skip the open stages.
- **`move_ui.js`:** minimal, so the client never calls removed actions; the full rework is Task 5.
  - Removed: `dcancel`, `apdepart`, `apskip`, the departures card and the `t.pending` UI.
  - `open` means loading, needs_fix or ready.
  - `dpreview`/`dconfirm` handle `needsFix` by repainting and showing "IF changed in NetSuite: needs a fix again" with the diff texts.

## Old tests changed (intent kept)
Test helpers:
- `departed()` now uses the new `readyTruck(ctx, n, ifId)`. That helper loads the pallets, sets NetSuite's IF qty to the loaded qty with the new `matchIf` (only when they differ), and verifies to `ready`.
- New `ifOn700()` adds a planned **IF9901** (YSN201 ×240, TO700).

Tests switched from `truckWith` to `readyTruck`, with no other change:
- dashboard
- exact match
- failed write → retry
- retry refused
- claim stolen
- off mode
- double-tap (the stub now triggers on `ready`, not `loading`)
- finished departure
- approvals stuck
- fix3 claim write
- fix7 (40 pallets with the IF matched to 480)
- finishDepart late pallet

Tests reworked:

| Test | Change |
|---|---|
| exact match | `pv.plan.needsManager` → `pv.plan.corrections === 0`. The seal-reuse truck is `readyTruck(1,'9002')`. |
| retry skips keys already written | Was if_qty + if_stamp. Now 84 pallets on IF9001 + IF9002, and `if_stamp:9002` fails. Writes = `if_stamp:9001`; the retry doesn't repeat it. |
| unplanned IF released to planned list | Now: an empty IF9002 gives `if_empty`; the manager drops it → `ready` → departs → IF9002 is planned again. |
| receipt_approve on mode (add-on resolved) | Add-ons no longer happen at departure. Now the truck carries IF9001 + IF9901 (TO700). Same receipts per IF/TO. |
| `mixedOnTruck`, failed receipt write, late arrival rplan | Same IF9901 setup. Keys `receipt:901:1` → `receipt:9901:1`; rplan `new:700:1` → `9901:1`. I used 9901 so IF id order stays 9001 then 9901. |
| approvals lists pending departures… | Now only receipts; asserts `departures === undefined` and `retries === []`. |
| fix3 truck scan re-check / scan stack | The truck closes with a `claim` instead of `pending`. `depart_cancel` → clear the claim. |
| fix4 IF shipped meanwhile → unplanned | Now: a ready truck (IF9001 + IF9002, 84 pallets) and IF9001 gone → confirm returns `needsFix` [`if_gone`, `if_over`], and the gone IF stays flagged on the truck. |
| fix5 TO room before/after departure | A 46-pallet truck can't depart over its IF any more. Now the office raises IF9001 to 552 and TO500 room goes to 0; A verifies, departs; B is still `no_to`. |
| fix10 empty truck | Verify → `if_empty` → `needs_fix`; preview and confirm (floor and manager) are refused with "Verify the load first". |
| fix10 emptied after claim | Now returns `needsFix` [`if_empty`], with status `needs_fix`, claim `''` and depart null. |
| Task-2 I1 tests | Diff kinds now include `no_ifs`. |
| ui.test.js | Confirm list → `apretry`, `aprecv`, `dconfirm`. The `fix11` text no longer looks for "Send this departure to a manager". |

Deleted tests (they tested removed behavior):
- depart: short needs a manager / floor request waits. The brief's "depart only from ready" and "confirm re-verifies" tests replace it.
- manager approval can override the trailer; the requester is kept.
- depart_cancel reopens scanning.
- approvals: one truck whose plan throws. The departures section is gone.
- fix1 skip-write (both tests).
- fix3: depart_confirm plans from the claimed state. Replaced by "a pallet taken off right after the claim…".
- fix4: a changed qty needs a manager. Replaced by the brief's "confirm re-verifies…".
- ui.test: "fix1 retry card offers Depart without this edit" and "fix4 plan view shows IFs changed in NetSuite". Replaced by "removed: no pending, cancel or skip-write paths…".

## Concerns
1. **The beta can't depart until Task 5.** The UI has no Verify button yet, so a truck can't reach `ready` from the UI. Review departure now shows "Verify the load first".
2. **The re-verify in the claim callback runs before the claim write.** A scan in that small window is caught by the post-claim pallet-key re-check. An IF edit in NetSuite in that window is not re-checked. Departure stamps only, so the worst case is a stamp on an IF whose qty changed after the check.
3. `move_verify.inNetSuite` still ignores `skipped:` write values. I kept it for legacy store data (and its verify test). No new skipped writes can occur.
4. Receipts still run `verify.resolveNew` for legacy trucks that departed with `new:` add-on allocs. New departures never produce them.
5. `planDeparture` itself is unchanged; the `planMismatch` guard lives in the Suitelet. The guard is hard to reach: a matched verify leaves no surplus and no empty IFs.
6. `statusPill` has no labels for `needs_fix`/`ready` yet. That's Task 5.

---

# Review follow-ups (commit `2ca252f`)
"fix(verify-load): stamp checks expected lines + idempotent; depart_release; toNeedsFix guard". Not pushed.

## TDD evidence
- **RED:** I added 2 move_tx tests and 5 portal tests, and updated the expected op in the verify test `planDeparture: exact match`. That gave 7 failures. The swap test passed from the start: it covers the post-claim match path, which was already implemented.
- **GREEN:** `node --test "move_portal/test/*.test.js"` gives **172/172 pass**, with clean output.

## Changes
1. **`planDeparture`:** each `if_stamp` op carries `lines: {item: qty}`, from that IF's alloc, with qty > 0.
   - `move_tx.stampShip` compares the lines with the IF's per-item qty on ticked lines only (itemreceive !== false, qty > 0).
   - On any difference it throws `changed(...)`. An extra item on the IF also counts as a difference.
   - A legacy op without `lines` skips the check.
2. **Idempotent `stampShip`:** if status is C, `custbody7 === 'SEAL: <seal>'` and the container equals the trailer, it returns the IF id without saving. Any other status C still throws "no longer Picked/Packed".
3. **`depart_release {truckId}` (manager):**
   - Allowed only for a `departing` truck with a depart, with no `if_stamp:` key in `writes`, and with an error or a stale claim.
   - It takes the claim with that guard and re-checks it before the write.
   - It then clears `claim/workingAt/phase/error/depart/plan/alloc/unplanned/bol/writes/departPallets` and sets `needs_fix`.
   - It re-verifies with `verifyTruck` (so it goes to `ready` if the load still matches) and returns the `verifyOut` shape. The seal becomes free again.
   - `approvals.retries[]` entries carry `canRelease`.
   - I made no UI change, since the cross-check test only covers actions the client calls.
4. **Minor 1:** the mismatch now carries `seenIfs`: the IFs on the truck copy the check ran on. Both departure paths pass it. Before writing, `toNeedsFix` without a claim refuses with "changed while it was being checked" when `ifSig(cur.data.ifs)` differs.
5. **Minor 2:** added a test where two identical pallets are swapped after the claim. The plan is rewritten (`departPallets` holds the new pallet), the truck departs, and the old pallet stays labeled.
6. **Minor 4:** `depart_preview` uses `verifyTruck(..., {truck: x, poll: true})`. On an unchanged load it does no `updateLoad`, and `verify.at/by` stay as they were (tested).

## Concerns
- The expected-lines check depends on the plan alloc, which equals the IF qty for a matched load. A legacy departing truck with if_qty ops still works, because alloc includes the raise or lower, which is what the IF holds after the qty edit.
- Idempotency compares `custbody7` exactly with `'SEAL: ' + seal`. If the office retyped the seal in a different format, a Retry throws "no longer Picked/Packed", and a manager has to check it by hand.
- `depart_release` re-verifies against fresh NetSuite IFs. If a stamp landed in NetSuite but wasn't recorded (the request died after `save`), the IF is now Shipped. The re-verify then shows `if_gone`, so the truck can't depart again unseen.
