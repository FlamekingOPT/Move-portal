# Move Portal v3: Manager Dashboard, Flagged Pallets, Labels Order (amendment)

**Date:** 2026-10-06 (afternoon) · **Status:** decisions confirmed by Jack in brainstorm after his own floor/manager walk of the rework beta. Spec awaiting review.
**Amends:** `2026-10-06-move-portal-floor-manager-rework-design.md`. It adds a manager decision for never-loaded pallets scanned at Tippecanoe, rebuilds the Dashboard around trucks and approvals, adds a truck history to the Report, and reorders the manager tabs and the Labels sections. Floor screens, Verify, Correct the IF, ship confirmation and receipts otherwise stay.
**Mockup:** `docs/mockups/2026-10-06 move portal manager dashboard + flagged pallets mockup.html` (static, four screens).
**Built on:** branch `feat/v3-verification` (239 tests).

## 1. Decisions (Jack, 2026-10-06)

| # | Decision |
|---|---|
| D1 | **Never-loaded pallets get a manager decision: Accept or Reject.** A pallet scanned at Tippecanoe that was never loaded on the truck (today's `never_loaded` flag) is no longer "the office will sort these out". |
| D2 | **Decide in either place.** The pallet appears at once on a **Flagged pallets** card in Approvals with Accept / Reject, and again on the truck's **receipt card** until decided. Approve receipt is blocked while any flagged pallet on that truck is undecided. |
| D3 | **Accept follows the Correct-the-IF rules and write modes.** SKU on one of the truck's IFs: that IF line goes up by the pallet's pieces (`if_qty`). SKU on none of the truck's IFs but covered by an open Riverside→Tippecanoe TO: an add-on IF (`if_create`), which `on` mode creates and `qty` mode leaves to the office ("Accepted · office creates IF…"); the receipt waits until the IF exists. No open TO covers the SKU: Accept is refused ("Reject, or the office adds a TO line"). The portal never creates TOs. |
| D4 | **Dashboard measures trucks, not pallets, and shows no finish date.** One manager-confirmed truck = one truckload, matching the Move Tracker (one shipped IF = one truck). Truckloads-to-move and the projected finish live only in the Move Tracker. |
| D5 | **Dashboard is the first tab and the manager's landing page.** Tab order: Dashboard · Approvals · Labels · Report. |
| D6 | **Dashboard shows what is waiting for approval**, one row per queue, only queues with something in them, each row a link into Approvals. |
| D7 | **Dashboard shows Active loads as the Move Tracker does:** one row per IF, status as a column, with search, a status filter and sort. |
| D8 | **Report keeps the day table and NetSuite checks and adds the full truck history**, every truck ever, with the same search and sort. |
| D9 | **Labels order:** Print a SKU · Label requests · Print plan · Reprint · SKU configs. |
| D10 | **No "pallets on the dock" count anywhere on the Dashboard.** Pallets are labeled in bulk or at load time, so labeled-not-shipped is not a progress number. |

## 2. Flagged pallets

### 2.1 What is flagged (unchanged)
`classifyUnloadScan` returns `never_loaded` for a pallet that is `labeled`, or `loaded` on another truck that is still open (not `ship_pending` / `departing`). The scan records `data.flag = 'never_loaded'`, `flaggedAt/By/Truck` on the pallet and adds the pallet id to the truck's `data.flagged`. Nothing is received. Damaged pallets are a different flag and are not changed by this spec.

### 2.2 Floor (unload)
- The unload screen's flagged list reads **"waiting for the manager"** instead of "the office will sort these out", and lists each pallet with its decision once made: "✅ accepted", "↩ rejected: <note>", or "⏳ accepted, office creates the IF".
- **Unloading done** is allowed with flagged pallets pending (as today).
- No floor action on flagged pallets. A rejected pallet is physically set aside; the note tells the floor why.

### 2.3 Approvals: Flagged pallets card
- New section between **Trucks waiting for an IF fix** and **Retry / Release**: one card listing every undecided never-loaded pallet across all trucks. Row: pallet code, SKU, config, pieces, the truck it was scanned on (label + pill), who scanned it and when, whether the truck is still unloading.
- Buttons per row: **Accept onto this truck** · **Reject**.
- A decided pallet leaves this card. The card is hidden when empty.

### 2.4 Approvals: receipt card
- New block **Flagged pallets · N to decide** under Other items: the same rows and buttons for this truck's undecided pallets, then a line per decided one with its outcome.
- **Approve receipt** is disabled with the reason "decide N flagged pallet(s) first" while any pallet on the truck is undecided or is accepted-but-awaiting its IF.
- Outcome wording (also returned by the API): `✅ Accepted · IF72289 1,044 → 1,080` · `⏳ Accepted · office creates IF for 72 on TO11710 · receipt waits` · `⛔ Can't accept · no open TO covers YSN201 · Reject or office adds a TO line` · `↩ Rejected · "<note>" · back to labeled`.

### 2.5 Rules
- **Accept, SKU on a truck IF:** pick the truck's IF that carries the SKU (the first by IF number if several). Run `if_qty` from the IF's current qty to current + pallet pieces, through the same `runOps` / write-mode gate / claim as Correct the IF, recorded in `data.correctionWrites`. On success: the pallet becomes `received` on this truck (`loadId` = truck, `receivedAt/By`), the truck's `alloc` entry for that IF gains the pieces on that item, the flag is cleared (`data.flag = ''`, `decision = {kind:'accepted', ifId, by, at}`), and the pallet is removed from the truck's `data.flagged`.
- **Accept, SKU on no truck IF, open TO covers it:** build an `if_create` add-on for that TO with the pallet's item and pieces, with a memo token as Correct does (`createToken`). `on` mode writes it: the new IF is appended to the truck's `data.ifs` (status B) and `alloc` (`addOn: true`), then stamped with the truck's trailer/seal/memo so it matches the other IFs, and the pallet is received as above. `qty` / `off` mode: the op is plan-only; the pallet's decision is `{kind:'accepted_pending', toId, item, pcs}`, the pallet stays `labeled` with the flag kept, and the receipt card shows "⏳ … receipt waits". **Re-check** on the receipt card (and every Approvals load) looks the IF up by its memo token in `ns.plannedIfs()`; when found, the pending decision completes exactly as the `on`-mode path does.
- **Accept, no open TO covers the SKU:** refused with the ⛔ text; nothing changes; the pallet stays undecided.
- **Accept when the pallet is `loaded` on another open truck:** it is taken off that truck first (same as the floor's Take off: pallet leaves that truck's `stack`, that truck's `ready` reverts to `loading` as any pallet change does), then accepted here.
- **Reject:** note required. Pallet → `labeled`, `loadId` cleared, `data.flag = ''`, `decision = {kind:'rejected', note, by, at}`, removed from the truck's `data.flagged`. Nothing is written to NetSuite.
- **Undo:** none for a decision. A wrongly accepted pallet is corrected by the office in NetSuite; a wrongly rejected one is simply scanned again at unload (it flags again).
- The receipt plan (`planReceipts`) needs no change: an accepted pallet is a received pallet on the truck whose `alloc` already covers it.
- An accepted pallet counts for the Dashboard as received, never as "shipped" on a new day; truck counts are unchanged by acceptance.

### 2.6 Prod check before `qty` (ON-MODE GATE list)
- `setIfItemQty` on an IF that is already **Shipped (C)**: NetSuite must allow the quantity edit on a shipped IF with no receipt against that line. If it refuses, Accept on an IF already shipped must fall back to plan-only ("office edits IF") in `qty` mode. Test on one shipped test IF before the Suitelet beta goes to `qty`.

## 3. Dashboard

### 3.1 Layout (top to bottom)
1. **Waiting for approval** card (amber border when non-empty). Rows in Approvals order, only non-zero: Ship confirmations · Correct the IF · Trucks waiting for an IF fix · Flagged pallets · Retry / Release · Receipts. Each row: queue name, the first item's one-line description, count pill (amber with "over 30 min" when a ship confirmation is older than 30 minutes). Tapping a row opens Approvals scrolled to that section. When every queue is empty the card reads "Nothing waiting for approval".
2. **Tiles:** Trucks shipped today (sub: "manager-confirmed · plan 8/day") · Trucks per day, 7-day avg (sub: all-time avg) · Trucks shipped, total (sub: since start · N received) · In transit (trucks; sub: pallets · missing) · Finish date → "see Move Tracker".
3. **Active loads** (§3.2).
4. Two columns: **Trucks shipped per day** bar chart (per move day, plan line at the setting `trucksPerDay`, default 8) · **Exceptions** (Missing pallets in transit · Flagged, waiting on manager · Damaged · Edited at dock · Labeled, never loaded (stale) · SKUs with stock but no config).

Removed: the pallet tiles (total to move, moved, remaining, days left, needed per day, moved today, projected finish), Recent trucks, Remaining by SKU.

### 3.2 Active loads
- One row per IF on every truck that is not `received` (and not dropped): **Fulfillment · TO · Truck · SKUs on truck · Pallets · pcs · Received · Status · Last step**. Truck = "Trailer 537224" or "Truck 1 · 10/06 · Trailer 211659 · seal …" once shipped. A truck with two IFs shows two rows that share the Truck cell. Pallets · pcs: before shipping, the loaded pallets whose SKU the IF carries (the same split Verify uses; an SKU on two IFs of one truck fills the lower IF number first); after shipping, the pallets in that IF's  entry; Received shows received pcs once unloading starts, with "+N flagged" when the truck has undecided pallets.
- **Last step:** the most recent event on the truck and who did it (started, scanned, verified, corrected, marked shipped, confirmed, unloaded, sent to manager) with age; red when a `ship_pending` truck is over 30 minutes old.
- **Toolbar:** search (IF, TO, trailer, seal, Truck #, SKU; substring, case-insensitive) · status select (All · Loading · Needs IF fix · Ready to ship · Waiting for manager · In transit · Unloading · Receipt pending) · sort select (furthest along [default] · newest step · oldest step · IF · trailer) · "N of M" counter. Column headers Fulfillment, TO, Truck, Pallets, Status and Last step also sort; a second click reverses.
- Filtering and sorting are client-side on the rows the `dashboard` action returns. Tapping a row opens the manager's read-only truck view (today's `opentruck`).
- Received trucks drop off the Dashboard at the end of their receipt day; the Report keeps them.

### 3.3 Counting
- **Trucks shipped on day D** = trucks whose `depart.day` is D (set at manager confirm). Truck # of the day already follows this.
- **7-day avg** = trucks shipped over the last seven completed move days ÷ 7, zero days included; today joins after 3 pm once a truck shipped (today's `todayDone` rule). All-time avg over completed move days since `start`.
- **In transit** = trucks in `departing` / `departed` (pallets in transit, missing from counts).
- The `trackerMetrics` pallet maths and `stockModel` are no longer called by the dashboard. The print plan keeps using on hand.

## 4. Report
- Unchanged: write mode line, day table (Day · Trucks · Pallets · Pcs · Diffs), the ⏳/✅/❌ NetSuite check rows, plan-only pending corrections.
- New **Truck history** table below: every v3 truck ever, newest first. Columns: Day · Truck · Trailer · seal · IFs · Pallets · pcs · Status · Started (who, time) · Shipped (floor, time) · Confirmed (manager, time) · Received (time) · Corrections (one line each: `⬇ IF72287 1,152→1,044 · Manager`, `+ PLT131 accepted`, `↩ PLT104 rejected`). Dropped trucks show status "Dropped". Same toolbar as Active loads (search · status · sort) with default sort newest first.
- The history scrolls sideways on a phone; no columns are dropped.

## 5. Labels
Section order: **Print a SKU** · Label requests · Print plan · Reprint · SKU configs. Nothing else changes.

## 6. Data / server
- **Pallet fields:** `data.decision = {kind: 'accepted' | 'accepted_pending' | 'rejected', ifId?, toId?, item?, pcs?, note?, by, at}`; `data.flag` cleared on accept/reject. `stillFlagged()` keeps returning only undecided never-loaded pallets, so today's unload view, exceptions and `data.flagged` cleanup stay correct; a new `pendingAccepts(x)` returns the truck's `accepted_pending` pallets.
- **Truck fields:** `data.corrections` gains entries `{kind:'pallet_accept'|'pallet_reject', palletId, code, pcs, ifNum?, note?, by, at}` for the Report; `data.lastStep = {kind, by, at}` is written by every action that changes a truck (start, scan, take off, verify, correct, add/drop IF, mark shipped, confirm, send back, unload scan, unload done, receipt approve) for the Dashboard's Last step column.
- **Actions (manager):** `pallet_accept {truckId, palletId}` and `pallet_reject {truckId, palletId, note}`, both behind the truck claim (`correct` phase) like Correct the IF, returning `{outcome, text, view}`. `approvals` returns `flagged: [...]` (all undecided, with truck labels) and each receipt entry gains `flagged`, `pending` and `canApprove` with `blockReason`. `receipt_approve` refuses with the block reason when undecided or pending pallets remain (server-side gate, not only the disabled button). `dashboard` returns `waiting` (per-queue counts and first-item text), truck tiles, `rows` for Active loads, `days` as truck counts, `exc`. `report` returns `history`. Settings gain `trucksPerDay` (default 8).
- **Local beta:** the snapshot stand-in's `applyOp` also applies `if_create` (adds the IF's lines to `ifLines` with status B, memo token kept so the token lookup finds it) so `on` mode can be walked locally; `qty` mode is unchanged. Node-only.
- **UI:** manager `TABS` reordered and default tab `dash`; new `SCREENS.dash` and the history block in `SCREENS.report`; `fixCard`-style rows for flagged pallets reused on both cards; Labels `main()` order changed.

## 7. Out of scope
- Damaged-pallet decisions (received short / write-off): separate amendment if needed.
- Truckloads to move, finish date, units per truckload: Move Tracker only.
- Undo of an accept/reject; mixed-SKU flagged pallets (a mixed pallet is accepted line by line through the same rules, or rejected whole, but gets no special UI).
- The floor's stale "ready to ship" banner, "1 pallets" pluralization, and the active "Unloading done" button after sending are fixed under the standing hardening approval, not here.

## 8. Tests (node, in-memory fakes)
- Accept on-IF SKU in `qty` and `on`: IF qty op recorded, pallet received, alloc grown, flag cleared, receipt plan includes it, `data.flagged` shrinks.
- Accept off-IF SKU with an open TO: `on` creates the add-on IF, stamps it, receives the pallet; `qty` records `accepted_pending`, receipt blocked, Re-check completes it once the IF exists under its token.
- Accept with no covering TO refused; pallet unchanged. Accept of a pallet loaded on another open truck removes it there first and reverts that truck's `ready`.
- Reject requires a note, sets `labeled`, records the decision; scanning it again at unload flags it again.
- `receipt_approve` refused while undecided or pending; allowed after.
- Approvals `flagged` list and receipt `canApprove` / `blockReason`; the Flagged card hides when empty.
- Dashboard: `waiting` has only non-zero queues and the right first-item text; trucks-per-day from `depart.day`; 7-day and all-time averages with zero days; Active loads rows (one per IF, two-IF truck, received + flagged column, Last step, sort keys); received trucks excluded after their day.
- Report `history`: every truck incl. dropped, corrections lines, newest first.
- Labels section order and manager tab order/default.
- Then a browser walk on the beta: flag a pallet at unload, accept one on the Flagged card and reject one on the receipt card, approve, check the Dashboard rows and the Report history.
