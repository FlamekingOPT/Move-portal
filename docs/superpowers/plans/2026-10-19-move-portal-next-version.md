# Move Portal — next version plan (2026-10-19) · ✅ BUILT 2026-10-19 (not uploaded)

> Jack, 2026-10-19: "hold off on building, just put in a plan for next version." **Don't touch the portal code until he says build.**
> This version goes out after the prod launch of `27643a8` (CLAUDE.md "PROD SET UP 2026-10-19") has settled.

**Four features for the next version (Jack 10/19):**
1. Unit weights + truck weight
2. Printed VICS BOL (finalize the 10/18 spec)
3. Delete a truck
4. Manager Trailers editor

All four are manager-side and share the same files (`move_data`, `move_verify`, `sl_move_portal`, `move_ui`; the BOL also needs `move_core` and `move_label_template`). So **build them in one session, in this order**: weights first, because the BOL depends on it.

**Settings changes that ship with this version (prod Move Settings row 1):**
- `palletTare` 45 → **35**
- new `maxTruckLb` **45000**
- new `bolName` "YSN IMPORTS"
- `defaultCarrier` "Armstrong Group" → **"ArcBest"** (Jack 10/19: change it with this version, not before). Also change the code fallback `'Armstrong Group'` in `sl_move_portal.js` (213, 711, 1380), `move_ui.js` 822 and the tests/beta seed.
- new `unitWeights` (filled by the upload)

---

## 1. Unit weights + truck weight

### Why
Verify, Shipments, View load and the manager pop-up show truck weight as unit weight × pcs + pallet tare (`verify.truckWeight`). The unit weight comes from the NetSuite item `weight`/`weightunit`, and **every prod item has a blank weight** (checked 10/19: YSN201, YSN301, YSN401, YSN03, YSN5LB, KT12ACR-2, VOPD20 all null). So prod shows no truck weight today.

### Jack's decisions (2026-10-19)
- **Portal-only.** The weights live in the portal (Move Settings). NetSuite item records are **not** changed, because other systems read item weight.
- **Colour/label variants inherit their base SKU's weight** (YSN201-AG / -BR / -UH → YSN201), shown as "from base SKU".
- **Pallet weights in the source files are gross** ("I don't know, but let's assume they do" include the wooden pallet).
- **Pallet tare = 35 lb everywhere.** That covers the unit-weight math, Verify, the overweight warning and the BOL. (The portal used 45; the sample BOL implied 27.)
- **The floor sees weights too.**
- **Overweight warning at 45,000 lb.**

### Source data (Jack's files)
- `Flame King Products Main (1).xlsx`, sheet **Main**:
  - The header is on rows 1–3 and the data starts at row 4.
  - Columns: B ITEM, C DESCRIPTION, N PALLET QUANTITY, R INDIVIDUAL WEIGHT LB, Z PALLET WEIGHT LB. 293 SKUs.
  - Section rows (B filled, C blank, e.g. "LP CYLINDER") name the category of the rows below them. They give the BOL **Type**: the cylinder/tank sections → `CYL`, everything else → `PCS`.
- `Product Matrix .xlsx`:
  - sheets **Riverside Copy** (preferred), then **Units per case pallet**: A Item, D Pallet Qty, G Pallet weight. 145 SKUs.
  - sheet **Accesories II**: the header is on row 4; A SKU, E Pallet Qty, H Pallet Weight. 227 SKUs, mostly blank.
  - SKUs found only here get Type `PCS` unless the SKU or description says cylinder/tank. Jack reviews the result.

### Which number wins (first match per SKU)
1. Main, individual weight (R).
2. Main, **(pallet weight − 35) ÷ pallet qty** (Z, N).
3. Product Matrix, Riverside Copy, then Units per case pallet: (pallet weight − 35) ÷ pallet qty.
4. Accesories II: (pallet weight − 35) ÷ pallet qty.
5. A variant on hand at Riverside → its base SKU (strip the last `-xxx`).

