# Final-review fix wave — Move Portal v3 (branch feat/v3-verification)

Source: the final whole-branch review (opus), plus Jack's decisions on 2026-10-05. Spec: `docs/superpowers/specs/2026-10-01-move-portal-verification-design.md`. Plan: `docs/superpowers/plans/2026-10-05-move-portal-verification.md` (Global Constraints at top). The review history is in `.superpowers/sdd/progress.md`.

Rules:
- Use TDD for every behavior change: write the failing test first, then the fix.
- Run tests from the repo root with `node --test "move_portal/test/*.test.js"` (the quoted glob is required on Windows).
- Commit once per numbered group (several commits are fine). Every commit message ends exactly with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Do not push.
- Never kill node processes by image name.

**Lesson to apply throughout.** `data.updateLoad(L, patch)` rebuilds `data` as `Object.assign({}, L.data, patch.data)`, using the copy you pass in. In any multi-step code, re-read with `data.getLoad(id)` before `updateLoad`, and re-check status, claim and pending before writing.

## 1. A refused or interrupted `if_qty` must not strand a truck (Critical; Jack chose "Depart anyway")
- **Already done counts as success.** In `move_tx.js` `setIfItemQty`, if the summed current qty already equals `Number(op.to)` (and the status is A/B), return the IF id without saving. This covers the case where a write landed but the request died before `onWrite`. Test it in `move_tx.test.js`.
- **New manager action `depart_skip_write {truckId, key}`.** It applies to a truck in `departing` whose `data.error` came from a refused NetSuite write:
  - Record `writes[key] = 'skipped:' + <error message>` so `runOps` treats the key as done. Also record `skipped: [{key, error, by, at}]` on the truck.
  - Then continue `finishDepart` under a fresh claim. The truck departs, and its pallets go to `in_transit`.
  - `finishDepart` must save which op key failed (`data.errorKey`) so the UI knows what to skip. Get the key from the op being applied when the exception hits, e.g. track the current key in the apply callback.
- **Approvals:** `retries` entries carry `errorKey`. The UI Approvals card shows the error with two buttons: "Retry" and "Depart without this edit". The second calls `depart_skip_write` after a `confirm()` that names the IF.
- **Report:** `shadowRows` (or the `report` action) adds a row for each skipped write: check `Skipped edit <ifNum>`, portal `<from→to>`, netsuite `—`, `ok: false`. This makes the office fix it.
- Receipts on a truck with skipped writes still plan from `alloc` (what was scanned). Don't change that.

## 2. Remove per-truck searches from the lists (Critical; governance)
- Add a data-layer function `palletStatusCounts(loadIds)`, to both `move_data.js` and `fake_data.js`. It does one grouped summary search: pallet `load` + `status` + COUNT + SUM(pieces). It returns `{loadId: {status: {n, pcs}}}`.
- Also maintain an `unposted` count and a `missing` count on the truck record:
  - When an unload scan receives a pallet, re-read the truck and set `data.unposted = (unposted || 0) + 1`.
  - At receipt approval, set `data.unposted` from the pallets that are still unposted after the approval.
  - Set `data.missing` at approval.
  - Undo of a receive decrements `unposted`.
  - Keep `data.unposted` and `data.missing` consistent and test them.
- `truckSummary` takes an optional precomputed counts map. When the map is given, it must not search.
- `truck_planned`, `unload_list`, `approvals`, `report` and `dashboard` each run ONE `palletStatusCounts` for all the trucks they show, and use the truck-record flags (`unposted`, `missing`, `recvRequested`, `error`, `stale`) to filter BEFORE calling `receiptPlan`. `receiptPlan` runs only for trucks that will actually be listed under receipts.
- Add a test using a call counter on the fake (count `palletsByLoad` calls): `unload_list` and `approvals` with 5 received trucks call `palletsByLoad` at most once per truck actually needing a receipt, and 0 times for fully-received trucks.

