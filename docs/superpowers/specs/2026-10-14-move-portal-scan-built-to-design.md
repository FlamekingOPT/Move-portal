# Move Portal: Scan-built TO + IF (amendment)

**Date:** 2026-10-14 (brainstorm start) → 2026-10-15 (design agreed) · **Status:** design confirmed by Jack section by section. Spec awaiting review.
**Amends:** `2026-10-06-move-portal-manager-dashboard-flagged-pallets-design.md` and the v3 chain before it. **Reverses v3 decisions V1 / V6** ("the portal never creates TOs"; "block a scan with no open office TO"). With the new `officeIfs` switch off, a move truck is built only from its scans: the manager's **Approve** creates the TO and its IF in NetSuite and stamps the IF Shipped. Receiving is unchanged.
**Mockup:** `docs/mockups/2026-10-15 move portal scan-built TO mockup.html` (interactive: Labels · Start truck · Load · Verify · Shipments · Approve · Written).
**Built on:** branch `feat/v3-verification` at 77b81e4 (291 tests).

## 1. Decisions (Jack, 2026-10-14 / 15)

| # | Decision |
|---|---|
| S1 | **One manager Approve writes everything:** a new TO (approved, status B, Riverside 35 → Tippecanoe 46) + its IF for the full quantity, saved Shipped with seal / trailer / memo. Nothing is written to NetSuite before that click. |
| S2 | **No office IFs in this flow.** Start truck = trailer # only. Every move truck gets its own new TO built from its scans. The office stops making move TOs and IFs. |
| S3 | **The office-IF code stays, hidden behind one switch**, Move Settings `officeIfs` (default `false`). Off hides every office-IF entry point; on restores today's v3 behaviour unchanged. Delete after the move, or never. |
| S4 | **Stock check at Approve:** if Riverside *available* doesn't cover a SKU on the truck, Approve is blocked ("YSN201 on truck 504, available 360") and nothing is written. Verify shows the same shortfall early as a warning. |
| S5 | **Load** shows what's on the truck by SKU (pallets, pcs) and has a **Finish loading** button → Verify. No TO/IF buckets. |
| S6 | **Verify** shows pallets / pcs / **weight** per SKU, a pallet tare row, a total, and Riverside available. **Finish → Shipments.** |
| S7 | **Seal # stays on Shipments** with **Mark shipped**, which sends the truck to the manager. |
| S8 | **Approve is a plain card per truck:** trailer, seal, who sent it, one-line summary, **Approve** / **Reject**. Reject sends the truck back to the floor with the manager's typed reason. |
| S9 | **The manager prints labels.** Over Riverside's unlabeled quantity = **warn, never block**. |
| S10 | **Labels can be set from an Excel upload** (SKU · Pcs per pallet · Pallets · Odd pallet pcs), previewed, then printed in one go. Max `maxPrint` (250) labels per upload. |
| S11 | **TO status B** (Pending Fulfillment) so the IF can be made in the same click; the manager's Approve *is* the approval. |
| S12 | **A TO without its IF locks the truck** until Retry succeeds or a manager closes the TO in NetSuite and presses Release. |
| S13 | **A pallet accepted after its truck shipped gets its own one-pallet TO + IF** (replaces "add-on IF from the oldest office TO"). |

## 2. Data

### 2.1 Settings (`customrecord_mv_settings` row 1, JSON)
- `officeIfs` (bool, default `false`). Read through one helper (`core.officeIfs(cfg)`); every office-IF branch asks it.
- `palletTare` (number, lb, default `45`).
- Existing `toStatus: "B"`, `locFrom`, `locTo`, `maxPrint`, `writeMode` are used as-is.

### 2.2 Truck (`customrecord_mv_load`)
- A scan-built truck has `data.kind = 'scan'` and **no** `data.ifs` / `alloc`. `_mvl_to` / `_mvl_if` are filled after Approve with the new ids.
- Contents are derived, not stored: `verify.truckLines(pallets)` → `{ item: { sku, pallets, pcs } }` from the truck's `loaded` pallets.
- New fields in `data`: `toId`, `toNum`, `ifId`, `ifNum` (after Approve), `reject: { at, by, reason }` (last reject), `lock` (true while `to_create` landed and `if_create` has not).
- Existing `depart` (truckNo, day, seal, trailer), `writes`, `claim`, `error` are reused.

### 2.3 Item weight
- The `items` SuiteQL query adds `i.weight AS weight, i.weightunit AS wunit`. `verify.lbs(weight, unit)` converts lb / oz / kg / g to lb; blank or 0 = no weight.
- `verify.truckWeight(lines, items, tare)` → `{ rows: [{ item, lbs|null }], tare, total, noWeight: n }`.

