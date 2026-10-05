# Move Portal v3: Floor and Manager Rework (amendment)

**Date:** 2026-10-06 · **Status:** decisions confirmed by Jack in brainstorm after testing the Verify Load beta. Spec awaiting review.
**Amends:** `2026-10-05-move-portal-verify-load-design.md`. It changes how a truck is named, moves departure into a Shipments tab with manager confirmation (replacing L6 "departure needs no manager"), adds other (non-inventory) items, reworks the manager screens, and rearranges navigation. Verify, Needs IF fix, Take off, recheck/alerts, Correct the IF logic, unload and receipts all stay.
**Built on:** branch `feat/v3-verification` (203 tests).

## 1. Decisions (Jack, 2026-10-06)

| # | Decision |
|---|---|
| R1 | **A truck is named by its trailer #.** The trailer is entered when the truck is started, and the truck is "Trailer 537224" on every screen until it departs (then "Truck N · MM/DD", trailer kept). One trailer can't be on two open trucks. |
| R2 | **A short pick needs a reason.** When Verify finds any `if_short`, the floor must type a free-text note (no dropdown) before the truck goes to Needs IF fix. The note shows on the manager's Correct-the-IF card and is saved on the truck. |
| R3 | **The floor opens on Load out.** **Void is removed** from the floor. |
| R4 | **Shipments tab (floor).** Ready trucks are listed there. The floor enters the seal (tag) # and taps **Mark shipped**. |
| R5 | **The manager confirms shipping (option B).** Mark shipped sends the truck to the manager as "Shipped by floor". It counts as in transit, and IFs are stamped/shipped in NetSuite, only when a manager taps **Confirm shipped**. A manager can **Send back** with a note. |
| R6 | **Extra labeled pallets: unchanged (option A).** They load only when an open TO covers the SKU; the truck can't ship until they're on an IF. |
| R7 | **Other items (option A).** Typed lines on the truck: description and count. Not in NetSuite, not on an IF, ignored by Verify. They print on the BOL/manifest, show on the ship confirmation, and are a checklist at unload. |
| R8 | **Manager tabs:** Labels · Approvals · Dashboard · Report. There's no Outbound/Inbound toggle, no Load out and no Void for managers. |
| R9 | **Labels (manager)** merges Print queue, Print a SKU, Print plan, SKU configs and Reprint into one tab. Request label is floor-only. The **Print plan shows Riverside on hand from NetSuite**. |
| R10 | **Approvals layout:** Ship confirmations first, then a standalone **Correct the IF** card per IF, then a quieter **Truck** card per waiting truck (its IFs, + Add an IF to this truck, Drop IF), then Receipts and Retry/Release. The Correct the IF button is the most prominent control; Add IF buttons are secondary. |

## 2. Truck stages (updated)

```
loading ⇄ needs_fix ⇄ ready ──Mark shipped──▶ ship_pending ──Confirm shipped (manager)──▶ departing ▶ departed ▶ receiving ▶ approving ▶ received
                                                     │
                                                     └──Send back (manager, note)──▶ loading
```

- New status **`ship_pending`**. The truck is locked: no scan, take-off, add/drop IF, other-item edits or verify. `isOpen` is false.
- **Mark shipped** (floor) works only from `ready`:
  - Seal is required; seal reuse is refused, compared by digits as today.
  - It re-verifies. A mismatch → `needs_fix` with the diffs, and nothing is marked.
  - On a match: status `ship_pending`, `data.shipReq = {seal, carrier, by, at}`. The trailer comes from the truck.
- **Confirm shipped** (manager) is today's `depart_confirm` path:
  - It claims, re-verifies inside the claim, and builds the stamp-only plan.
  - Truck # of the day is assigned at confirm. The departure day and time are the floor's Mark-shipped time.
  - On a mismatch at confirm → `needs_fix`, the claim is released and the card says why.
- **Send back** (manager, note required): `ship_pending` → `loading`, with `data.sentBack = {note, by, at}` shown on the floor's truck screen.
- `ready` reverts to `loading` on any pallet change, as today. `ship_pending` can't change.

## 3. Floor

**Tabs:**
- 📤 Outbound: **Load out** (default) · **Shipments** · Request label.
- 📥 Inbound: Unload.

**Start a truck (Load out):**
- Tick IF(s), enter the **trailer #** (pick from the known trailers or type another), then **Start truck**.
- Refused if an open truck (not yet departed) already has that trailer.

**Truck screen (Load out):**
- Unchanged: scan, Take off, the scanned-vs-expected table, Verify, the Needs IF fix card and suggestions.
- **+ Add other item:** description (required, ≤ 80 chars) and count (whole number ≥ 1).
  - Listed under the pallets, with ✕ to remove while the truck is open.
  - Stored in `data.otherItems = [{id, desc, qty, by, at}]`.
- **Short-pick note (R2):**
  - When a Verify result has any `if_short`, the floor gets a modal: "Why is it short?" with a required textarea and Save.
  - The note is sent with `truck_verify` as `shortNote`. The server rejects a Verify that produces `if_short` without one, with `needsNote: true`, and doesn't change the truck's status.
  - Saved as `data.shortNote = {text, by, at}`, kept until the truck departs.
  - The recheck poll doesn't need a note. A truck already in `needs_fix` keeps its note.
- **Ready card:** "✅ Ready to ship: go to **Shipments**", with a button that switches tabs. There's no departure form here any more.

