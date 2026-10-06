# Task 5 report: UI tab order, Labels order, Flagged pallets, floor wording

## What
- Manager tabs now Dashboard / Approvals / Labels / Report, default `dash`; Labels sections start with Print a SKU.
- Floor unload: flagged flash reads "waiting for the manager" and points to Approvals; `v.decided` lines render under it; never_loaded result says "Flagged for the manager".
- Approvals: `flagRow` / `flaggedCard`, "Flagged pallets" section (`ap_flag`) between Trucks and Stalled departures; anchors `ap_ship ap_fix ap_trucks ap_flag ap_retry ap_rec`.
- Receipt cards: flagged rows (with Accept/Reject), pending and decided lines, Approve button replaced by a disabled button showing `blockReason` when `canApprove === false` (existing aprecv attributes untouched).
- Handlers `ACT.apaccept` (confirm, `pallet_accept`), `ACT.apreject` (prompt, required note, `pallet_reject`), `ACT.goapprove` + `S.scrollTo` (scrolls after paintApprove; unused until Task 6).
- CSS `.pill.p-violet` (no prior `p-violet`).

## TDD
- RED: updated `mgr: 'dash'` assertion plus the two new tests failed before the change (e.g. "missing Flagged pallets").
- GREEN: `ui.test.js` 26/26; full suite `node --test "move_portal/test/*.test.js"` 273/273, no warnings.

## Files
- `move_portal/move_ui.js`, `move_portal/test/ui.test.js`. Commit message per brief, with the Fable 5.1 trailer.

## Self-review
- Tag balance of new fragments checked by counting: flagRow div 2/2, span 3/3, button 2/2; flaggedCard div 3/3; receipt flagged block div 4/4, b 2/2.
- Receipt-without-perIf branch (error card) left unchanged: it has no flagged rows or canApprove gate, as in the brief.
- The test `manager rework: 4 tabs` still passes (checks strings only).

## Concerns
- `flagRow` is also rendered inside receipt cards where the accept/reject handlers repaint via `SCREENS.approve` (re-fetches approvals), fine.
- Not verified in a browser (string-based tests only).
