# Move Portal — next version plan (2026-10-19) · PLAN ONLY, NOT BUILT

> Jack, 2026-10-19: "hold off on building, just put in a plan for next version." **Don't touch the portal code until he says build.**
> This version goes out after the prod launch of `27643a8` (CLAUDE.md "PROD SET UP 2026-10-19") has settled.

Two features, both manager-only and both stored in Move Settings. They touch the same files (`move_data`, `sl_move_portal`, `move_ui` Labels/Report area), so they should be **built together in one session**, not in parallel.

---

## 1. Unit weights upload (truck / TL weight)

### Why
Verify, Shipments, View load and the manager pop-up show truck weight as unit weight × pcs + pallet tare (`verify.truckWeight`). The unit weight comes from the NetSuite item `weight`/`weightunit`, and **every prod item has a blank weight** (checked 10/19: YSN201, YSN301, YSN401, YSN03, YSN5LB, KT12ACR-2, VOPD20 all null). So prod shows no truck weight today.

### Jack's decisions (2026-10-19)
- **Portal-only.** The weights live in the portal (Move Settings). NetSuite item records are **not** changed, because other systems read item weight.
- **Colour/label variants inherit their base SKU's weight** (YSN201-AG / -BR / -UH → YSN201), shown as "from base SKU".

### Source data (Jack's files)
- `Flame King Products Main (1).xlsx`, sheet **Main**. The header is on rows 1–3 and the data starts at row 4. Columns: B ITEM, C DESCRIPTION, N PALLET QUANTITY, R INDIVIDUAL WEIGHT LB, Z PALLET WEIGHT LB. 293 SKUs.
- `Product Matrix .xlsx`:
  - sheets **Riverside Copy** (preferred), then **Units per case pallet**: A Item, D Pallet Qty, G Pallet weight. 145 SKUs.
  - sheet **Accesories II**: the header is on row 4; A SKU, E Pallet Qty, H Pallet Weight. 227 SKUs, mostly blank.

### Which number wins (first match per SKU)
1. Main, individual weight (R).
2. Main, pallet weight ÷ pallet qty (Z ÷ N).
3. Product Matrix, Riverside Copy, then Units per case pallet: pallet weight ÷ pallet qty.
4. Accesories II: pallet weight ÷ pallet qty.
5. A variant on hand at Riverside → its base SKU (strip the last `-xxx`).

### Coverage (against Riverside on hand, snapshot 2026-10-06, 382 SKUs)
- Rules 1–4 cover **208 SKUs ≈ 85% of pieces**: 177 from the Main individual weight, 16 from the Matrix pallets, 15 from Accesories II.
- Rule 5 adds **25 variant SKUs ≈ 56,500 pcs**.
- About **150 SKUs stay blank**, mostly small accessories. The largest gaps by pieces: 5AYRS03366, 11055-DB4, 11088H-5, KT12ACR-2BR (its base is KT12ACR-2, not a plain "-xx" variant), KT15ACR-2, G2R150B, AB226, AB227, D-CAP-335, 11043B-2A, LS-726A.
- **YSN201 = 18 lb** (Main). This settles open item (a) in the BOL plan: Capacity Builder said 19.8 lb, and the real BOL used 18 lb.
- ⚠ A pallet weight may include the wooden pallet. If so, a pallet-derived unit weight runs a little high (≈ 45 lb ÷ pallet qty). The portal adds its own tare (`palletTare`, 45 lb), so ask Jack whether those pallet weights are gross or net before trusting rules 2–4.

### Step A: the combined file (data, no code)
- Build `Unit weights <date>.xlsx` with the rules above:
  - **Unit weights** sheet: SKU | Unit weight (lb) | Source | Description | Pallet qty | Pallet weight | Riverside on hand. Typed values are blue; formulas (pallet ÷ qty, base-SKU lookups) are black.
  - **Missing (Riverside)** sheet: on-hand SKUs with no weight, with a yellow column to fill in and an example row.
  - **Notes** sheet: the rules, the assumptions, and coverage formulas.