**Shipments tab:**
- **Ready:** one card per ready truck with:
  - Trailer #, IFs, pallets/pcs and other items;
  - **Seal #** (required), carrier (default Armstrong Group);
  - **Mark shipped**.
- **Waiting for manager:** `ship_pending` trucks, read-only, with who marked them and when.
- **Sent back:** shown on the truck in Load out with the manager's note.
- **Shipped today:** confirmed trucks for today (Truck N, seal, trailer).

**Unload:** the truck screen shows other items as a checklist. Ticks are saved in `data.otherItemsIn`, and are informational only.

## 4. Manager

**No side toggle.** Tabs: **Labels · Approvals · Dashboard · Report**.

**Labels** has five sections, in this order, each a card:
1. **Label requests**: the floor's queue (today's Print queue).
2. **Print a SKU**.
3. **Print plan**: per SKU, **Riverside on hand from NetSuite** and the default config's pallets left. Suggested counts are computed from that on-hand, as today.
4. **Reprint**: today's Reprint/void-by-code tool. Voiding a label stays possible here for managers.
5. **SKU configs**.

**Approvals:**
1. **Ship confirmations**, one card per `ship_pending` truck:
   - Trailer, seal, carrier, IFs with qty, pallets/pcs, other items, and who marked it shipped and when;
   - **Confirm shipped** (primary) and **Send back** (asks for a note).
2. **Correct the IF**, one standalone card per IF with a diff (`if_short` / `if_over`):
   - "IF72287 · YSN401", the instruction text, and "Short note: … · Miguel" when present;
   - one large **Correct the IF** button;
   - a small "Re-check" link.

   `no_if` diffs get their own Correct card naming the TO ("Create an IF from TO11710 for YSN301 ×64"). Its button follows the write mode, as today.
3. **Trucks**, one quiet card per `needs_fix` truck titled "Trailer 537224":
   - its IFs (`if_gone`/`if_empty` ones flagged, with **Drop IF**);
   - **+ Add an IF to this truck** (secondary button), which opens the picker and suggestions;
   - "Open truck".
4. **Receipts** and **Retry / Release**: as today.

## 5. Data / server

| Change | Detail |
|---|---|
| `truck_start {ifIds, trailer}` | Trailer required; refused when another non-departed truck has it (`sealKey`-style normalize: trim/upper). Saved as `data.trailer`. `truckLabel` → `'Trailer ' + trailer` before departure. |
| `truck_verify {truckId, shortNote?}` | If the result has `if_short` and there's no note (and no saved `data.shortNote`), return `{needsNote: true, diffs}` without a status change. With a note: save it, then proceed. |
| `truck_other_add {truckId, desc, qty}`, `truck_other_remove {truckId, id}` | Floor, open truck only. |
| `ship_mark {truckId, seal, carrier}` | Floor, `ready` only. Re-verify, then `ship_pending` + `data.shipReq`. |
| `ship_confirm {truckId}` | Manager. Replaces the floor `depart_confirm`. It uses `shipReq` for seal/carrier, the truck's trailer, and departure time = `shipReq.at`. |
| `ship_sendback {truckId, note}` | Manager. `ship_pending` → `loading`. |
| `depart_preview` / `depart_confirm` | Removed from the floor. `ship_confirm` reuses their internals. |
| `unload_other_tick {truckId, id, on}` | Floor. |
| `approvals` | Adds `shipPending: [...]`. `needsFix` is split into `fixes` (per IF diff) and `trucks` (per truck). |
| On-hand | Snapshot / `move_ns` gain `onHand(locId) → {item: qty}`. Snapshot SQL: the same table the Move Tracker already reads, limited to the physical Riverside warehouse: `SELECT ail.item AS item, SUM(ail.quantityonhand) AS onhand FROM aggregateItemLocation ail WHERE ail.location = 35 AND ail.quantityonhand > 0 GROUP BY ail.item`. Only location 35 counts, without the SellerCloud/Amazon allocation locations the tracker adds, because labels are for pallets physically at the dock. Print plan uses it. Local snapshot refresh adds an `onHand` array. |
| BOL / manifest | Other items appear on the departure record (`data.depart.otherItems`) for the BOL REV and for unload. |

## 6. Out of scope
- A printed BOL generated by the portal (still the office's template).
- Photos of other items.
- Moving the Dashboard into the tracker (discussed; Jack kept the Dashboard).

## 7. Tests
- Trailer required and unique among open trucks; label shows "Trailer X".
- Short note: Verify with a short and no note → `needsNote`, status unchanged; with a note → `needs_fix` and the note saved; the recheck doesn't need a note.
- Other items add/remove only while open; shown in the view; ignored by Verify; carried into `depart`; unload ticks.
- `ship_mark`: only from `ready`; re-verify mismatch → `needs_fix`; seal reuse refused; then `ship_pending` locks scans, take-off, verify and add-IF.
- `ship_confirm`: manager only; claim + re-verify; departs with Truck # and the seal from `shipReq`; mismatch → `needs_fix`. `ship_sendback`: note required, → `loading`.
- Approvals: `shipPending`, `fixes` and `trucks` sections.
- Print plan uses `onHand`.
- UI: the floor default tab is Load out; there's no Void tab; there's a Shipments tab. Manager tabs are exactly Labels/Approvals/Dashboard/Report. The `api`/`act` and `data-act` cross-check stays green.