### Coverage (against Riverside on hand, snapshot 2026-10-06, 382 SKUs)
- Rules 1–4 cover **208 SKUs ≈ 85% of pieces**: 177 from the Main individual weight, 16 from the Matrix pallets, 15 from Accesories II.
- Rule 5 adds **25 variant SKUs ≈ 56,500 pcs**.
- About **150 SKUs stay blank**, mostly small accessories. The largest gaps by pieces: 5AYRS03366, 11055-DB4, 11088H-5, KT12ACR-2BR (its base is KT12ACR-2, not a plain "-xx" variant), KT15ACR-2, G2R150B, AB226, AB227, D-CAP-335, 11043B-2A, LS-726A.
- **YSN201 = 18 lb** (Main), the same as the real BOL. This settles BOL open item 1 (Capacity Builder said 19.8 lb).

### Step A: the combined file (data, no code)
- Build `Unit weights <date>.xlsx` with the rules above:
  - **Unit weights** sheet: SKU | Unit weight (lb) | Type (CYL/PCS) | Source | Description | Pallet qty | Pallet weight | Riverside on hand. Typed values are blue. Formulas are black: `(pallet − tare) ÷ qty`, with the tare in one labeled cell on Notes, plus the base-SKU lookups.
  - **Missing (Riverside)** sheet: on-hand SKUs with no weight, with yellow columns (weight, type) to fill in and an example row.
  - **Notes** sheet: the rules, the assumptions, the tare cell (35), and coverage formulas.
- The builder script is parked at `docs/superpowers/drafts/2026-10-19-build-unit-weights.py` (args: Main xlsx, Matrix xlsx, snapshot json, output xlsx). **Not run yet. It needs three changes before it runs:**
  1. Subtract the tare cell in the pallet formula.
  2. Add the Type column from the Main section rows.
  3. Read live on-hand: prod had 370 SKUs on 10/19 vs 382 in the 10/06 snapshot.
- Jack reviews the file before it is uploaded.

### Step B: portal code
- **Storage:** Move Settings key `unitWeights: { "<item internal id>": [lb, "CYL"|"PCS"] }`, plus `unitWeightsAt` / `unitWeightsBy`. About 400 entries ≈ 15 KB, well inside Long Text.
  - Keyed by internal id, resolved from the SKU at upload, so a SKU rename doesn't break it.
  - This replaces the BOL spec's separate `itemWts`: there is one weights table.
- **Upload UI (manager, Labels tab, "Weights" card):**
  - Upload `.xlsx`/`.csv` with columns **SKU | Unit weight (lb) | Type** (blank Type = PCS), reusing the SheetJS loader from the label Excel upload.
  - Server preview: ✅ / ⚠ unknown SKU / ⚠ not a positive number / ⚠ bad type / changed-from-old.
  - **Save weights** replaces the whole table. **Download current weights** as CSV.
  - Show "N SKUs with weight · last uploaded <when> by <who>".
- **Server:** `weights_preview`, `weights_save` and `weights_list`, manager-only (like `labels_preview`).
  - Pure parse/check in `move_core.buildWeightImport(rows, skuMap)`, as the BOL spec planned.
- **Use:** one overlay, `move_verify.withWts(info, wts)`, applied right after `data.itemInfo(items)` (e.g. `scanRows`, `sl_move_portal.js:232`, and the manager pop-up):
  - A portal weight wins over the NetSuite item weight.
  - If there's no portal weight, fall back to NetSuite. If there's neither, the SKU stays "no weight", as today.
  - Every weight display reads through it: Verify, Shipments, View load (floor + manager pop-up) and the BOL.
- **Overweight warning:**
  - New Settings key `maxTruckLb` (default 45000).
  - When the truck total (unit weights + 35 lb × pallets) is over it, Verify / Shipments / View load show an amber banner "⚠ Over 45,000 lb: <total> lb", on both floor and manager.
  - It's a warning, not a block: Send for docs and Approve still work, and the Approve card repeats the warning.
  - If any SKU on the truck has no weight, the total is a minimum, so the banner says "at least <total> lb".