## 3. Stale-copy writes in scan, undo and depart (Important)
- `pushStack` and `truck_undo`: re-read the truck. If its status is no longer `loading`, or it has `pending`, `claim` or `depart`, do NOT write the stack (the pallet update itself is already done).
- **Truck scans re-check before changing a pallet.** `truck_scan` and `truck_move_here` re-read the truck right before updating the pallet. If it's no longer open (`loading`, no `pending`, no claim), refuse with the "Scanning is closed" error. The same rule applies to unload scans and APPROVING.
- **`depart_confirm` plans from the claimed state.** For the manager / no-correction path, claim first (with the guard), then build the departure plan from the claimed truck and the current pallets. If the plan now needs a manager and the requester isn't one, release the claim: restore status `loading` and clear `claim`/`workingAt`/`phase`. Then save `pending` as before.
- Write `depart`/`plan`/`alloc`/`writes` in the same `updateLoad` as the claim where possible (`claimLoad`'s `extraData`). This closes the logged residual race.

## 4. Re-read IFs at departure (Important; Jack chose "Re-read and show")
- In `depart_preview`, `depart_confirm` and `approvals`, plan from fresh IFs: `ns.plannedIfs()` filtered to `truck.data.ifs` ids. If one of the truck's IFs is missing from the fresh planned list (no longer Picked/Packed), or its lines differ from the saved copy:
  - plan from the fresh lines, and drop IFs that are no longer planned (they become `unplanned`);
  - add `ifChanges: [{ifId, ifNum, was, now}]` to the plan, where `now` is `'not Packed'` or the new lines;
  - set `needsManager = true`.
- The UI plan view shows `ifChanges` in amber ("IF72287 changed in NetSuite: 1152 → 1104").
- After a successful departure, `data.ifs` = the fresh IFs used.

## 5. Reserve TO room across trucks (Important)
- Build a reservation map `{toId|item: qty}` from the other v3 trucks:
  - **Loading trucks** (their current scanned surplus: raise and add-on amounts from a dry `planDeparture`, or simpler, from `fillExpected` left-overs allocated like `planDeparture`).
  - **Departed or receiving trucks** whose `if_qty` raises and `if_create` add-ons are not yet written. That means the write mode is `off`/`qty`, or the key is not in `writes`. NetSuite doesn't reflect those yet.
- Subtract the reservation from `toLines[].remaining` (floor 0) before `classifyLoadScan`, `fitOnTruck` and `planDeparture`.
- Keep this in a pure helper in `move_verify.js`, e.g. `reserveToLines(toLines, reservations)`, plus a helper that derives reservations from truck rows. Unit-test it.
- Add a portal test: two trucks that both want the last 48 units of TO room. The second one gets `no_to`.

## 6. Hard-gate the floor deployment (Important)
- `runAction` and `onRequest`: if `runtime.getCurrentScript().deploymentId === 'customdeploy_move_portal_floor'` (make it a constant `FLOOR_DEPLOY_ID`), then `mgr = false` whatever the role. `page()` also renders floor mode there.
- `page()`: build the page URL with `url.resolveScript({ ..., returnExternalUrl: true })` when on the floor deployment, so API calls go to the external no-login URL.
- Add tests (portal.test.js): with the fake runtime `deploymentId` set to the floor id and an administrator role, a manager action is rejected with "Managers only".

## 7. Approver = the NetSuite user (Important; spec §10)
- When `c.mgr`, record the approver from `runtime.getCurrentUser()` as `{id, name}`, in:
  - `depart.approvedBy`;
  - `recvApprovedBy`;
  - skip-write `by`;
  - retries.
- Keep the roster "I am" name separately (`approvedByRoster`). Floor actors stay as the roster name.
- `c` should carry `user: {id, name}`.
- Test that `approvedBy` is the runtime user even when `body.actor` is something else.

## 8. Truck JSON must not be read back truncated or silently emptied (Important)
- In `move_data.js`, make `getLoad(id)` read the record with `search.lookupFields` (or `record.load`) for `custrecord_mvl_data`, so it isn't limited to search-column length. The list functions may keep search columns, but:
- **A JSON parse failure on load data must throw** `Error('Truck <id> data is unreadable')`, never return `{}`. Apply the same to `fake_data` if it parses.
- Keep the stacks small: `stack` and `rstack` capped at 30 entries.
- Add a note to the Stage 2 checklist (plan Task 16, Step 4) to save and re-read a ~10 KB truck record on prod.

## 9. Unload scan cost (Important; logged T8)
- `unloadView`'s flagged list: store `flagged: [palletId]` on the truck when `never_loaded` is flagged (re-read before writing), and read those pallets by id instead of searching all labeled/loaded pallets.
- `dashboard` `neverLoaded`: use a dedicated count. Add a `custrecord`-free approach: keep a `neverLoaded` counter in settings or count from trucks' `flagged` arrays. The second is simpler.

## 10. An empty truck cannot depart (Important)
- `departPlan`/`depart_confirm`/`depart_preview`: if no pallets are loaded, refuse with `userErr('Nothing is loaded on this truck')`. Add a test.

## 11. Minors to fold in (cheap)
- **Departure confirm text** (`move_ui.js`):
  - When it's a floor request that needs a manager, use "Send this departure to a manager for approval?".
  - Otherwise, in `off`/`qty` mode use "Confirm departure? (plan only — NetSuite is updated by the office)", and in `on` mode "Confirm departure? Trailer and seal go on the IFs."
  - Pass `writeMode` in the view (it's already there).
- **Stuck receipt card button text:** "Re-approve receipt".
- **Report table:** wrap it in a div with `overflow-x:auto`.
- **Unescaped dot in the test regex:** `ACT\\.` in `ui.test.js`.
- **`planReceipts` cumulative must never go below an earlier approved qty:** `cum[k] = Math.max(g, before)`. Add a test.
- **A load scan on a dup/void/unknown/locked/shipped result** must not call `ns.openToLines()` or `allTrucks()`. Classify the state first, and fetch capacity data only for `labeled` pallets. Use `data.getLoad(p.loadId)` for the other truck's label.

## Report
Write `.superpowers/sdd/final-fix-report.md`: per item, what changed, the tests (RED→GREEN with commands and output), the final full-suite count, files changed, and concerns. Update the CLAUDE.md READ FIRST block: add one line "Final-review fix wave done (items 1–11)", and update the test count.
