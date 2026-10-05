# Move Portal: Verification-Only Redesign — Design

**Date:** 2026-10-05 (brainstorm 2026-10-01 → 2026-10-05) · **Status:** all decisions confirmed by Jack; spec awaiting review. No code yet.
**Supersedes:** `2026-09-27-move-portal-design.md` (D2, §8 scan rules, §9 transactions) and `2026-09-28-move-portal-bulk-to-design.md` (all of it). From the original spec, these still apply: labels and printing (§5, §6), the config import, the dashboard idea (§10) and roles (§3).
**Mockup:** `docs/mockups/2026-10-01 move portal v3 verification mockup.html` (live: https://claude.ai/artifact/5W7K931oFEMdzTKoq62fNV)

---

## 1. Goal

The office keeps running the move in NetSuite the way it does today. The portal **verifies** it: every pallet is scanned onto a truck and off a truck, and NetSuite is corrected to match what was actually scanned. It does **not** build TOs or IFs for planned trucks.

## 2. How the move works today (from prod data and BOL photos)

- The office creates the **TO** (1 per SKU), the **IF ahead of time (status Packed)**, and a VICS **BOL**.
  - BOL # = the TO # (not unique). "Additional shipper info" = the IF #. 1 BOL = 1 IF.
- The floor hand-writes "Truck #N" + date, trailer #, seal #, departure time and carrier (Armstrong Group) on the BOL.
- At Tippecanoe the office creates the **Item Receipt** and types:
  - the trailer → `custbody_rsm_container_no`
  - `SEAL: <n>` → `custbody7` (**confirmed 2026-10-05**: e.g. IR20597 has `SEAL: 5249324` with trailer 537224; import receipts use the same field for the ocean Master BOL)
- **Real data:**
  - TO11663 / YSN100: **42 pallets × 12 = 504 per truck.**
  - Only **5 trailers rotate** (537224, 416460, 105488, 522051, 211659), and **every seal is unique**. So the seal identifies the truck, not the trailer.
  - No IF carries a truck id.
  - Import-container IFs (from In-Transit California) are out of scope. They're excluded by ship-from = Riverside.

## 3. Decisions (Jack, 2026-10-01 → 2026-10-05)

| # | Decision |
|---|---|
| V1 | The **office keeps building the TO + IF (Packed) + BOL.** Each Packed IF on a move TO is a **planned truck** in the portal. |
| V2 | **Labels:** `PLT<serial>⇥SKU⇥pcs` (QR), unique serial, **no IF on the label**. The dock scan ties a pallet to an IF. Duplicate scans are caught. |
| V3 | **Loading verifies** scans against the IF lines (expected vs scanned). |
| V4 | **Seal entered at departure** assigns the **Truck # of the day** and stamps trailer + seal + time on every IF on the truck (the same 2 fields the office uses), then marks them Shipped. All NetSuite writes happen at that one confirm, never per scan. |
| V5 | **Corrections:** short → lower the IF qty. Over on the same SKU → raise the IF if its TO has qty left. Extra SKU → **add-on IF** from the oldest open office TO, on the same truck/seal. Every correction needs a **manager OK**. |
| V6 | **Extra SKU with no open office TO (or no TO qty left) → the scan is blocked.** The portal never creates TOs. |
| V7 | **BOL reprint** keeps the **original BOL #** (the planned IF's TO #), lists every IF # in "Additional shipper info", and is marked **REV 2**. The office reprints it from its own template. |
| V8 | **Unload at Tippecanoe:** scan every pallet. One receipt per IF for the scanned qty, with trailer/seal copied. Missing serials stay in transit. Pallets that were never loaded are flagged. |
| V9 | **Every receipt needs a manager OK**, whether it matches or is short. |
| V10 | **Tracker counts trucks by distinct seal** (fallback: 1 IF = 1 truck). This is a separate small tracker update. |
| V11 | **Three write modes** (§6): `off` (local beta), **`qty` (Suitelet beta: a manager-approved correction edits the Packed IF line qty, and nothing else is written)**, `on` (full). |
| V12 | **Build locally first** against a prod snapshot. Then the Suitelet beta on **prod** (sandbox skipped) with a no-login floor URL. Then `on`, only on Jack's go. |

## 4. Architecture

```
                 ┌──────── sl_move_portal (routing, roles, actions) ────────┐
 floor / office →│ Print labels · Load out · Receive · Approvals · Report  │
                 └──┬───────────────┬────────────────────┬──────────────────┘
          move_core (pure rules)    │ store              │ netsuite reads          move_tx (write gate)
          scan rules, plans,     move_data (NS records) │ move_ns (SuiteQL/search)  WRITE_MODE off|qty|on
          shadow compare         local_store (JSON)     │ snapshot_data (JSON)
```

- **Same code everywhere.** Only the injected modules change:

  | Run | store | reads | `WRITE_MODE` |
  |---|---|---|---|
  | Local beta | `local_store` | `snapshot_data` | `off` |
  | Suitelet beta | `move_data` | `move_ns` | `qty` |
  | Prod | `move_data` | `move_ns` | `on` |

- **Kept:** `move_label_template`, the QR payload, the print flow and configs, the test harness (`amd.js`, fakes) and the preview server.
- **Rewritten:** the load/claim, bulk-TO and IF-building logic in `sl_move_portal`, `move_tx` and `move_core`, plus the Load and Receive screens in `move_ui`.
- **New modules:** `move_ns`, `snapshot_data`, `local_store`, and `shadow` (could live in `move_core`).

### 4.1 Reads (`move_ns` / `snapshot_data`, same interface)

- `moveTransferOrders()`: open TOs Riverside (35) → Tippecanoe, with lines `{toId, toNum, trandate, item, qty, fulfilled, remaining}`.
- `plannedIfs()`: IFs on those TOs with status **Packed**: `{ifId, ifNum, toId, toNum, lines:[{item, qty}]}`.
- `shippedIfs()` / `receiptsForIf(ifId)`: used by the shadow report, and for in-transit status in `on` mode. Receipts link to their IF via `PreviousTransactionLink` linktype `TOrdCost`.
- `items()`: SKU, description, UPC.

The prod Tippecanoe location id is taken from the first snapshot and saved in settings.

## 5. Data (portal-owned records)

The 6 existing custom record types are reused. They exist in sandbox; prod needs them created (Stage 2).

| Record | Role now | Key contents |
|---|---|---|
| settings | config | locFrom, locTo, fromName, toName, target, start, skip, labelCode `qr`, roster, `writeMode`, known trailers, default carrier `Armstrong Group` |
| config | pallet configs | unchanged |
| pallet | one label | serial (= internal id), lines `[{item, sku, pcs}]`, status `labeled · loaded · in_transit · received · missing · void`, truck id, IF id it was counted under, damaged, never-loaded flag |
| load → **truck** | one truck | status `loading · departing · departed · receiving · approving · received` (`departing` / `approving` are the working states, §12); `ifIds` (planned); `addOns [{toId, item, qty}]`; truckNo, day, trailer, seal, carrier, departedAt; approvals `{by, at, kind}`; `plan` (would-write); `writes` (what `qty`/`on` actually wrote, with ids) |
| scan | audit | every attempt: raw, mode, truck, result, actor, at |
| label_req | floor label requests | unchanged |

A pallet is counted under exactly one IF: the IF on its truck whose line holds its SKU (the oldest one if two do). Mixed pallets count each line separately.

## 6. Write modes (`move_tx`)

| Action | `off` | `qty` | `on` |
|---|---|---|---|
| Lower or raise a Packed IF line qty (manager-approved correction) | plan | **write** | write |
| Stamp trailer / `SEAL: n` / memo "Truck N · MM/DD", set Shipped | plan | plan | write |
| Create an add-on IF from a TO (Shipped) | plan | plan | write |
| Create an Item Receipt per IF (manager-approved) | plan | plan | write |

- **Plan** = an entry saved on the truck record, e.g. `{op:'if_qty', ifId, item, from, to}`, `{op:'if_stamp', …}`, `{op:'if_create', toId, lines}`, `{op:'receipt', ifId, lines, trailer, seal}`.
- **Write** runs the same entry and saves the resulting id in `writes` right away, so a retry skips steps that are already done.
- **Raise guard:** a raise is refused if the new qty is more than the line's fulfilled + TO remaining.
- **Re-read before writing:** every write re-reads the IF first. If its status isn't Packed any more, or the line qty no longer matches what was expected, the write is refused with "IF changed in NetSuite, review", and nothing else in that confirm is written.

## 7. Load-out (Riverside)

**Start a truck:** pick one or more planned IFs that aren't on another open truck. Each row shows the IF #, SKU, qty and estimated pallets (qty ÷ the default config's pcs). **Units are what count**; pallets are just a guide.