- **Item search:** show the portal weight and type in the Labels item search.
- **Tests:**
  - `withWts` overlay and its NetSuite fallback.
  - `buildWeightImport`: unknown SKU, zero/blank, bad type, duplicate rows (last wins, plus a warning).
  - `truckWeight` with tare 35.
  - Overweight under/at/over, plus the "at least" wording.
  - Manager-only guards.

---

## 2. Printed VICS BOL (finalize the 2026-10-18 spec)

The full design is in `docs/superpowers/specs/2026-10-18-move-portal-bol-design.md`, with the parked reference patch `docs/superpowers/drafts/2026-10-18-bol-draft.patch`. Its three open questions are now ruled:

| Open question in the spec | Jack's ruling (2026-10-19) |
|---|---|
| 1. YSN201 unit weight 19.8 vs 18 lb | **18 lb**, from Products Main, via the weights upload (§1) |
| 2. Pallet tare 45 vs 27 lb | **35 lb** (`palletTare` → 35) |
| 3. Reprint after a re-approve | **Auto-open the new BOL** on the re-approve success message, marked **REV n**, same BOL # (TO #). The old paper copy is thrown away. |

### What it does (from the spec, unchanged)
- **Who and when:** the manager prints at **Approve docs** (🖨 Print BOL). It's also on the At-the-dock card, the pickup cards and the View load pop-up.
- **How it prints (Jack confirmed 10/19):** the BOL is **never drawn on the Approvals screen**. After Approve docs, the success message ("Docs written: TO… · IF…") opens the BOL **PDF in a new browser tab** (the print preview), and the manager prints from there (Ctrl+P). The 🖨 Print BOL button reopens it. A re-approve opens REV n the same way. Mockup shown in chat 10/19 (sample: ArcBest, trailer 537224, 32 pallets, 36,746 lb).
- **Header:**
  - Ship From / To: `bolName` + the NetSuite Location address.
  - BOL # = TO #, Date = the docs-approval day, Carrier / Trailer.
  - **Seal blank until it's saved at the dock**; a reprint after that fills it in.
  - Freight Prepaid.
- **Customer order rows:** pallets, weight, Pallet = Y, `#IF…`, SKU list.
- **Carrier rows:** one per SKU: handling units (PLT), pieces with **CYL/PCS from the weights Type**, weight, H.M. **X** for CYL, the SKU description; then a grand total.
- **Weights:**
  - Line weight = pieces × unit weight + pallets × 35.
  - A SKU with no weight prints a blank line weight. The grand total prints blank, and a footnote lists the missing SKUs (never a wrong total on a legal document).
  - The 45,000 lb warning shows on the Approve card, not on the BOL.

### Build pieces (from the spec)
1. `move_core.buildWeightImport` (shared with §1).
2. `move_verify.withWts` (shared with §1) and `move_verify.bolPlan({pallets, info, tare})`.
3. `move_label_template.bolXml(b)`: one Letter page in the VICS layout, using the BFO renderer the labels already use.
4. `move_data.locationAddresses(ids)`: a failed read prints blanks.
5. **Server:** `bol_data`, plus `?action=bol&truckId=` streaming the PDF (manager only). The REV number is kept in `data.bol = { rev, printedAt, by }`, and bumped when a re-approve changes quantities.
6. **UI:** the Print BOL buttons, plus the auto-open after a re-approve.
7. **Tests:** each pure piece and each action. Then the local beta, then the sandbox.

---

## 3. Delete a truck

### Jack's decisions (2026-10-19)
- **Purpose:** "mainly for testing, but otherwise any truck not shipped, if we recall a shipment."
- **Effect:** the pallets go back and a record is kept.

