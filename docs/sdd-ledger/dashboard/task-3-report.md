# Task 3 report: Dashboard rebuilt around trucks, approvals and Active loads

Commit: 02d3459 (`feat(dashboard): trucks per day, approvals waiting ...`). Suite: 270/270, output pristine.

## What was done
- `approvals` body renamed to `approvalsView(c)`; `act('approvals', true, (a, c) => approvalsView(c))`. Task 1/2 `settlePending` loop and `flagged` untouched.
- `act('dashboard')` replaced with the brief's code (`STAGE_ORDER`, `stageOf`, `lastStepOf`, `dayOfStamp`, `firstText` top-level helpers next to it; payload `{waiting, tiles, rows, days, exc, noConfigSkus, target}`).
- Old test `dashboard counts moved, ...` deleted; the two new dashboard tests added.

## TDD
- RED: with the old `sl_move_portal.js` restored (git stash), both new dashboard tests fail. (Note: I implemented before running the RED check, then confirmed RED retroactively by stashing the source file.)
- GREEN: full suite 270/270 (269 - 1 + 2).

## Deviations from the brief (all forced by existing code/tests)
1. **`tracker(c, est)` was NOT deleted.** The `plan` action still calls it (`const m = tracker(c, sm.est)`), so deleting it breaks the print plan. Only the dashboard stopped using it. `stockModel` kept as instructed.
2. **N+1 guard (test `fix2: unload_list and approvals do not search pallets per truck`)**: the brief's dashboard called `data.palletsByLoad` per departed truck and left `counts` unused. Changed to one grouped `data.palletsByStatus([IN_TRANSIT, RECEIVED, MISSING])` split by load id (only active trucks kept, like the brief's `loadedAll` for LOADED), and `got` (any pallet received) now reads `cnt(counts, x.id, VP.RECEIVED) > 0` from the single `palletStatusCounts` call, so `counts` is used.
3. **fix2 test adjusted**: `dashboard` was removed from the "no palletsByLoad calls" loop because it now reuses `approvalsView`, whose receipt card legitimately does one `palletsByLoad` for the open (receiving) truck. New assertions: dashboard adds <= 1 `palletsByLoad` call and only for the open truck, and exactly 2 `palletStatusCounts` calls (approvals' + its own); final grouped count 6 (was 5).
4. **Row order conflict in the brief**: the brief's `STAGE_ORDER` (Receipt pending, Waiting for manager, Ready to ship, Needs IF fix, Loading, In transit, Unloading, Received) sorts IF9002 'Waiting for manager' before IF9001 'In transit', but the brief's test asserted the opposite. I kept the code verbatim (it matches the client `STAGES` array in the plan's Task for `move_ui`) and changed the test expectation to `[['IF9002','Waiting for manager'],['IF9001','In transit']]` (and `rows` indexing swapped accordingly). Controller should confirm this is the intended default order; the UI sorts client-side anyway.
5. `waiting` came out as exactly `ship, flagged, receipts` as predicted.

## Files
- `move_portal/sl_move_portal.js`
- `move_portal/test/portal.test.js`

## Self-review
- `stageOf` / `lastStepOf` are top-level inside the module (usable by Task 4).
- `exc.neverLoaded` keeps name/semantics (fix9 passes).
- Dashboard still does `data.palletsByStatus([LOADED])` and now `palletsByStatus([IN_TRANSIT, RECEIVED, MISSING])` globally (filtered in memory to active loads). In prod that reads all shipped/received pallets of the whole move (thousands of rows by the end). Acceptable for the beta; a load-id filter on a data helper would be a Stage 2 optimisation.
- `approvalsView` is run on every dashboard call, so the dashboard also triggers the `settlePending` loop in approvals (write-mode `off`/`qty` effects as for approvals). Task 1/2 behaviour, but worth knowing.

## Concerns
- Row order deviation (item 4) needs a controller ruling.
- Dashboard cost (above).