**Scan rules:**

| Scan | Result | Effect |
|---|---|---|
| Labeled serial, SKU on this truck's IFs, within qty | ✅ ok | pallet `loaded`, truck set, counted under its IF |
| Serial already on this truck | 🟡 dup | none |
| Serial on another truck still `loading` | 🟡 "On Truck B, move here?" | **Move** reassigns it |
| Serial on a departed truck, or `void`, or unknown | ❌ blocked | none |
| SKU on an IF but over its qty, and the TO has remaining qty | 🟡 over | loaded; the correction is queued (raise) |
| SKU over its qty, and the TO has nothing left, but another open TO has the SKU | 🟡 add-on | loaded; an add-on IF from that TO is queued |
| SKU not on the truck's IFs, and an open office TO has qty | 🟡 add-on | loaded; an add-on IF from the **oldest** such TO is queued |
| SKU with no open office TO, or no qty left | ❌ blocked: "set aside, call the office" | none |

- **Live view:** per IF line, scanned vs expected (pcs and pallets).
- **Edits:** **Remove** a pallet, **Undo last scan**.

**Departure confirm:**
1. Fields:
   - **Trailer:** pick from the known trailers, or type another.
   - **Seal:** required, and refused if any earlier truck used it.
   - **Carrier:** defaults to Armstrong Group.
   - **Time:** filled in automatically.
