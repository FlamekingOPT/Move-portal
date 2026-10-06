# Task 5 report: Verify Load UI

**Status:** DONE. Commit `ecca3d9` on `feat/v3-verification` (not pushed).
**Tests:** `node --test "move_portal/test/*.test.js"` gives 188/188 pass with clean output. That is 184 plus 4 new UI tests.

## What changed (`move_portal/move_ui.js`)

### Truck screen
- **Scan mode toggle:** a `➕ Load / ➖ Take off` row above the scan box.
  - Take off puts the `takeoff` class (amber outline and fill) on the scan box and changes the placeholder.
  - The mode falls back to Load after 120000 ms; every scan restarts that timer.
  - Opening a different truck resets the mode to Load.
- **The scan carries its own mode:** `wireScan` now takes an optional `tag()`. Each queued scan keeps the mode that was active when it was scanned, so toggling while the queue drains doesn't change scans already waiting.
- **Take-off results:**
  - `taken_off` is amber: "Taken off: PLTx → back to Riverside". It has its own descending tone (`tone('off')`).
  - `not_on_truck` is red: "Not on this truck".
  - The `over` / `addon` texts no longer say "manager OK at departure". They now say Verify will ask for the fix.
- **Stage cards** (`stageHtml`) replace the old footer:
  - **loading:** Verify load (`tverify`) and Undo.
  - **needs_fix:** an amber card with checked at/by, each diff's `text`, and suggestions with "Add to this truck" (`taddif`, which calls `truck_add_if`). Buttons: Verify again and ← Other trucks. The scan box stays.
  - **ready:** a green "Ready to ship" card with the departure form (trailer list + Other, seal, carrier) → Review departure → Confirm departure.
  - **departing / departed:** as before.
- **Mismatch at departure:** when `depart_preview` or `depart_confirm` returns `needsFix`, `needsFixAgain` repaints the truck and shows a red flash listing every diff text. The headline depends on the diffs:
  - "IF changed in NetSuite: needs a fix again" when there is an `if_gone`, or an `if_short`/`if_over` whose `ifQty` differs from the expected qty the screen last showed for that IF+item.
  - "The load changed: verify again" otherwise.
- **Removed:** the waiting-for-manager pill and all pending, cancel and skip-write code.

### Trucks list badges
Loading, ⚠ Needs IF fix, ✅ Ready to ship and Departing… (added to the `PILL` map).

### Recheck and alert (floor page only)
- `trucks_recheck` runs every 30 s. It skips while `document.hidden`; `visibilitychange` stops the interval when the page is hidden and restarts it (with an immediate check) when the page is shown.
- Trucks in `nowReady` that aren't yet in the localStorage set `mv_alerted` (capped at 300 ids) get a fixed green banner: "✅ <label> now matches its IF: ready to ship", with **Open** (`opentruck`) and **✕** (`bannerx`). Each also plays a double ok tone.
- The banner survives a side switch (`shell` repaints it).
- `opentruck` dismisses that banner and switches to Outbound → Load out if needed.
- If the open truck or the truck list is on screen, it refreshes.

### Manager Approvals
The top section is "Needs IF fix", with one amber card per `needsFix` entry. Each card shows:
- the diff texts;
  - **Drop** for `if_empty`/`if_gone` (`truck_drop_if`, with `confirm`);
  - a per-diff **Correct** for `if_short`/`if_over`/`no_if` with a TO (`truck_correct` with `keys`);
- the recorded corrections that are still open (op, approver name, time);
- orphans;
- `correctError`;
- a stalled-correction note;
- suggestions with Add (`apaddif`);
- the write-mode note;
- buttons: **Correct the IF** (all lines, `confirm` text from `writeMode`), **Re-check** (`truck_verify`) and **Open truck**.

Write-mode texts (used for both the confirm and the card note):
- `off`: "Plan only: fix in NetSuite"
- `qty`: "Changes IF quantities in NetSuite (add-on IFs: office creates them)"
- `on`: "Changes IF quantities and creates add-on IFs in NetSuite"

The `truck_correct` result shows:
- the written / plan-only counts;
- the verify result with its diffs;
- each `skipped[].reason`.

**Retries:** the card adds **Release to Needs IF fix** (`depart_release`, with `confirm`), shown only when `canRelease`.

Every server string goes through `esc`. There is no closing script tag. The cross-check test covers every new `data-act`; the add buttons use literal `data-act` strings, so both `taddif` and `apaddif` are checked.

## Smoke test
Run on my own instance: port 8799, temp store, prod-2026-10-05 snapshot. Afterwards I stopped only that PID and deleted the store. Jack's :8765 was untouched.