### 2.4 Pallets and labels
No record changes. An Excel batch creates the same `customrecord_mv_pallet` rows (status `labeled`) as Print a SKU, one batch per row.

## 3. Approve (manager, `ship_confirm` action on a `kind: 'scan'` truck)

1. **Claim** the truck (existing claim lock; a second manager gets "already being processed").
2. **Stock check (read only).** Live SuiteQL on `aggregateItemLocation` for location `locFrom`: `quantityavailable` per item on the truck. `verify.stockCheck(lines, avail)` → list of shorts. Any short → release the claim, return the message, **write nothing**.
3. **Plan** = `verify.scanApprovePlan(truck, cfg)`:
   - `{ op: 'to_create', ref: '<loadId>', token: 'MV-<loadId>', fromLoc, toLoc, orderStatus: 'B', lines: { item: pcs }, memo: 'MV-<loadId> · Trailer <t> · Truck <n> · <MM/DD>' }`
   - `{ op: 'if_create', toId: 'new:to', ref: '<loadId>', ship: true, token: 'MV-<loadId>', lines, trailer, seal, memo: 'Truck <n> · <MM/DD> · MV-<loadId>' }`
4. **Run** through `verify.runOps` (write mode, done-keys, `writes` saved after each op; `resolveNew` swaps `new:to` for the id written under `to_create:<loadId>`). Set `data.lock = true` after `to_create` lands; clear it after `if_create`.
5. **Finish** as today's `finishDepart`: pallets → `in_transit`, truck → shipped, `_mvl_to` / `_mvl_if` + `toNum` / `ifNum` (via `tx.tranIds`) saved.

