# Move Portal: Office Per-SKU Transfer Orders + Multiple IFs per Truck — Design (amendment)

**Date:** 2026-09-28 · **Amends:** `2026-09-27-move-portal-design.md` (D2, §4 load fields, §9) · **Decisions confirmed by Jack in brainstorm 2026-09-28.**

## 1. What changed and why

The old D2 was **1 truck = 1 Load = 1 TO = 1 IF**, with the TO built by the portal at approval. The new process: **the office creates one Transfer Order per SKU by hand** (Riverside → Tippecanoe), and each truck fulfills against those TOs. Everything else in the original spec (scanning, labels, pallet statuses, screens, catch-up concept, dashboard) is unchanged.

| # | Decision |
|---|---|
| B1 | **The office creates 1 TO per SKU by hand** in NetSuite, from Riverside (35) to Tippecanoe (42). The portal never edits office TOs. |
| B2 | **1 truck = 1 Load = N IFs**: one Item Fulfillment per TO the load draws from, all marked Shipped. |
| B3 | **TO matching is automatic.** For each item on the load, the portal uses open TOs (location 35 → transferlocation 42, status Pending Fulfillment or Partially Fulfilled) that contain the item, **oldest first** (by TO date, then internal id), each up to its remaining qty (ordered − fulfilled). One item can be split across several TOs. |
| B4 | **Overflow.** Anything the office TOs can't cover (no open TO for the SKU, or more on the truck than the TOs have left) is **overflow**. |
| B5 | **Overflow approval is built into Approve & Ship** (option A). The manager sees the overflow in the preview, and the button reads "Approve, create overflow TO & ship". One click. |
| B6 | **One overflow TO per load, holding only this truck's overflow** (option i). The IF made from it fulfills it completely, so no half-open overflow TOs are left. |

**Consequence the office should know:** an office TO commits Riverside stock when it's saved, so that stock is reserved for the move and can't go to customer orders. That's the office's call when it sizes each TO. The portal doesn't change it.

## 2. Approve & Ship (load `ready`)

The concurrency guard is unchanged (`ready → shipping` compare-and-set, `STALE_MS` = 10 min, working state).

1. **Aggregate** loaded pallets into `{itemId: qty}`, as before (`lines` snapshot).
2. **Resolve the plan.** One transaction search: type Transfer Order, `mainline = F`, `location = 35`, `transferlocation = 42`, status `TrnfrOrd:B` / `TrnfrOrd:D` (Pending Fulfillment / Partially Fulfilled), `item anyof <load items>`. Columns: internal id, tranid, trandate, item, quantity, quantity fulfilled, quantity committed. Use item rows only (the TO search returns 3 rows per item, per the 2026-09-25 findings: keep the item row, the one with blank `transferorderitemline`). Allocate each item oldest-first. The result is a **plan**:
   `plan: [{toId, toNum, item, qty, overflow:false}] + [{toId:null, item, qty, overflow:true}]`
3. **Preview.** `action=ship_preview` returns the plan and the stock problems, for the manager's approve screen. Example: "TO8801 YSN201 ×288 · TO8805 YSN301 ×96 · ⚠ overflow: new TO for YSN335 ×40".
4. **Stock check.**
   - Office TO rows: the TO line's **committed** qty must be ≥ its planned qty. If not, refuse with the list ("TO8801 YSN201: need 288, committed 200; NetSuite gave the stock to customer orders"). The load stays `ready`.
   - Overflow rows: Riverside **available** ≥ qty (existing check). If not, refuse.
5. **Save the plan on the load** (`plan` in `custrecord_mvl_data`) **before creating anything**. From then on, Retry uses the saved plan and never re-resolves.
6. **Re-check right before creating.** Reload each planned office TO. If it's closed, or its remaining or committed qty no longer covers the plan, refuse with "TO8801 changed since preview, review again". Clear the saved plan and go back to `ready`, but only if no IF has been created yet. If IFs exist, set `error` and keep the plan for Retry.
7. **Overflow TO** (if there are overflow rows): `createTransferOrder` with only the overflow lines, token `[mv:<loadId>:to]`, adopted if orphaned (existing logic). Store its id in `_mvl_to` and on the overflow plan rows.
8. **One IF per distinct TO in the plan**, in plan order: `fulfillTransferOrder(toId, {item: qty for that TO}, memo)`, token `[mv:<loadId>:if:<toId>]`. The existing per-IF guard applies (committed ≥ planned before saving). Store `ifId` on that TO's plan rows immediately after each save. Before each IF, a token search adopts one that already exists.
9. **Governance guard.** Before each IF (and before each pallet update batch), if `runtime.getCurrentScript().getRemainingUsage()` < 150, stop, leave the load in its working state with `partial:true`, and return "Partly done (4 of 9 fulfillments). Press Retry to finish." Retry resumes at the first plan row without an `ifId`.
10. **Finish:** pallets → `shipped`, load → `shipped` with approved_by/at. `_mvl_if` = the first IF id (for list views). The load sheet PDF lists every TO / IF pair plus the overflow TO.

