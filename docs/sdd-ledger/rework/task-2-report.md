# Task 2 report: Shipments: floor marks shipped, manager confirms or sends back

**Status:** Done. Commit `451e4c3` on `feat/v3-verification`, not pushed. It carries the Fable 5.1 trailer.
**Suite:** `node --test "move_portal/test/*.test.js"` gives **218/218 pass**, with no other output. That is 212 before this task, plus the 4 brief tests, 1 `verify.test.js` test and 1 extra portal test.

## TDD evidence
- **RED:** the 4 brief tests plus the new `verify.test.js` test failed: 217 tests, 212 pass, 5 fail.
- **GREEN:**
  - `move_verify` first: `verify.test.js` went to 37/37.
  - Then `sl_move_portal`, then the existing tests were converted and the UI bridged (see below). Result: 217/217.
  - Then 1 extra coverage test: 218/218.

## Implementation
**`move_verify.js`**
- Added `TRUCK.SHIP_PENDING = 'ship_pending'`.
- `reservationsFromTrucks` puts `ship_pending` trucks with `loading`/`needs_fix`/`ready`, so their loaded surplus reserves TO room.
- `sealUsed` now counts a truck's seal from `depart.seal`, or from `data.shipReq.seal` if it hasn't departed (new `sealOf`). Seals are still compared by digits through `sealKey`.
- `classifyUnloadScan`: a loaded pallet on a `ship_pending` truck now reads `locked` (it used to be `never_loaded`), like a pallet on a `departing` truck.

**`sl_move_portal.js`**
- **Locked while waiting:** `isOpen` was already false for `ship_pending`, since `OPEN` is unchanged. A new `waitingErr()` gives "This truck is waiting for a manager to confirm shipping". It's used by:
  - `mustOpenTruck`, which covers scan, take-off, remove, undo, move-here and other items;
  - `closedErr`, which covers verify and add/drop IF;
  - `correctGuardErr`, which covers `truck_correct`.
- **`ship_mark`** (floor):
  1. Checks `mustReady`; marking a truck that's already `ship_pending` gives "This truck is already marked shipped".
  2. Requires a seal and refuses one already used (`sealTaken`).
  3. Re-verifies with `verifyTruck(..., {poll: true})`. A mismatch returns `needsFix` plus `verifyOut`, and the truck is `needs_fix`.
  4. Runs `departPlan` and `planMismatch` as the old preview did. A plan mismatch goes through `toNeedsFix`.
  5. Re-reads the truck, checks `mustReady`, and checks the IF and pallet signatures. Then one write: status `ship_pending`, `shipReq = {trailer: data.trailer, seal, carrier (default Armstrong Group), by, at}`, `sentBack: null`.
- **`ship_confirm`** (manager) is the old `depart_confirm` body:
  - The guard is `mustPending`: `ship_pending`, no claim, no depart, `shipReq` set.
  - Input comes from `shipInput`: trailer = `data.trailer`, seal and carrier from `shipReq`, `markedBy = shipReq.by`. This input is spread into `depart`.
  - Planning uses `markCtx`, a copy of `c` whose `now` is `shipReq.at` with its `dayIso` from `core.parseNsStamp`. So `depart.at` is the floor's mark time, and Truck # counts that day.
  - `approvedBy = c.user`, since a manager is always the caller.
  - **Mismatch before the claim:** `toNeedsFix(..., null, pending = true)`. It is guarded on `ship_pending` with no claim, writes `needs_fix` with the diffs, and clears `shipReq`.
  - **Mismatch after the claim:** the existing claim path, which now also clears `shipReq`.
  - `shortNote` is cleared only in `finishDepart`'s final write (the Task 1 follow-up).
- **`ship_sendback`** (manager):
  - The note is required, trimmed and capped at 300 chars.
  - Fresh read, then `mustPending`, then one write: `loading`, `sentBack = {note, by: c.user, at}`, `shipReq: null`.
  - The next `ship_mark` clears `sentBack`.
- **Removed:** `depart_preview`, `depart_confirm`, `departInput` and `pubPlan`.
- **Kept:** `depart_retry` and `depart_release`. `depart_release` now also clears `shipReq`, so the seal is free again.
- `truckSummary` adds `shipReq` and `sentBack`, and `truckView.truck` gets them through it.
- `truck_planned.open` now includes `ship_pending`.
- `TRAILER_BUSY` uses `T.SHIP_PENDING`.
- `trucks_recheck` already skips `ship_pending` (it only polls `needs_fix` and lists `ready` + open), and the new test checks this.
- `approvals.shipPending`: `[{truck, trailer, seal, carrier, ifs: [{ifNum, lines}], pallets, pcs, otherItems, markedBy, markedAt}]`.
  - `pallets` and `pcs` come from the counts read the approvals screen already makes, using LOADED pallets.
  - `markedBy` goes through `whoName`.
  - All existing keys are kept.

