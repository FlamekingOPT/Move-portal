# Floor/Manager Rework: final-review fixes

Branch `feat/v3-verification` (not pushed). Suite: `node --test "move_portal/test/*.test.js"` → **239/239 pass**, no stray output.

| # | Commit | Change |
|---|--------|--------|
| 1 | 2266aaa | `truck_set_trailer {truckId, trailer}` (floor): open truck only (`mustOpenTruck`, re-read right before the write), trimmed, 1–20 chars, unique among TRAILER_BUSY trucks except itself (new shared `checkTrailer`, also used by `truck_start`); status unchanged. UI: "✎ trailer" button on the truck header (`window.prompt`). `ship_mark` takes an optional `trailer` used only when the truck has none (same checks), stamps it on the truck in the mark write; guarded against a trailer change between read and write. Shipments card shows a Trailer # input when the truck has no trailer. |
| 2 | c381c87 | `pallet_void` is manager-only; tests updated (floor gets "Managers only"; manager voids). The manager reprint screen's Void still works. |
| 3 | 7c8219e | `ship_mark`: seal > 30 / carrier > 60 (after trim) refused with field-named messages; UI inputs get matching `maxlength`. |
| 4 | 7779de7 | `DEFAULT_TRAILERS` constant (7 trailers) used by `truckView` and `truck_planned`. |
| 5 | 52f738f | Manager "Open truck" modal shows `errBox(r.error)` + Close when `truck_get` fails. |
| 6 | 76d20ac | `approvals.trucks[].otherDiffs` excludes `if_gone`/`if_empty` (`IF_PILL_KINDS`); otherDiffs test updated, plus a test that a truck-level reason (`no_ifs`) still shows. |
| 7 | d30d700 | Truck card: when `n.stuck` and no Correct-the-IF card for that truck, a `btn-correct` "Free the stuck correction" calls `truck_correct {truckId}` (no keys). Server test added. |

## Notes / concerns
- Item 7: `truck_correct` with no keys does more than free the claim: it then runs every correction op, which includes portal-only `drop_if` for gone/empty IFs (that is why such a truck has no Correct card). The button sets `data-drops` so the existing confirm says how many IFs come off the truck. If a pure "free only" is wanted, it needs a separate server action.
- Item 1: the `ui.test.js` "confirm in dmark" window was widened from 400 to 700 chars because the trailer check made the handler longer (intent unchanged).
- `truckView.trailers` still lists every default trailer (not filtered by busy ones); only `truck_planned` filters. Unchanged behavior.