### Rules
- **Who:** a manager, from the truck pop-up / Active loads row / At-the-dock card (🗑 Delete truck), with a **required reason** (300 max). The floor never sees it.
- **Allowed** on any truck that has **not shipped**: loading, needs fix, ready, waiting for docs (`ship_pending`), at dock (`at_dock`), and picked-up-waiting-for-manager (`pickup_pending`) with no stamp done and no pallet in transit.
- **Refused:**
  - `departing` (docs being written): "Release it first."
  - Departed / receiving / received: "Already shipped."
  - Half-done pickup: "Finish or force the pickup."
- **Trucks with NetSuite docs (a recalled shipment):** the portal **never deletes or closes a NetSuite transaction**. Delete checks NetSuite live and refuses until the office has cleaned up, listing exactly what's left:
  - Each of the truck's IFs (main + add-on IFs) must be **deleted** in NetSuite.
  - Its TO must be **closed or deleted**.
  - Example message: "Delete IF53840 and close TO8723 in NetSuite first, then press Delete again."
  - This mirrors today's Release guard (`depart_release`, `sl_move_portal.js:1499`).
  - A truck approved in `off`/`qty` mode (no TO) deletes straight away.
- **What happens:**
  - Every pallet on the truck (loaded, or taken off but still linked) → **labeled**, load cleared, so it can go on another truck.
  - Other items are dropped from the truck.
  - The truck → new status **`deleted`**, with `data.deleted = { by, at, reason, toNum, ifNums }`.
  - Scans stay as history.
  - The trailer becomes free again.
- **Where it shows:**
  - Hidden from Load out, Shipments, Approvals, the Dashboard tiles/Active loads, and the Truck # count of the day.
  - Listed in **Report → Truck history** with a grey **Deleted** pill, plus who, when and why.
- **Tests:**
  - Each allowed and refused state.
  - The NetSuite cleanup guard (IF still there, TO open, add-on IF still there), and that it passes once they're gone.
  - Pallets back to labeled.
  - Hidden from the lists, present in history.
  - The trailer is free again.
  - Manager-only, reason required.

---

## 4. Manager Trailers editor

### Why
Trailer numbers change. Today the floor's Trailer # list comes from Move Settings `trailers`, so a new trailer means editing the NetSuite record. The floor can type a one-off under "Other…".

### Jack's decision (2026-10-19)
A manager-only editor (add/remove). "Other…" stays for one-offs.

### Build
- **UI:** a Trailers card (Labels tab, next to Weights) lists the trailers, with Add (trim, `normTrailer`, refuse duplicates, max 20 chars) and Remove (warn when an open truck uses that trailer).
- **Server:** `trailers_list` and `trailers_save`, manager-only, writing `S.trailers` through `move_data`.
  - The floor list (`truck_planned`, `sl_move_portal.js` ~711) already reads `S.trailers || DEFAULT_TRAILERS`, so no floor change is needed.
- **Tests:** next to the trailer tests in `test/portal.test.js` (~1872, ~1966) and `test/ui.test.js`.

---

## Rollout
1. Build with TDD, in the order 1 → 2 → 3 → 4; `node --test "move_portal/test/*.test.js"` stays green (430 today). Then do a local beta click-through: upload weights, verify a truck over 45k, print a BOL, re-approve → REV 2, delete a truck, add a trailer.
2. **Sandbox:** upload the changed files over the same File Cabinet ids, recompile script 893, and smoke test.
   - Delete-a-truck is the sandbox clean-up tool from then on: delete the IF, close the TO, then Delete.
3. **Prod:**
   - Upload over the same ids (core 3050378, verify 3050380, data 3050483, tx 3050484 if changed, label_template 3050485, ui 3050486, sl 3050487) and recompile script 1166.
   - ⚠ The new-file `?folder=` is ignored; uploading over the existing ids avoids that.
   - Then the Settings changes: `palletTare` 35, `maxTruckLb` 45000, `bolName`.
   - Smoke test.
4. Upload the reviewed weights file through the Weights card. Then check one real truck's Verify weight and printed BOL against its scale ticket.