**`move_ui.js`: a minimal bridge, needed because `ui.test.js` checks that every client `api()` action exists on the server**
- The Ready card's form is now Seal # + carrier + **🚚 Mark shipped** (`ACT.dmark` → `api('ship_mark')`, with a `confirm`).
- The `ship_pending` stage shows "Marked shipped: waiting for a manager to confirm".
- Added the pill "Shipped by floor".
- Removed the floor trailer picker, `planHtml`, `ACT.dpreview` and `ACT.dconfirm`.
- Task 4 moves this to the Shipments tab.

## Existing tests changed
- **New helper `ship(ctx, a)`** in `portal.test.js`. It runs `ship_mark` as the floor, then `ship_confirm` as a manager, passing `actor` through. If the mark returns `needsFix`, it returns that result instead.
  - All 41 `ctx.run('depart_confirm', …)` calls before the new tests now go through `ship(ctx, …)`. That includes `departed()` and the other local helpers.
  - Their `trailer:` argument is dropped, because the trailer is the truck's own now.
  - Error expectations (`NetSuite write failed`, `already being`, `already departing`, `Verify the load first`, `already used`, `request died`, `changed while it was being checked`) still hold. They come from whichever step raises them.
- **Converted tests:**
  - `depart: exact match → …`: the `depart_preview` truckNo and plan checks now read `data.depart.truckNo` and `data.plan` after departure.
  - `fix10: an empty truck cannot depart`: the `depart_preview` line is now `ship_mark`, and the duplicate confirm line was dropped.
  - `depart only from ready; floor confirms; stamp-only plan` is now `… floor marks, manager confirms …`. The plan is read from `data.plan`.
  - `confirm re-verifies: an IF changed …` is now `mark shipped re-verifies …`. The mismatch is now caught at mark, so no claim is ever taken. It asserts the claim is empty and `shipReq` is unset.
  - `preview re-verifies too …` is now `ship_mark re-verifies: … marks nothing`.
  - `departData drops requestedBy and pending; the floor departs with no approver` is now `… the confirming manager is the approver, the floor is markedBy`.
  - `depart_preview on an unchanged load keeps verify at/by` is now `ship_mark on an unchanged load keeps verify at/by (one write: the mark)`.
- **`ui.test.js`:**
  - `"api('depart_confirm'"` is now `"api('ship_mark'"`.
  - The confirm-prompt and markSeen/departRefused checks moved from `dconfirm`/`dpreview` to `dmark`.
  - The departure confirm texts became the mark-shipped confirm text.
  - The `'Confirm departure'`/`'Review departure'` strings became `'Mark shipped'`.
- No test was deleted.

## New tests
- The 4 brief tests.
- `verify.test.js`: `ship_pending: reserves loaded surplus like ready; its shipReq seal is taken; its loaded pallets are locked at unload`.
- `portal.test.js`: `ship_pending: holds its seal, is listed as open, refuses edits; a re-mark after send back clears sentBack`. It covers:
  - the seal held for another truck;
  - `truck_planned.open`;
  - `truck_other_add` and `truck_correct` refused with the waiting message;
  - re-marking refused;
  - recheck skips the truck;
  - the `approvals.shipPending` fields;
  - after send back, the same seal works again and `sentBack` is cleared;
  - `depart.markedBy`;
  - a second confirm is refused.

## Concerns
1. **The local beta can't depart a truck yet.**
   - There's no manager Approvals card for ship confirmations; that's Task 5 UI. Until it lands, a marked truck stays `ship_pending`.
   - The floor UI still calls `truck_start` without a trailer (Task 4).
2. **The real truck can reach Tippecanoe before a manager confirms.** A `ship_pending` truck is not unloadable, and its pallets read `locked` at unload. If managers are slow to confirm, the unload crew will be blocked. This is a process risk for Jack.
3. **Truck # is counted at confirm time, over the day of the mark.** Confirming two marked trucks out of order gives them numbers in confirm order, not mark order.
4. `ship_mark` builds a full departure plan only to catch plan mismatches early, as the old preview did. That costs one extra `reservedToLines` call. The plan isn't saved; confirm builds it again.