## 3. Approve Receipt (load `recv_ready`)

1. Aggregate the pallets scanned in on this load (`received`, not yet posted) into `{itemId: qty}`.
2. **Split by TO using the saved plan.** For each item, assign the scanned qty to the load's plan rows in plan order, each up to its planned qty minus what earlier receipts on this load already took. Anything unassigned stays in transit on the later TOs (those pallets are `missing`).
3. **One Item Receipt per TO** that got a qty: `receiveTransferOrder(toId, lines, memo, ifId)`, token `[mv:<loadId>:rcpt<seq>:<toId>]`, adopted if it exists. Append each id to `_mvl_receipts`. The same governance guard and Retry apply.
4. **Attach to this truck's IF.** Pass `defaultValues: { itemfulfillment: ifId }` to `record.transform(TO → ITEM_RECEIPT)`. **Verify in sandbox (Task 14).** If NetSuite rejects that default, fall back to a plain TO receipt with the same quantities. On-hand is still right; only per-IF cost matching is lost, which is immaterial for the same item. Record which path worked in the ledger.
5. **Pallet posting:** `_mvp_receipt` = the receipt id(s) covering that pallet's lines, comma-joined (mixed pallets can span TOs). A pallet counts as posted when it's set.
6. Missing, late arrival and damaged flows are unchanged. A late receipt uses the same per-TO split against the remaining in-transit plan qty.

## 4. Catch-up (pallet `arrived_unshipped`)

Same resolver as §2: office TOs first, overflow TO for the rest. Then one IF (Shipped) per TO plus one receipt per TO, all in one approval, with the same tokens (under the catch-up load's id), plan, Retry and governance rules.

## 5. Data model

**No new NetSuite fields.**
- `custrecord_mvl_data` gains `plan` (the array above, with `ifId` filled in) and `partial` (bool).
- `_mvl_to`: the overflow TO only, or blank.
- `_mvl_if`: the first IF id, for display. The authoritative list is `plan`.
- `_mvl_receipts`: comma-joined, as before.
- `_mvp_receipt`: may now hold several ids, comma-joined (it's a Text field).

## 6. Code impact

- `move_tx.js`: new `findOpenTransferLines(fromLoc, toLoc, itemIds)`; new `transferLineState(toId)` (for the re-check); `receiveTransferOrder` gains an optional `ifId`.
- `move_core.js` (pure, unit-tested): new `allocatePlan(lines, openRows)` returns the plan; new `splitReceipt(plan, scanned, alreadyReceived)` returns `{toId: {item: qty}}`; token helpers for `if:<toId>` and `rcpt<seq>:<toId>`.
- `sl_move_portal.js`: new `ship_preview` action; Approve & Ship, Approve Receipt and catch-up are reworked around the plan; governance guard and partial Retry.
- `move_ui.js`: the manager approve screen shows the plan and the overflow warning; the load sheet lists multiple TO/IF numbers; there's a "Partly done, Retry" state.
- `test/fake_tx.js`: multiple open TOs with fulfilled and committed qty; per-IF receipts.

## 7. Testing (node, against fakes)

- Allocation: single TO covers everything; oldest-first split across two TOs; no TO gives full overflow; partial cover plus overflow; mixed pallet spanning TOs.
- Stock: an under-committed office TO refuses; overflow short on available refuses.
- Re-check: a TO closed between preview and approve refuses; a TO shrunk after one IF was made goes to `error` and keeps the plan.
- Idempotency: Retry after the overflow TO was made; Retry after k of n IFs; orphaned IF adopted by token.
- Governance: forced low remaining usage stops cleanly with `partial`, and Retry finishes.
- Receipt: scanned < planned (split in plan order, rest missing); late second receipt; mixed pallet gets multiple receipt ids; `itemfulfillment` default passed.
- Catch-up through the resolver, both with and without an office TO.

## 8. Sandbox checks added to Task 14

- `defaultValues.itemfulfillment` on TO → Item Receipt picks the right IF when a TO has 2+ IFs in transit.
- The open-TO search filters (`transferlocation`, status B/D, item rows only) return correct remaining qty.
- Several IFs on one office TO keep the TO Partially Fulfilled and show the right remaining qty.
- `ue_if_filled_status` on TO IFs is still harmless with several IFs per TO.
