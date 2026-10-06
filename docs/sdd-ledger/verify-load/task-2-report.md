# Task 2 report: stages, take-off, Verify, recheck, add/drop IF

**Status:** DONE. Commit `34af932` "feat(verify-load): verify/needs_fix/ready stages, take-off scan mode, recheck, add/drop IF" on `feat/v3-verification` (not pushed).

## TDD evidence
- RED: appended the 5 brief tests; `node --test "move_portal/test/portal.test.js"` → all 5 failed with `Unknown action: truck_verify` (take-off test calls verify first).
- GREEN: after implementation, the full suite ran 153/153.
- Two extra tests were added for guards the brief asks for but didn't test:
  1. `a pallet on a ready truck reads other_truck; move here sends both trucks to loading; remove and undo flip ready too`. It went RED when I temporarily removed the open-stage mapping in `scanTruckMap` (the pallet read as `locked`), then GREEN once restored.
  2. `verify saves the fresh NetSuite IFs; refuses when the truck changed meanwhile; drop_if keeps one IF`.
- **Final:** `node --test "move_portal/test/*.test.js"` → **155/155 pass**, with no stray output.

## What changed (`move_portal/sl_move_portal.js`)
- `OPEN = [loading, needs_fix, ready]`. `isOpen` = status in OPEN, no claim, no depart, **and no pending** (kept per the controller note; Task 3 removes it).
- New `touched(id, patchData, noPalletChange)` re-reads the truck, does nothing if it is no longer open, and flips `ready → loading` in the same write. Used by:
  - `pushStack` (scan, move_here)
  - `truck_remove`
  - `truck_undo` (flips only when a pallet was actually undone)
  - the source truck in `truck_move_here`
  - take-off
- `scanTruckMap`: for load scans, a pallet on another open-stage truck reads as `loading`, so it gets `other_truck` and can be moved here; without this, `needs_fix`/`ready` trucks would show as `locked`. `truck_move_here` now uses `isOpen(from)` instead of `status === loading && !pending`. I did this in the Suitelet so `move_verify.classifyLoadScan` stays untouched.
- `truck_scan` with `mode:'off'` (`takeOff`):
  - Does not call `scanCtx`.
  - A pallet loaded on this truck goes back to `labeled`, its load is cleared, and it is stamped `takenOffAt/By/Truck` → `taken_off` / `warn`.
  - Anything else → `not_on_truck` / `bad`.
  - Logged with `mode:'off'`.
- `verifyTruck(id, c, {newIfs, trucks, planned})`:
  - Runs `verifyLoad` on fresh `ns.plannedIfs()`, the truck's loaded pallets and `reservedToLines`.
  - Then re-reads the truck and refuses if it is closed, or if its IF set or loaded-pallet set changed during the check ("changed while it was being checked. Verify again.").
  - Writes `status` (`ready`/`needs_fix`), `data.ifs = r.ifs` and `data.verify = {at, by, diffs}`.
  - Returns `{r, x, ps, ...}`.
- Actions:
  - `truck_verify`
  - `trucks_recheck` (needs_fix trucks only; shares one `plannedIfs`/`allTrucks` read; skips trucks that error with a user error)
  - `truck_add_if`:
    - Floor: only an IF in the current `ifSuggestions` of a `needs_fix` truck.
    - Manager: any Picked/Packed IF.
    - Both: refused if the IF is already on this or another truck.
  - `truck_drop_if` (manager; refuses the last IF on a truck).
- `pubDiffs`: each diff plus `sku` and `text` (`diffText`). The pallet count is shown only when all loaded pallets of that item share one pcs value.
- `truckView` adds `stage`, `verify` (diffs as pubDiffs) and `suggestions` (only in `needs_fix`, which is the only case where the view reads `plannedIfs`).
- `truck_planned.open` now also lists `needs_fix`/`ready` trucks.

## Old tests changed
None. Every old test passes unchanged.