- A ready builder script is parked at `docs/superpowers/drafts/2026-10-19-build-unit-weights.py` (args: Main xlsx, Matrix xlsx, snapshot json, output xlsx). **Not run yet.**
- Refresh the on-hand from live SuiteQL (`aggregateItemLocation`, location 35) before building: the 10/06 snapshot has 382 SKUs and prod had 370 on 10/19.

### Step B: portal code
- **Storage:** Move Settings key `unitWeights: { "<item internal id>": <lb> }`, plus `unitWeightsAt` / `unitWeightsBy`. About 400 entries ≈ 12 KB, well inside Long Text.
  - Keyed by internal id, resolved from the SKU at upload, so a SKU rename doesn't break it.
- **Upload UI (manager, Labels tab or a small Settings card):**
  - Upload `.xlsx`/`.csv` with columns **SKU | Unit weight (lb)**, reusing the SheetJS loader the label Excel upload already uses.
  - Server preview: ✅ / ⚠ unknown SKU / ⚠ not a positive number / changed-from-old.
  - **Save weights** replaces the whole table. Download current weights as CSV.
  - Show "N SKUs with weight · last uploaded <when> by <who>".
- **Server:** new actions `weights_preview` and `weights_save` (manager-only, like `labels_preview`), plus `weights_list`.
- **Use:** one overlay in `data.itemInfo(items)` (or right after it in `scanRows`, `sl_move_portal.js:232`):
  - A portal weight wins over the NetSuite item weight (unit lb).
  - If there's no portal weight, fall back to NetSuite. If there's neither, the SKU stays "no weight", as today.
  - Every weight display reads through it: Verify, Shipments, View load (floor + manager pop-up), and later the BOL.
- **Item search:** show the portal weight in the Labels item search, with its source.
- **Tests:**
  - `truckWeight` with an overlay.
  - Upload preview cases: unknown SKU, zero/blank, duplicate SKU rows (last wins, plus a warning).
  - Variant rows arrive pre-resolved in the file, so the portal does not infer variants itself.
  - Manager-only guard on both actions.
  - The overlay falls back to NetSuite.

### Open for Jack
- (a) Are the "pallet weight" numbers in both files gross (with the wooden pallet) or product only?
- (b) Should the floor see weights, or only the manager? Today the floor Verify shows weight.
- (c) Should a ⚠ show on Verify when the truck is over a weight limit (e.g. 44,000 lb)? If yes, what limit?

---

## 2. Manager Trailers editor

### Why
Trailer numbers change. Today the floor's Trailer # list comes from Move Settings `trailers`, so a new trailer means editing the NetSuite record. The floor can type a one-off under "Other…".

### Jack's decision (2026-10-19)
A manager-only editor (add/remove), built after launch. "Other…" stays for one-offs.

### Build
- **UI:** a Trailers card (next to the weights card) lists the trailers, with Add (trim, `normTrailer`, refuse duplicates, max 20 chars) and Remove (refuse or warn when an open truck uses that trailer).
- **Server:** `trailers_list` and `trailers_save`, manager-only, writing `S.trailers` through `move_data`.
  - The floor list (`truck_planned`, `sl_move_portal.js` ~711) already reads `S.trailers || DEFAULT_TRAILERS`, so no floor change is needed.
- **Tests:** next to the trailer tests in `test/portal.test.js` (~1872, ~1966) and `test/ui.test.js`.

---

## Rollout (both features)
1. Build with TDD; `node --test "move_portal/test/*.test.js"` stays green (430 today). Then do a local beta click-through.
2. Upload the changed files to the **sandbox** over the same File Cabinet ids, recompile, and smoke test.
3. Upload to **prod** over the same ids: data 3050483, ui 3050486, sl 3050487 (+ verify 3050380 if it changes). Recompile script 1166. Smoke test.
   - ⚠ Set the folder explicitly (the new-file `?folder=` is ignored). Uploading over the existing file ids avoids that.
4. Upload the combined weights file through the new card, then check one real truck's Verify weight against the scale ticket or BOL.
