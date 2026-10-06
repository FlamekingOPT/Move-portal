# Final-review fix wave: report

Branch `feat/v3-verification`, base `021d67f`. Not pushed. Suite: **133/133 pass** (it was 103), with pristine output: every line is a ✔ or an ℹ summary line.

Every item followed TDD: write the test, run `node --test "move_portal/test/*.test.js"` and see it fail (RED), fix, then rerun and see it pass (GREEN). Below, RED shows the failing test names and counts from that command, and GREEN shows the pass count after the fix.

## Commits
| SHA | Item | Subject |
|---|---|---|
| 700a3d6 | 1 | a refused if_qty no longer strands a truck (already-done = success, depart_skip_write) |
| d4bcae3 | 2 | one grouped pallet count per list; unposted/missing kept on the truck |
| 1aa5a81 | 3 | no stale-copy writes in scan/undo/depart; scans re-check the truck; depart plans from the claimed state |
| bb1335f | 4 | re-read IFs at departure; changed or shipped IFs need a manager and show in amber |
| 537c97e | 5 | reserve TO room other trucks need before scans and departure plans |
| 57ad70a | 6+7 | hard-gate the floor deployment; approvers are the NetSuite user |
| 7c47e1d | 8 | read truck JSON in full with lookupFields; unreadable JSON throws; stacks capped at 30 |
| f10d5e0 | 9 | never-loaded flags kept on the truck and read by id |
| d477d28 | 10 | an empty truck cannot depart |
| 8f9428e | 11 | minors |
| (next) | docs | CLAUDE.md READ FIRST line and test count |

## Per item