## Concerns / deviations
1. **`truckSummary` still returns `pending`.** The brief says drop it, but the old test `depart: short needs a manager…` asserts `view.truck.pending.seal`, and the controller said pending stays until Task 3. Task 3 should drop it there.
2. **Departure is still from `loading` only** (`depart_confirm` unchanged). So in this commit, a truck that has been verified (`ready`/`needs_fix`) can't depart until Task 3 switches departure to "from ready".
3. **`data.ifs = r.ifs` drops `if_gone` IFs on the first verify** (`refreshIfs` excludes them). The `if_gone` diff shows once; the next verify no longer lists it. Pallets loaded against it still show as `no_if`/`if_over`, so nothing goes silently wrong, but the "take it off this truck" instruction is a one-shot. This follows the brief; flag it if the UI should keep showing it.
4. `trucks_recheck` writes a verify result (and refreshed IFs) to every open `needs_fix` truck on each call. That is one `getLoad` + `updateLoad` + 2 `palletsByLoad` per truck, which is fine at 5–7 trucks a day.

---

# Review fix wave (I1, I2, M1, M3, M4): commit `3da942d`
"fix(verify-load): gone IFs persist until dropped; cheap non-destructive recheck" (not pushed).

## TDD evidence
- **RED:** I appended 10 tests (2 in verify.test.js, 8 in portal.test.js). 6 failed:
  - the 2 verify tests (no `keep`, no `liveIfs`)
  - I1 persist
  - I1 only-IF-gone
  - I2 no-change
  - I2 single read
- **Already passing as written (coverage for behavior that was already right):**
  - M4 recheck skip
  - M4 manager add / other-truck refusal
  - M4 take-off reads no TO lines
  - I1 last-IF-not-gone refusal
- **GREEN:** `node --test "move_portal/test/*.test.js"` gives **165/165 pass**, with pristine output.

## Changes
- **I1, `move_verify.js`:**
  - New exported `liveIfs(ifs)` filters out `gone` IFs.
  - `reservationsFromTrucks` fills and places surplus on live IFs only.
  - `verifyLoad` also returns `keep` = the fresh IFs plus the last saved copy of each gone IF, flagged `gone: true` with its lines kept.
  - If a gone IF reappears in NetSuite, it comes back live.
- **I1, Suitelet:**
  - `verifyTruck` saves `data.ifs = r.keep`, so `if_gone` repeats on every verify and recheck.
  - `truckView` lines and fill and `scanCtx` capacity use `liveIfs`; a gone IF expects nothing.
  - `truckLabel` still lists gone IF numbers; with no IFs it reads `No IFs: add one`.
  - `truck_drop_if` can drop the last IF only when it's gone. Verify then gives `no_if` for everything loaded.
  - Suggestions still use all IFs, including gone ones, so a replacement IF on the gone IF's TO gets suggested.
- **I2:**
  - `trucks_recheck` reads `allTrucks`, `ns.plannedIfs`, `ns.openToLines` and `data.palletsByStatus([LOADED])` once (only when a needs_fix truck exists). It passes them in, along with the truck itself.
  - `reservedToLines` takes optional `openTo`.
  - With `poll: true`, `verifyTruck` writes only when the status, the IF signature (ids, gone flags, line qtys) or the diffs changed, so a no-change poll does no `updateLoad` and leaves `verify.at/by` alone.
  - A manual `truck_verify` always writes and records at/by.
  - When a poll does find a real change, it records at/by for that change.
- **M1:** `verifyOut` passes `planned`/`trucks` into `truckView(x, c, opt)`, so suggestions don't re-read them.
- **M3:** the order is now the pallet-key check, then `cur = data.getLoad(id)`, then an open check, then an IF-signature check, then the write.

## Concerns
- The poll compares diffs by full JSON, not just keys. A changed qty on the same diff key (short 40→44) counts as a change and is written, so saved diffs never show stale numbers.
- The trucks list in a recheck is read once. A verify write on truck A in the same recheck refreshes A's IF lines, but truck B's reservations use the list read at the start. This is negligible, since verify writes don't move pallets.
- The old departure path (`departPlan`) still treats a gone-flagged IF as unplanned and as an IF change that needs a manager, same as before. Task 3 replaces it.
