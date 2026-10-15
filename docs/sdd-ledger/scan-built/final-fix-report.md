# Final fix wave: report

**Status:** DONE. Commit `1849838` on `feat/v3-verification` (not pushed). Suite 343/343 (baseline 333 + 10 new).

## What was implemented
1. **Approve result** (`sl_move_portal.js` finishDepart): returns `written` / `planOnly` from runOps (every truck, retries too), plus `toNum` / `ifNum` when a scan truck's TO + IF exist. truckView's `truck` carries `toNum` / `ifNum` on a scan truck. `move_ui.js` apconfirm: for a scan truck (`r.view.scan`) it shows "✅ <label> shipped · TO… + IF… written to NetSuite" (on) or "✅ <label> shipped in the portal · Plan saved (writeMode <m>: nothing written to NetSuite)" (off/qty), with no BOL line. Office trucks keep the BOL line. The floor departed card for a scan truck shows "TO… + IF…" when present, with no BOL line.
2. **Office TO room**: `move_verify.reservationsFromTrucks` skips trucks with `data.kind === 'scan'`. In sl, the new `scanTos(trucks)` collects every `writes['to_create:*']` id on any truck, and `reservedToLines` filters those TOs out of the open TO lines before `verify.reserveToLines`.
3. **Label stock**: `labeledPiecesByItem(statuses)` in move_data.js and fake_data.js, defaulting to `[LABELED]` so the print plan is unchanged. `labels_preview` passes `[LABELED, LOADED]`.
4. **Release guard**: `tx.findIf(token, toId)` in move_tx.js (createIf now reuses it), and in fake_tx (`_t.ifTags`, key `token|toId`). `depart_release` refuses with "This truck is already in NetSuite (IF found). Press Retry to finish the departure." when a TO id is known (recorded, or found by tag) and a tagged Shipped IF is on it. This check runs before the closed-TO check.
5. **Reject after a half Accept**: `halfAccepted(x, palletId)` runs before the claim and again on the claimed copy (on a throw there, the claim is dropped). It refuses when `to_create:<id>-P<pid>` exists without `if_create:new:to:<id>-P<pid>`, unless `tx.toClosed` is true. The message is "TO<n> was created for this pallet. Accept again to finish it, or close TO<n> in NetSuite first."
6. **Approvals resilience**: the shipPending `scanRows` call is wrapped in try/catch (log.error). On failure the row keeps `lines: []` and `lbs: null` and gets `error: 'Could not read this truck: …'`. `scan` now comes from `isScan(x)` (it used to be `!!sr`). The UI ship card shows the error line.
7. **Beta default**: the `preview_server.js` first-store seed adds `officeIfs: false`. fake_data keeps `officeIfs: true`.

## TDD evidence
RED: `node --test "move_portal/test/*.test.js"` → `tests 343, pass 333, fail 10`. Each new test failed for the expected reason:
- final1: `actual [true, undefined, undefined, undefined]`, expected `[true, 'TO901', 'IF902', []]`
- final2a: `'no_to'` vs `'addon'`, because the loaded scan truck reserved all of TO700
- final2b: `'addon'` vs `'no_to'`, because the scan TO was offered as room
- final3: `'ok'` vs `'warn'`
- final4: `Cannot set properties of undefined (setting '[MV-102]|901')`, because `ifTags` did not exist yet
- final5: the reject did not throw
- final6: `Error: item read failed` bubbled out of approvals
- final7: the seed lacked `officeIfs: false`
- move_tx `findIf`: `s.tx.findIf is not a function`
- ui: missing 'Plan saved (writeMode '

GREEN: same command → `tests 343, pass 343, fail 0`. This was run after the commit too.

## Files changed
`move_portal/sl_move_portal.js`, `move_verify.js`, `move_tx.js`, `move_data.js`, `move_ui.js`, `test/fake_tx.js`, `test/fake_data.js`, `test/preview_server.js`, `test/portal.test.js` (8 tests, "final1"–"final7"), `test/move_tx.test.js` (findIf), `test/ui.test.js` (message strings).

## Self-review
- Line endings were preserved per file: some files are CRLF, others LF.
- In final5, a flagged never-loaded pallet keeps status `labeled`, so the test asserts on the truck's `flagged` list instead.
- The ui test is a source-string check, as the brief asked. The rendering is not exercised behaviourally.

## Concerns
- `scanTos` only sees TOs recorded in some truck's `writes`. A released truck's writes are cleared, but Release requires that TO to be closed, so it is no longer open room.
- A scan TO that saved but was never recorded is invisible to `scanTos` until Retry records it. That window was accepted.