1. Both `/` and `/?floor=1` parse.
2. **Floor at 375px:**
   - Start IF72287 → scan 2 pallets → Verify → Ready card.
   - Take off: PLT103 gives "Not on this truck"; PLT102 gives "Taken off → back to Riverside", and the truck goes back to Loading.
   - Verify → Needs IF fix card with the diff and 4 suggestions.
   - Scan PLT102 back in Load mode → recheck → green banner. `mv_alerted` is set.
   - Switch to Inbound → banner Open → the truck is Ready.
   - Review → Confirm → "Truck 1 left".
3. **Manager:**
   - The needs-fix card renders.
   - Correct all (off mode) → confirm said "Plan only: fix in NetSuite", and the result said "1 plan only".
   - Add IF72289 → `if_empty` → Drop (confirm) → Re-check.
   - A hand-made stalled departure showed Retry plus Release; Release → "Released … needs an IF fix".
4. No console errors, no server errors. `scrollWidth` was 375 at 375px on both pages.

Found and fixed during the smoke test: `corrections[].by` is a `{id, name}` object (`c.user`), so the card now shows `by.name`.

## Concerns
- The "IF changed" wording is a client-side guess: it compares diff `ifQty` with the qty the screen showed before. A truck opened from an old view could word it wrong. The diff texts are always shown, so this costs at most the headline.
- I could not reproduce the departure `needsFix` path in the browser, because it needs a NetSuite IF change between Ready and Confirm. It is covered only by the code path and the string tests.
- The spec's "who verified, and when" on the Approvals card is not shown, because `approvals.needsFix[].truck` doesn't carry `verify.at/by`. The floor card does show it. Adding it would be a one-line server change if wanted.
- The ✕ remove-pallet button on the pallet list is still there in all open stages. It is server-guarded; on a Ready truck it sends the truck back to Loading.

## Follow-up 1: approvals show who verified and when (commit `4b1d08f`)
- Each `approvals.needsFix` entry now has `verifiedBy` and `verifiedAt`, taken from `data.verify.by`/`at`. When `by` is an object, it gives the name. The card shows "· checked <at> by <by>".
- New portal test. The suite was 189/189 after this commit.

## Follow-up 2: review fixes (commit below)
1. **Ready alert on every device (Important).**
   - `trucks_recheck` now also returns `ready: [{id, label, at}]` for every open `ready` truck, built from the `allTrucks()` list it already loaded plus the trucks this recheck turned ready (fresh `verify.at`). There are no extra reads.
   - The client alerts on each `id|at` key not yet in `mv_alerted`, so every device alerts once per ready event, including needs_fix → ready again.
   - If the open truck shows `needs_fix` but appears in `ready`, it refreshes.
   - Tests: 2 portal tests (a second recheck still lists the truck; a truck that isn't ready isn't listed) and 1 UI string test.
2. **Correct-all confirm:** when the card has `if_gone`/`if_empty` diffs, the confirm adds ", and takes N IF(s) off the truck (portal only)". The button also shows when the only diffs are drops.
3. **Banner:** now `position:fixed; bottom:0`, so it no longer covers the top bar.
4. **Release confirm:** now says "No stamp is recorded for this truck".

**Smoke test** (:8799 with a temp store; only that PID stopped):
- A truck was turned ready through the API recheck.
- A floor page with an empty `mv_alerted` (as if it never saw `nowReady`) showed the bottom banner. The key stored was `103|<at>`.
- After dismissing, the next recheck didn't repeat it. `scrollWidth` was 375.
- `document.hidden` had to be stubbed because the Browser pane was hidden. Its guard correctly skipped the poll while hidden.

**Suite:** 192/192, clean output.

## Follow-up 3: polish (commit below)
- **No self-alert.** `markSeen(r.view)` runs after `tverify`, `taddif` and `dpreview`. When the view is `ready`, it adds `truck.id|verify.at` to `mv_alerted`. Smoke test: the device that verified got no banner; a cleared device still did.
- **Banner padding.** While the banner shows, `main` gets `paddingBottom` = banner height + 16px (102px in the smoke test). It is cleared on dismiss.
- 1 new UI test. Suite 193/193, clean output. Smoke test ran on :8799 only, and only that PID was stopped.

## Follow-up 4: repaint when a departure is refused (commit below)
- When `depart_preview` or `depart_confirm` returns an error, `departRefused(r)` refetches `truck_get` and repaints with `first=true`.
  - The error shows in `scanres`, above the repainted stage card.
  - If the truck is now `loading` or `needs_fix`, an amber "The truck changed on another device: verify again" is added.
  - When the truck is still Ready, the form keeps what was typed.
  - The old inline confirm-error code now uses the same helper.
- Smoke test (:8799 only; only that PID stopped):
  - A Ready screen, then a take-off from another device, then Review departure.
  - Result: the header shows Loading, "Verify the load first" plus the amber note appear, and the stage card is Verify load. The stale form is gone.
- 1 new UI test. The suite is green.