**Write modes:** `off` and `qty` → plan saved, "Plan saved", truck shipped in the portal only (`to_create` and a scan truck's `if_create` are `on`-only in `opAllowed`). Switching to `on` later never back-fills.

### 3.1 `move_tx` additions
- `to_create`: `findByToken(token, 'TrnfrOrd')` first (v2 code from `main`); else `record.create` TRANSFER_ORDER (subsidiary from the location, `location`, `transferlocation`, `orderstatus`, `memo`, one line per item), save. Returns the TO id.
- `if_create` with `ship: true` and a `token`: first search a Shipped IF created from `toId` whose memo contains the token; else today's transform-and-stamp path. (The Packed add-on search stays as is.)
- `to_create` ops carry `ref` (`<loadId>`, or `<loadId>-P<palletId>` for a late pallet); `opKey` = `'to_create:' + op.ref`. The IF op keeps `toId: 'new:to'` in the stored plan, so its key (`if_create:new:to`) is stable across retries. `resolveNew` is extended: `toId: 'new:to'` → the id under `to_create:<ref>` (op carries the same `ref`), else "The TO was not created yet". `opAllowed` treats `to_create` and `if_create` with `ship: true` on a scan truck as `on`-only.

### 3.2 Reject
Manager types a reason → truck back to `open` (pallets stay `loaded`), `data.reject` set, `depart` / `shipReq` cleared. The floor sees the reason on the truck until it is marked shipped again. Not allowed while `lock` is set.

## 4. Floor (with `officeIfs` off)

- **Start truck:** trailer # (picker of `cfg.trailers` + free text). No IF list, no "Add to this truck" office-IF banners.
- **Load:** a scan loads when the pallet is `labeled` and not on another open truck (today's rules) — the open-office-TO check is skipped. Take off and + Add other item unchanged. Side panel: `truckLines`. **Finish loading** → Verify.
- **Verify:** table per SKU (pallets, pcs, lbs, Riverside available), tare row (`pallets × palletTare`), total; amber row + banner for a SKU over available ("Approve will be blocked: take N pallets off or call the office"); "no weight" on a SKU without one and "+ N SKUs without weight" on the total. Always passes (no expected qty). **Finish → Shipments.** Any scan / take-off after Verify sends the truck back to Load state.
- **Shipments:** seal # + **Mark shipped** → `ship_pending` (today's state), shows pallets / pcs / lbs.
- **Request label** unchanged.

## 5. Manager (with `officeIfs` off)

- **Approvals → Ship confirmations:** the plain card (S8). A blocked stock check shows the red message on the card and greys Approve until the next try.
- **Retry / Release:** a truck with `error` shows the NetSuite error and **Retry** (re-runs the plan; done keys skip). While `lock` is set, **Release** first reads the TO: allowed only if every TO line is closed (or the TO is deleted); then the truck goes back to `open`, `writes` / `lock` / `toId` cleared.
- **Dashboard:** truck tiles, waiting-for-approval and exceptions stay; Active loads lists trucks (one row per truck, IF/TO numbers once written) instead of planned office IFs.
- **Hidden when `officeIfs` is off:** Correct the IF, Trucks waiting for an IF fix, planned-IF lists, NetSuite checks rows that compare office IFs, "Add to this truck".

## 6. Labels (manager)

- **Print a SKU:** today's form + an **Odd pallet** field (one pallet × N pcs). Shows Riverside available and already labeled (pallets `labeled` or `loaded`, not yet shipped). Over → amber "N pcs more than Riverside shows unlabeled. You can still print."
- **Excel upload:**
  - The page loads SheetJS (`xlsx@0.18.5` from cdnjs) on demand and reads the first sheet. Header names are matched case-insensitively: `SKU`, `Pcs per pallet`, `Pallets`, `Odd pallet pcs` (optional).
  - Rows go to a new action `labels_preview` → `verify.labelRows(rows, items, avail, labeled, maxPrint)` → each row `ok` / `warn` (over available, message) / `skip` (unknown SKU, blank or 0 pallets, pcs ≤ 0), plus the label total. Over `maxPrint` → "N labels; split the file (max 250)" and no Print.
  - **Print all** → action `labels_print_batch` re-validates and creates the pallets for the non-skipped rows, one batch per row (a SKU twice = two batches), and opens one 4×6 print page with every label.
  - **Download template:** a client-built .xlsx with the four headers.
  - A file that can't be read or lacks a required column: one message, nothing created.
- **Label requests** from the floor show on the Labels tab with **Print**.

## 7. Errors and edge cases

| Case | Behaviour |
|---|---|
| Stock short at Approve | Blocked, message names SKU / on truck / available, nothing written. Manager rejects (take pallets off) or fixes stock and approves again. |
| TO saved, IF failed | `error` + `lock` set, truck locked (no scans / take-offs / reject). Retry makes only the IF on the same TO. |
| Request died after a save | Retry finds the TO by `MV-<loadId>` and the Shipped IF by token on that TO; never a duplicate. |
| Retry can never succeed | Manager closes the TO in NetSuite, then Release (checked closed) → truck open. |
| Two managers approve | Claim lock: the second gets "already being processed". |
| Stock drops between check and IF save | NetSuite refuses the IF → "TO saved, IF failed" row. |
| Pallet accepted after the truck shipped (flagged at unload, scan truck) | Accept runs a one-pallet plan: stock check, `to_create` (token `MV-<loadId>-P<palletId>`), `if_create` Shipped with the truck's seal / trailer; then the late receipt as today. Same write-mode rules. |
| Pallet missing at unload | Unchanged: stays in transit on the TO until scanned in (late receipt). |
| Item without weight | Shown, never blocks. |
| `off` / `qty` | Plan only, portal-only ship; no back-fill. |

## 8. Testing

**Pure (`move_verify`):** `truckLines`; `lbs` + `truckWeight` (units, tare, no-weight count); `stockCheck` (short message with both numbers); `scanApprovePlan` (two ops, token, memo, `new:to` resolution, done-key skip on retry); `opAllowed` for `to_create` in each mode; `labelRows` (ok / warn / skip, cap, duplicate SKU = two batches).

**`move_tx` with `fake_tx`:** `to_create` creates status B 35 → 46 and finds an existing TO by token; `if_create` ship:true finds an existing Shipped IF by token.

**Suitelet flows with fakes:** happy path (scan → Verify → Mark shipped → Approve → TO + Shipped IF → Unload → Approve receipt → IR on the new TO); stock short writes nothing; TO ok / IF fails → locked, Retry writes only the IF, Release refused until the TO is closed; two managers; late pallet Accept → one-pallet TO + IF + late receipt; Reject with reason; `off` / `qty` plan only; `officeIfs` off hides every office-IF entry point, and with it on all existing office-IF tests pass unchanged.

**Local beta:** snapshot `items` adds weight; the stand-in fakes `to_create` / `if_create` in memory.

**Sandbox (`on`):** a clean truck; a truck with a forced IF failure (Retry and Release); a late pallet; an Excel label upload.

**Prod first truck (add to the launch checklist):** TO approval routing (does the manager role save status B?), Riverside bins / inventory detail on the IF, Long Text read-back of a big truck, then check the TO (B → Pending Receipt), the IF (Shipped, memo, `custbody7`, trailer) and the IR.

## 9. Out of scope
Changes to receiving beyond the late-pallet TO; the Move Tracker (it reads NetSuite and picks the new TOs / IFs up as it does today); deleting the office-IF code.