2. **Truck # of the day** = the number of trucks departed today + 1, with the day in America/Los_Angeles.
3. Build the corrections:
   - IF line short → lower it.
   - Over → raise it.
   - Extra SKU → add-on IF.
   - An IF with nothing scanned → taken off the truck and goes back to planned. It is never lowered to 0, because NetSuite won't keep an IF with no qty.
4. Who can confirm:
   - **No corrections:** the floor can confirm.
   - **Any correction:** needs a **manager OK** on the logged-in manager page (§10). The floor sees "waiting for manager".
5. On confirm:
   - the plan is saved;
   - `qty`/`on` writes run (§6);
   - the truck goes `departed`, its pallets go `in_transit`.
6. **BOL:** if the IF set or any qty changed, the screen shows **"Reprint BOL REV 2 · BOL # <original TO#> · IFs X, Y"**.

## 8. Unload (Tippecanoe)

**Pick the truck:** list departed trucks as **Truck # · date · seal · trailer**, with their IFs and pallet count. In `on` mode a Shipped IF that's not on any portal truck shows as "office-only" and can't be scanned against.

**Scan rules:**

| Scan | Result | Effect |
|---|---|---|
| Serial `in_transit` on this truck | ✅ received | pallet `received` (scanned in) |
| Already received | 🟡 dup | none |
| Serial `in_transit` on another truck | 🟡 "Belongs to Truck 2 (seal …), receive there?" | receive against that truck |
| Serial `labeled` / `loaded` (never departed) | 🟠 never loaded | flag the pallet; no receipt; shown as an exception |
| Serial `missing` (from an earlier receipt) | ✅ late arrival | queued for a second receipt on its IF |
| `void` / unknown | ❌ | none |

The screen shows **N of M pallets** per IF and the list of pallets still expected, with **Mark damaged** (it still counts as received) and **Undo last**.