### 1. A refused or interrupted if_qty (Critical)
- **`move_tx.setIfItemQty`:** if the IF's summed qty already equals `op.to` (and the status is A/B), it returns the IF id without saving.
- **`finishDepart`:** tracks the key of the op being applied (`curKey`) and saves `data.errorKey` on failure. A successful departure clears it.
- **New manager action `depart_skip_write {truckId, key}`.** Guards: the truck is departing with `depart`, `error` and `errorKey` set; the key equals `errorKey`; the key is an `if_qty`. The claim write (via `claimLoad`'s new function-form `extraData`) carries:
  - `writes[key] = 'skipped:<error>'`;
  - `skipped += {key, error, by: c.user, at}`;
  - `errorKey: ''`.

  It then calls `finishDepart`. The truck departs and its pallets go to `in_transit`.
- **`approvals.retries`:** each entry carries `errorKey` and `errorOp {op, ifNum, item, from, to}`.
- **UI:** the retry card shows the failed edit, a "Retry" button and a "Depart without this edit" button (`ACT.apskip`). That button calls `confirm()` naming the IF and `from → to`.
- **Report:** `shadowRows` adds a row per skipped write: check `Skipped edit IF…`, portal `504→480`, netsuite `—`, ok `false`.
- **Tests:**
  - `move_tx.test`: "if_qty already at the target qty…". RED: "IF changed… is 480, expected 504". GREEN.
  - `portal.test`: fix1 ×2.
  - `ui.test`: apskip confirm, plus skip button/api.
  - RED: 104 pass / 2 fail. GREEN: 107.
- **Choice:** only an `if_qty` key can be skipped (userErr "Only an IF quantity edit can be skipped. Press Retry."). Skipping an `if_create` would leave `writes['if_create:..']='skipped:…'`, and `resolveNew` would later hand that string to receipts as an IF id. Skipping `if_stamp` would depart a truck whose IFs NetSuite never shipped. Both stay Retry-only.

### 2. No per-truck searches in lists (Critical)
- **`palletStatusCounts(loadIds)`** added to `move_data.js` (one grouped search: load + status GROUP, COUNT, SUM pieces) and `fake_data.js`.
- **`truckSummary(x, counts)`:** with a map it never searches; without one it does a single grouped search. `truckView` and `unloadView` build counts from the pallets they already read.
- **Truck flags:**
  - `receiveOn` re-reads the truck and, in one update, writes `rstack`, `unposted+1`, `missing-1` (late pallet) and the status.
  - `unload_undo` decrements `unposted`, and adds back to `missing` when it undoes a late pallet.
  - `receipt_approve` sets `unposted` (received pallets left unposted) and `missing` (grouped count) at the end.
- **Lists:**
  - `truck_planned`, `unload_list`, `approvals`, `report` and `dashboard` each run ONE `palletStatusCounts`.
  - `unload_list` and `approvals` filter on `unposted`, `recvRequested`, `error`, `stale` and the missing count before `receiptPlan`.
  - A truck from before this change (no numeric `unposted`) falls back to the received count (no `recvSeq`) or a one-time search.
- **Tests:**
  - `fake_data.test` and new `move_data.test` (stubbed N/search) for the grouped search.
  - `portal.test` fix2 flag consistency (scan, undo, approve, late, undo late, re-approve).
  - fix2 counter: 5 received trucks plus 1 needing a receipt. `unload_list` makes 0 `palletsByLoad` calls; `approvals` makes ≤1, only for the open truck; `truck_planned`, `dashboard` and `report` make 0 per-truck calls.
  - RED: 109/2. GREEN: 111.

### 3. Stale-copy writes (Important)
- **`isOpen(x)`** = status `loading`, no `pending`, no `claim`, no `depart`. `mustOpenTruck` uses it and is called again right before the pallet update in `truck_scan`, `truck_move_here` and `truck_undo`.
- **`pushStack(id, entry)`** re-reads and skips the write unless the truck is open. `truck_undo` does the same for its stack.
- **`receiveOn`** re-checks `mustUnloadable` before the pallet changes, so APPROVING refuses.
- **`depart_confirm`:**
  - A floor request that needs a manager saves `pending` (fresh read, still loading).
  - Otherwise `claimLoad` gets an `extraData` function that plans from the guarded copy, and the claim write carries `depart`/`plan`/`alloc`/`unplanned`/`bol`/`ifs`/`writes`. This closes the logged residual race: no departing truck is ever left without its plan.
  - After the claim it plans again from the claimed state. If the loaded-pallet set changed, it rewrites the plan under `assertClaim`. If the new plan needs a manager and the requester isn't one, it releases the claim (loading, `claim`/`workingAt`/`phase`/`depart`/`plan` cleared) and saves `pending`.
- **Tests:** portal fix3 ×5 (scan / move_here re-check, stack and undo over a closed truck, unload re-check, release-after-claim then manager approves 41 pallets, claim write carries the plan). RED: 111/5. GREEN: 116.

### 4. Re-read IFs at departure (Important)
- **`verify.refreshIfs(saved, fresh)`** returns `{ifs, gone, changes}`. Each change is `{ifId, ifNum, was, now ('not Packed' | lines), wasPcs, nowPcs}`.
- **`departPlan`** (used by `depart_preview`, `depart_confirm` and `approvals`) plans from `ns.plannedIfs()` filtered to the truck's IFs. Gone IFs are added to `unplanned`, `plan.ifChanges` is set, and `needsManager` and `bol.changed` become true.
- **After departure:** `data.ifs` = the fresh IFs used, minus the unplanned ones.
- **UI:** the plan view shows `ifChanges` in amber: "IF9001 changed in NetSuite: 504 → 492" or "… → not Packed any more".
- **Tests:** verify `refreshIfs`; portal fix4 ×2 (qty changed → manager, saved `ifs` updated; IF shipped meanwhile → unplanned); ui. RED: 116/3 (after dropping an `approvedBy` assert that belongs to item 7). GREEN: 120.

### 5. Reserve TO room across trucks (Important)
- **`verify.placeSurplus`** is the raise / add-on placement factored out of `planDeparture`. It never throws, and `planDeparture`'s behavior is unchanged.
- **`verify.reserveToLines`** and **`verify.reservationsFromTrucks`:**
  - Planned trucks (departing / departed / receiving / approving) reserve their `if_qty` raises and `if_create` lines that are not in NetSuite: the mode doesn't write them, or the key isn't in `writes`, or the key is `skipped:`.
  - Loading trucks then reserve their surplus, placed against the room left after that.
- **Suitelet:** `reservedToLines` uses one `palletsByStatus([loaded])` search for all loading trucks. It feeds `scanCtx` (classify / fit / move-here) and `departPlan`.
- **Tests:** verify ×2 (off / on / exceptId); portal fix5: two trucks want TO500's last 48. The second gets `no_to`, both while the first is loading and after it departs in off mode. RED: 122/1. GREEN: 123.

### 6. Floor deployment gate (Important)
- **`FLOOR_DEPLOY_ID = 'customdeploy_move_portal_floor'`.** On that deployment:
  - `runAction` forces `mgr=false`;
  - `onRequest` passes `false`;
  - `pdf` refuses;
  - `page()` renders floor mode with `url.resolveScript({..., returnExternalUrl: true})`.
- **Test:** portal fix6. An administrator on the floor deployment gets "Managers only" from `_runAction` and from `onRequest` JSON. The floor page uses the external URL; the manager page doesn't.

### 7. Approver = NetSuite user (Important)
- **`c.user = {id, name}`** comes from `runtime.getCurrentUser()`.
- **Where it's recorded:**
  - `depart.approvedBy = c.user` when `c.mgr`, and `approvedByRoster = c.actor`;
  - `recvApprovedBy = c.user` and `recvApprovedByRoster = c.actor`;
  - skip-write `by = c.user`;
  - `depart_retry` saves `retriedBy`/`retriedAt` with its claim.
- **Floor actors** (`receivedBy`, `loadedBy`, `pending.by`) stay roster names.
- **Tests:** portal fix7, and the updated "manager approval can override the trailer" (its `approvedBy` is now the runtime user, and `approvedByRoster` is 'Boss'). RED for 6+7: 122/3. GREEN: 125.

### 8. Truck JSON read in full (Important)
- **`getLoad`** uses `search.lookupFields` on all `LF` fields (select values unwrapped). It returns null for an empty result or `RCRD_DSNT_EXIST` and rethrows anything else.
- **Bad JSON:** `loadJson` throws `Truck <id> data is unreadable` for both `getLoad` and the list functions (`rowToLoad`). It never returns `{}`.
- **Stacks:** `stack`/`rstack` capped at 30 (`STACK_MAX`; this landed in items 2–3, and this item adds its test).
- **Plan:** Task 16 Step 4 now says to save and re-read a ~10 KB truck record on prod.
- **Tests:** `move_data.test` (lookupFields path, truncated JSON throws, missing → null, other errors rethrown, list row with bad JSON throws); portal fix8 stack cap (this one was already green). RED: 126/1. GREEN: 127.
- **Fake data:** `fake_data` doesn't parse JSON (it clones), so nothing to change there.

### 9. Unload scan cost (Important)
- **`unload_scan` never_loaded:** after flagging the pallet, it re-reads the truck and adds the id to `data.flagged` (unique).
- **`unloadView`:** reads `palletsByIds(flagged)` and keeps those still `never_loaded`, labeled/loaded, and flagged by this truck.
- **Dashboard `neverLoaded`:** the same filter over the union of all trucks' `flagged`, in one `palletsByIds`.
- **Test:** portal fix9 (0 `findPalletsWhere` calls; a duplicate flag is stored once; a voided stray drops out of the count and the view). RED: 127/1. GREEN: 128.

### 10. Empty truck (Important)
- **`departPlan`** throws `userErr('Nothing is loaded on this truck')`, which covers preview, confirm and approvals.
- **Post-claim re-plan:** if it throws a user error (the truck emptied right after the claim), the claim is released back to loading.
- **Tests:** portal fix10 ×2. RED: 128/1. GREEN: 130.

### 11. Minors
- **dconfirm text:**
  - floor + `needsManager` → "Send this departure to a manager for approval?";
  - `on` → "Confirm departure? Trailer and seal go on the IFs.";
  - `off`/`qty` → "Confirm departure? (plan only — NetSuite is updated by the office)".

  It uses the last preview plan (`S.dplan`) and `S.tv.writeMode`.
- **Stuck receipt error card button:** "Re-approve receipt" (the normal card already had it).
- **Report table:** wrapped in `overflow-x:auto`.
- **`ui.test` regex:** now `'ACT\\.'`.
- **`planReceipts`:** `cum[k] = Math.max(g, before)`.
- **`truck_scan`:** a non-labeled pallet (dup, void, unknown, locked, shipped, other_truck) is classified with only `data.getLoad(p.loadId)` for the other truck's label. No `openToLines`, no `allTrucks`.
- **Tests:** verify (cumulative floor), ui fix11, portal fix11 (0 `openToLines` / `loadsByStatus` calls for dup/void/unknown/other_truck; a labeled scan does call them). RED: 130/3. GREEN: 133.

## Final verification
- `node --test "move_portal/test/*.test.js"` → `ℹ tests 133 · pass 133 · fail 0`. No output lines other than ✔ and ℹ.
- **Smoke test** (scratchpad script, in-process, on a COPY of `move_portal/local/store.json` with the `prod-2026-10-05.json` snapshot; the running preview server and the real store were not touched):
  - `truck_planned`, `unload_list`, `approvals`, `dashboard` and `report` are OK on the old (pre-flag) truck.
  - End-to-end start → scan → preview → floor depart → unload → approve works; the flags end at `[0, 0]` and the report has rows.
  - The page script parses.
- **Note:** the preview server started earlier still runs the OLD code until it's restarted.

## Files changed
- `move_portal/move_tx.js`
- `move_portal/move_verify.js`
- `move_portal/move_data.js`
- `move_portal/sl_move_portal.js`
- `move_portal/move_ui.js`
- `move_portal/test/fake_data.js`
- `move_portal/test/portal.test.js`
- `move_portal/test/verify.test.js`
- `move_portal/test/ui.test.js`
- `move_portal/test/move_tx.test.js`
- `move_portal/test/fake_data.test.js`
- `move_portal/test/move_data.test.js` (new)
- `docs/superpowers/plans/2026-10-05-move-portal-verification.md` (Task 16 Step 4 note)
- `CLAUDE.md`

## Concerns and choices to review
1. **Skip only `if_qty`** (item 1). See the choice under item 1. A refused `if_stamp` or `if_create` is still Retry-only.
2. **Reservations in off mode** (item 5): per the brief, planned-but-unwritten raises and add-ons reserve TO room. In a prod beta where the office does the real NetSuite edits in `off` mode, the live TO "remaining" will ALSO drop when they do, so that room is counted twice. That's conservative (an early `no_to`), never over-allocating.
   - Received trucks don't reserve (the brief lists departing/departed/receiving; I added approving as part of receiving).
   - Skipped (`skipped:`) keys keep reserving until the truck is received.
3. **Loading-truck reservations** use their saved `data.ifs`, not a fresh re-read, to keep scans cheap. Each loading truck is placed against the same post-departed room, so two loading trucks can both reserve the same last units. That's conservative too; the departure plan is the final check.
4. **List reads** (`allTrucks` via search columns) now throw "Truck <id> data is unreadable" if NetSuite truncates a long `custrecord_mvl_data` column. That's loud, not silent, but it would break the whole list. The Stage 2 checklist now tests a ~10 KB record. If columns do truncate, the lists will need `getLoad` per truck or smaller truck JSON.
5. **`lookupFields` not-found behavior** is handled both ways (`{}` result or an `RCRD_DSNT_EXIST` throw). Confirm on prod.
6. **`depart_confirm`** now plans twice for a manager departure (before and after the claim): one extra `palletsByLoad` + `openToLines` + `palletsByStatus` per departure. Departures are rare, so that's acceptable.
7. **`approvedBy`** is now set whenever a manager departs the truck (`c.mgr`), not only when the plan needed a manager. It's an object `{id, name}`, not a string; no UI reads it.
8. **Legacy local-store trucks** without the `unposted`/`flagged` fields: `unposted` falls back to one search. Never-loaded pallets flagged before this change won't show in the unload view or dashboard (they were never added to `flagged`). That only affects the local beta store.

## Re-review follow-ups (base 39cbccf)
TDD: 4 new or changed tests failed (RED: 137 pass / 4 fail), then passed after the fixes (GREEN). The suite is **141/141**, with pristine output.

1. **Fail-closed floor gate.**
   - The rule: manager is allowed only when `deploymentId === MANAGER_DEPLOY_ID` (`customdeploy_move_portal`), the user id is > 0, and the role check passes. Every other deployment is floor.
   - It is applied in `runAction`, `onRequest`, `pdf` and `page`.
   - `returnExternalUrl` is still used only on `customdeploy_move_portal_floor`. An unknown deployment renders floor mode with its normal URL.
   - The preview server's fake runtime now reports the manager or floor deployment id per request. The running :8765 server was not restarted, so it picks this up on its next start.
   - The portal test setup defaults to the manager deployment with user id 5.
   - New test: an unknown deployment with an admin role is floor (actions, onRequest, page, pdf), and user -4 on the manager deployment is floor.
2. **Only planned pallets depart.**
   - The claim write saves `departPallets` (the plan's `palletKey`). `finishDepart` moves only those pallets to `in_transit`.
   - Any other pallet still `loaded` on the truck goes back to `labeled`, with load cleared and `data.flag = 'left_at_dock'` (plus `leftAt` and `leftTruck`).
   - A truck from before this change (no `departPallets`) moves all its loaded pallets, as before.
   - Test: a pallet loads during the NetSuite write and is left at the dock; the 42 planned pallets are in transit.
3. **`receipt_approve` final write.**
   - It now runs `assertClaim` right before the final re-read and update.
   - `receiveOn` already refuses while the truck is APPROVING, because it re-checks `mustUnloadable` before the pallet changes.
   - Test: when the claim is stolen before the final write, the approval throws and leaves `recvSeq` unset; an unload scan is refused while approving.
4. **Reads.**
   - `move_data.getLoad` now uses `record.load` (2 units) and `getValue` per field. RCRD_DSNT_EXIST returns null; any other error is rethrown; bad JSON still throws "Truck <id> data is unreadable".
   - The Task 16 Step 4 line now reads: save and re-read a ~10 KB truck via `getLoad` AND `loadsByStatus`.
5. **Comments.** The mangled constant comments at `sl_move_portal.js` lines 18–20 are fixed.

Concerns:
- `left_at_dock` pallets show only through the pallet flag; no screen lists them yet.
- The `record.load` not-found error name (`RCRD_DSNT_EXIST`) should be confirmed on prod.
