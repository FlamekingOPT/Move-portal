# Task 10 report: remove old load/ship/receive/catch-up flow

Status: DONE. Commit: see `git log -1` on feat/v3-verification ("refactor(v3): remove old load/ship/receive/catch-up flow; pallet statuses now v3"). Not pushed.

## Removed
- sl_move_portal.js: all 23 old acts (load_list ... catchup_reject) plus their helpers: OUT_OPEN, loadView, editablePallet, shipLoad, recvView, receiveOne, receiveLoad, countsFromPallets, pubLoad, mustLoad, loadSheetModel, and the `loadsheet` branch of pdf(). `const L = core.LOAD` gone.
- Dashboard rewritten per the brief (trucks via allTrucks/truckSummary, neverLoaded exception, in_transit+missing). `catchups7`/`arrivedUnshipped` exceptions dropped.
- move_core.js: LOAD, loadScanRule, receiveScanRule, TONE, toneFor, aggregate, shortages, nextLoadNumber, catchupNumber, txToken. PALLET is now the v3 set (== verify.VP). Spec line updated to 2026-10-01.
- move_tx.js: findByToken, locationSubsidiary, createTransferOrder, committedShortfalls, fulfillTransferOrder, receiveTransferOrder. Returns `{ apply }`. setLines kept (used by createIf/createReceipt).
- fake_tx.js: only `_t` ({seq, ops, failOn}) and `apply`.
- fake_data.js: arrivedOn and catchup removed from PKEYS/defaults/matchQ (no remaining callers).
- Also removed `catchup` from pubPallet output (nothing in the Suitelet/tests used it; move_ui.js still reads `.catchup` in 5 places, cleaned in Tasks 11-12).
- Tests: core.test.js scan-rule/tone/aggregate/numbering tests deleted, L usage removed; portal.test.js old Task 9/10 tests deleted (loading, ship, receive, catch-up). Dashboard test rewritten with a v3 truck (42 pallets departed). `L975`/`truckWith` helpers moved above the dashboard test.

## Kept (as instructed)
claimLoad, assertClaim, stale, STALE_MS, userErr, pubPallet, mustPallet, isManager, nowInfo, settings, stockModel, tracker, print/config/request/void/reprint/plan actions, all v3 actions/helpers. move_data.js untouched (field map, countPallets, palletCountsByLoad, recentLoads still exist there; unused now by the Suitelet).

## Grep checks
- `grep SHIPPED|ARRIVED_UNSHIPPED|catchup|LOAD\.` over move_portal/*.js: no hits in sl_move_portal.js or move_core.js (hits only in move_ui.js / move_data.js).
- `\bL\.`, pubLoad, mustLoad, countsFromPallets, loadSheet, findByToken, locationSubsidiary, removed core fns: no remaining references outside move_ui.js.
- tpl.loadSheetXml still exists in move_label_template.js (unused now; left alone, outside brief).

## Tests
Before: 126/126. After: 99/99 pass, 0 fail (27 old tests removed, 1 dashboard test rewritten).

## Concerns
- move_ui.js still calls the removed actions; the UI is broken until Tasks 11-12.
- move_label_template's loadSheetXml and its test are now dead code.

## Fix (review round 1)
- core.test.js: asserts `core.PALLET` deepEquals `verify.VP`.
- portal.test.js: dashboard test restored with m.moved/remaining/total/movedToday (42/62/104/42), bySku[0]=YSN100, exc.noConfig, plus a labeled pallet scanned via unload_scan -> exc.neverLoaded === 1; trucks list asserted.
- Dead code removed: tpl.loadSheetXml + test; recentLoads, palletCountsByLoad, loadsByNumber, allLoadNumbers from move_data.js, fake_data.js (and their fake_data.test assertion). Field maps untouched. Grep: no callers outside move_ui.js (which did not reference them).
- Comments: sl header Spec line updated; move_tx header paren fixed; one-line comment above apply for the v3 ops.
- `P` alias replaced by `VP` throughout sl_move_portal.js (declared at top).
- Tests: 98/98 pass (one fewer: load-sheet test removed).
