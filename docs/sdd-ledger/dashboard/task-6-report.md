# Task 6 report: UI Dashboard screen and Report truck history

Status: DONE. Commit a0db231 on feat/v3-verification (not pushed).

## What
- `SCREENS.dash` replaced per the brief: Waiting for approval card (links via `goapprove` to the Task 5 anchors), five tiles, Active loads (one row per IF), Trucks shipped per day chart, Exceptions card.
- Shared helpers `tableTools / wireTools / rowText / filterRows / sortRows`, `loadsTable / paintLoads`, `ACT.dashsort`, `ACT.dashrow` (delegates to `ACT.opentruck`).
- Report: `S.report = r`, new Truck history card (`histTable / paintHist`), `paintHist()` called after `main(...)`.
- `barChart`: label ' plan', aria-label "Trucks shipped per day".
- CSS: `.tools`, `.tools .inp`, `.tools select.inp`, `th.sortable` added; `p-gray` already existed (not duplicated).
- Decision 1 applied: Dashboard primes the late badge (`setLate(ship && ship.late ? ship.count : 0)`).
- Decision 2: the "N trucks" pill counts distinct `truckId`s (`new Set(...)`), never sums the repeated `flagged`.
- Decision 5: `Date.parse('10/6/2026 11:24:05 am')` verified in node (V8 parses it); the `|| 0` fallback stays.

## TDD
- RED: `node --test move_portal/test/ui.test.js` failed with `missing Waiting for approval`.
- GREEN: same file passes after implementation; full suite `node --test "move_portal/test/*.test.js"` is 274/274 (273 + the new test), pristine output.

## Files
- `move_portal/move_ui.js` (CRLF preserved), `move_portal/test/ui.test.js`.

## Self-review
- Tag balance counted over the new fragments: div 16/16, table 1/1, tr 3/3, select 2/2, span 11/11, h4 4/4, th 1/1, td 9/9, b 3/3, a 1/1 (input is void).
- Every server value interpolated into HTML goes through `esc(...)` (or `num(...)`/`statusPill`, which escape); the stage `<option>` labels are constants.
- No old Dashboard code remains (bySku, m.projectedFinish, Recent trucks all gone, asserted by the test).

## Concerns
- `x.flagged` renders as `+N flagged` on every IF row of a multi-IF truck (repeated payload value); matches the brief, only the pill is de-duplicated.
- The status filter on Report history uses `x.stage`; the `stage` sort key on history rows relies on the server sending `stage` (it does per Task 4).
- `ACT.dashrow` on a row in the Report history relies on the manager modal `truck_get`; not browser-walked (string-assertion tests only).

## Fix wave 1
- Search input no longer rebuilt per keystroke: the toolbar renders once into `#dashtools` (Dashboard) and `#histtools` (Report) and is wired once; `paintLoads` / `paintHist` repaint only the table and the "n of m" counter (`#dln` / `#hsn`, via new `setCount`). `tableTools(prefix, st, sorts, counterId)`. `ACT.dashsort` syncs the Sort select (`#dlsort`) since the toolbar is no longer repainted.
- Sort fallbacks: new `stamp()` returns null for unparseable/missing times; `oldest` and `newest` put undated rows last (`Number.MAX_SAFE_INTEGER`). `newest` falls back `lastAt || receivedAt || confirmedAt || markedAt || startedAt`. Report history uses `HISTSORTS` (no "oldest step").
- Regression test added in `ui.test.js` (paintLoads/paintHist bodies do not call `tableTools(`; `id="dashtools"` / `id="histtools"` once each; HISTSORTS and fallback chain present). Confirmed failing against the old `move_ui.js`.
- Tests: `node --test "move_portal/test/*.test.js"` 275/275 pass, pristine. `move_ui.js` CRLF preserved (diff stat 28 lines).
- Commit: 20aa1c3 (a ledger-only follow-up is not committed).