**Unloading done → receipt approval (always a manager):**
- For each IF, the manager sees scanned vs shipped and the missing serials. A full match is approved in one tap.
- Approving builds the **receipt plan per IF:**
  - qty = units scanned under that IF;
  - `custbody_rsm_container_no` = trailer, `custbody7` = `SEAL: n`;
  - linked to the IF.
- Unscanned serials go `missing` and stay in transit.
- **IF states:**
  - **received:** receipts = shipped qty;
  - **short:** missing serials remain;
  - plus exceptions: damaged, never loaded.
- **Late arrival:** a missing serial scanned later creates a second receipt plan against the same IF, also manager-approved.

## 9. Shadow report (`/report`, beta)

For each truck, compare the portal's plan with what NetSuite shows (from the snapshot locally, from live reads in the Suitelet):

| Check | Portal | NetSuite |
|---|---|---|
| IF qty per line | corrected qty | actual IF qty after the office ships |
| Add-on IFs | planned TO + qty | is there an IF on that TO with the same seal? |
| Trailer / seal | departure entry | `custbody_rsm_container_no` / `custbody7` on the receipt |
| Receipt qty per IF | approved scanned qty | the receipt(s) linked to the IF |
| Trucks | distinct seals | — |

Each row is ✅ match or ❌ diff. There's also a summary per day: trucks, pallets, units, diffs.

## 10. Roles and access

- **Floor:** no-login URL (like the picker portal) for print requests, load-out scanning, unload scanning and departure entry.
- **Manager:** the **logged-in** Suitelet page (Administrator, Warehouse Portal Manager and the FK WH Mgr variants, or `custentity_portal_manager`). This is where corrections and receipts are approved, so every IF edit is traced to a real NetSuite user. It's also where labels are printed and settings changed.
- Every manager action is rejected server-side when it comes from the no-login URL.

## 11. Rollout stages

1. **Local beta:**
   - prod snapshot `move_portal/snapshot/prod-<date>.json`, pulled read-only through the SuiteQL connector and refreshed on request;
   - `move_portal/local/store.json` (gitignored);
   - the preview server on :8765, optionally reached by floor scanners at `http://<pc>:8765` over wifi;
   - `WRITE_MODE='off'` and the shadow report.
2. **Suitelet beta on prod:** create the 6 record types, upload the files, create the script and 2 deployments (logged-in manager + no-login floor), `WRITE_MODE='qty'`. The office keeps shipping and receiving by hand, and the shadow report checks it.
3. **`on`:** only on Jack's go, after a clean shadow report.

## 12. Error handling

- Every action returns `{ok, error?}`. Errors use the colored card plus tone system (unchanged).
- Scans are idempotent: a repeat gives `dup`, and a timeout shows "no response, scan again".
- Departure and receipt confirms are compare-and-set on truck status (`loading → departing`, `receiving → approving`), so a double click can't run twice. A failed write leaves the truck in its working state with the error. **Retry** resumes from the first entry with no saved id.
- A snapshot older than 24h shows a yellow "snapshot from <date>" banner in the local beta.

## 13. Testing (node, fakes)

- Every row of the §7 and §8 scan tables.
- Duplicate and moved serials, seal reuse refused, Truck # of the day (LA day boundary).
- Departure plan: short, over (raise), over with the TO exhausted → add-on, extra SKU → oldest TO, no TO → blocked, empty IF → back to planned.
- `qty` mode: only `if_qty` is written, a raise past TO remaining is refused, an IF changed in NetSuite is refused, a retry doesn't write twice.
- Receipts: always require a manager; plan per IF with trailer/seal; short → missing; late arrival → second receipt.
- Shadow compare: match, qty diff, missing receipt, seal diff.
- Old load/claim/bulk-TO tests are removed. The label, template and UI-shell tests stay.

## 14. Out of scope / later

- Tracker update to count trucks by seal (V10).
- The portal generating the VICS BOL itself.
- Offline scan queue.
- Catch-up flows (a never-loaded pallet is flagged for the office, not auto-fixed).
