# Move Portal next version: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship four manager features in one release: unit weights with a 45,000 lb warning, the printed VICS BOL, delete a truck, and a Trailers editor. The default carrier becomes ArcBest and the pallet tare becomes 35 lb.

**Architecture:**
- Pure rules go in `move_core` / `move_verify` / `move_label_template` (unit-tested in node).
- NetSuite reads and writes go in `move_data` / `move_tx`.
- Manager actions are `act(...)` entries in `sl_move_portal.js`. The single-page client is `move_ui.js`.
- New settings live in the Move Settings JSON (`data.saveSettings(patch)`).
- The BOL is a BFO PDF from `render.xmlToPdf`, served by a new `?action=bol&truckId=` route, like the label `pdf` route.

**Tech stack:** SuiteScript 2.1 AMD modules; node `node:test` with the in-memory fakes in `move_portal/test/`; SheetJS (already loaded by the label upload) for Excel; Python + openpyxl for the one-off weights workbook.

**Spec:**
- `docs/superpowers/plans/2026-10-19-move-portal-next-version.md` (Jack's rulings, 2026-10-19)
- `docs/superpowers/specs/2026-10-18-move-portal-bol-design.md` (BOL boxes and weight math)
- `docs/superpowers/drafts/2026-10-18-bol-draft.patch` (reference code for `buildWeightImport`, `withWts`, `bolPlan`, `bolXml`, `locationAddresses`; apply its pieces as the tasks say, don't `git apply` it whole)

## Global Constraints
- Branch `feat/v3-verification`. Every commit ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Tests: `node --test "move_portal/test/*.test.js"` (quote the glob). Start: 430/430. Every task ends all-green.
- Pallet tare **35 lb**: the `core.palletTare` fallback and the `move_data` DEFAULTS `palletTare: 35`.
- Overweight limit **45,000 lb**: Settings `maxTruckLb`, default 45000. It's a warning only; it never blocks Send for docs or Approve.
- Default carrier **"ArcBest"**: it replaces every `'Armstrong Group'` fallback.
- Unit weights live in Settings `unitWeights: { "<SKU upper>": [lb, cyl 1|0] }`, plus `unitWeightsAt` (stamp) and `unitWeightsBy` (name). NetSuite items are never written.
- A portal unit weight wins over the NetSuite item weight. Without either, the SKU is "no weight".
- The floor sees weights and the overweight warning. Everything else new is **manager-only** (`act(name, true, …)`; the BOL route refuses the floor deployment like `pdf()`).
- The portal **never deletes or closes a NetSuite transaction**.
- The BOL is never drawn in the app. It opens as a PDF in a new tab (the print preview).
- UI copy: sentence case, no "please", no "successfully". Match the existing `flash(...)` / `errBox(...)` styles.

## Review Focus
1. **Pop-up blocker on auto-open:** `window.open` after an `await` is blocked by Chrome. Open a blank tab synchronously in the click handler, then set its location (Task 7 test: the handler source opens before `await api(`).
2. **Excel cells:** SKUs in mixed case or with spaces, and weights as `"18.0"` / `18` / `" 18 "` all import the same. An `=`-formula cell exported by SheetJS arrives as its value (Task 2 test).
3. **Mixed pallet:** a pallet with two SKUs counts as one handling unit (one tare), on its first line's SKU. Weight and BOL totals still add up (Task 5 test).
4. **Delete while the floor has the truck open:** a later floor scan on a deleted truck is refused with "This truck was deleted", not a crash (Task 8 test).
5. **BOL in `off`/`qty` mode (no TO):** it still prints, with BOL # "—" and a "Plan only: no TO in NetSuite" line, so the off-mode walk can print one (Task 6 test).

---

### Task 1: Weight rules (pure)

**Files:**
- Modify: `move_portal/move_core.js`: add `buildWeightImport`; `palletTare` fallback 45→35; add `maxTruckLb`; export them.
- Modify: `move_portal/move_verify.js`: add `withWts`; `scanSummary` helper; export.
- Modify: `move_portal/move_data.js:23-24`: DEFAULTS `palletTare: 35`, `maxTruckLb: 45000`.
- Test: `move_portal/test/core.test.js`, `move_portal/test/verify.test.js`.

**Interfaces:**
- Produces:
  - `core.buildWeightImport(rows: Array<[sku, lb, type]>, skuToItem: {SKU: itemId}) → { weights: {SKU: [lb, 0|1]}, errors: [{row, msg}], unknownSkus: string[], count }`. Take the body from the draft patch, then add: trim and upper-case the SKU; `Number(String(lb).trim())`; skip a first row whose col 0 matches `/sku/i`; a duplicate keeps the first row and reports `"<SKU>: duplicate row, the first one is kept"`.
  - `core.palletTare(S) → number` (fallback 35).
  - `core.maxTruckLb(S) → number` (S.maxTruckLb > 0, else 45000).
  - `verify.withWts(info, wts) → info'`, from the draft: for each item with a portal weight, `{ weight: lb, wunit: 'lb', cyl: !!flag }`; others are unchanged with `cyl: false`.
  - `verify.overweight(total, noWeight, max) → { max, over: boolean, atLeast: boolean }`. `over` = total > max; `atLeast` = noWeight > 0.

- [ ] **Step 1: Write failing tests**
  - `core.test.js` `buildWeightImport normalizes cells and reports bad rows`:
    - rows `[['SKU','Unit weight (lb)','Type'],[' ysn201 ','18.0','cyl'],['YSN301',25,''],['NOPE',3,''],['YSN301',26,''],['YSN100','0',''],['YSN100','x','']]`, skuToItem `{YSN201:'11',YSN301:'12',YSN100:'975'}`.
    - Expect `weights` `{YSN201:[18,1], YSN301:[25,0]}`, `count` 2, `unknownSkus` `['NOPE']`.
    - Expect 3 errors: the duplicate YSN301 (row 5), and YSN100 rows 6 and 7 "unit weight must be a number of pounds above 0".
    - A type `'BOX'` → error "type must be CYL or PCS".
  - `core.test.js` `tare and max truck defaults`: `palletTare({})===35`, `palletTare({palletTare:27})===27`, `maxTruckLb({})===45000`, `maxTruckLb({maxTruckLb:40000})===40000`.
  - `verify.test.js` `withWts overlays the portal weight and keeps NetSuite as fallback`:
    - info `{11:{sku:'YSN201',weight:0,wunit:''},12:{sku:'YSN301',weight:30,wunit:'lb'},13:{sku:'X',weight:0}}`, wts `{YSN201:[18,1]}`.
    - Expect 11 → weight 18, wunit 'lb', cyl true; 12 unchanged with cyl false; 13 unchanged.
  - `verify.test.js` `overweight`: `(45001,0,45000)` → over true, atLeast false; `(45000,0,45000)` → over false; `(40000,2,45000)` → over false, atLeast true.
- [ ] **Step 2:** Run `node --test "move_portal/test/*.test.js"` → the new tests FAIL (not a function).
- [ ] **Step 3:** Implement the five exports above.
- [ ] **Step 4:** Run all tests → PASS.
  - Fix any existing test that assumed tare 45 (e.g. the `scan.tare` 90 in `portal.test.js` 'scan-built: start with only a trailer…' becomes 70, and its total 2470) by changing only the expected numbers.
- [ ] **Step 5:** Commit `feat(weights): weight import rules, portal-weight overlay, tare 35, 45k limit`.

### Task 2: Weights on the server

**Files:**
- Modify: `move_portal/sl_move_portal.js`: new actions near `labels_preview` (~582); overlay in `scanRows` (~229-238) and `item_lookup` (~509).
- Test: `move_portal/test/portal.test.js` (new block after the scan-built tests).

**Interfaces:**
- Consumes: Task 1 exports; `data.skuMap()`, `data.saveSettings(patch)`.
- Produces:
  - `act('weights_preview', true, {rows})` → `{ count, errors, unknownSkus, added, changed, removed }`. Counts compare with `c.S.unitWeights`. Max 2000 rows → userErr "Too many rows (2,000 max per file)".
  - `act('weights_save', true, {rows})` → same checks. Saves `{ unitWeights, unitWeightsAt: c.now.stamp, unitWeightsBy: c.actor }`, replacing the whole table. Refuses when `count === 0` ("Nothing to save: no valid rows"). Returns `{ count }`.
  - `act('weights_list', true)` → `{ rows: [{sku, lb, type:'CYL'|'PCS'}] (sorted by sku), at, by }`.
  - `function itemInfoW(items, c)` = `verify.withWts(data.itemInfo(items), c.S.unitWeights)`. It's used by `scanRows`, `item_lookup` and (Task 6) `bolData`.
  - `scanRows(...)` output adds `max`, `over`, `atLeast` from `verify.overweight(w.total, w.noWeight, core.maxTruckLb(c.S))`.
  - `item_lookup` items add `lb` (number|null) and `type` ('CYL'|'PCS'|'').

- [ ] **Step 1: Write failing tests** (use `scanSetup()`, then delete item 11's NetSuite weight so only the upload counts):
  - `weights: preview counts added/changed/removed and save replaces the table`:
    - Save `[['YSN201',18,'CYL'],['YSN301',25,'']]` → `weights_list` rows `[{sku:'YSN201',lb:18,type:'CYL'},{sku:'YSN301',lb:25,type:'PCS'}]`, `by` 'Miguel'.
    - Then preview `[['ysn201','19','CYL'],['YSN100',70,'CYL']]` → `added` 1, `changed` 1, `removed` 1.
  - `weights: managers only, and an all-bad file saves nothing`:
    - The floor (`mgr=false`) on any of the three actions → `/Managers only/`.
    - `weights_save` with `[['NOPE',1,'']]` → `/Nothing to save/`, and the settings are unchanged.
  - `weights: Verify uses the uploaded weight, tare 35, and warns over 45,000 lb`:
    - Upload YSN201 = 18. A 2-pallet truck (240 pcs) → `scan.total` 4390 (240×18 + 2×35), `over` false.
    - Then set `maxTruckLb` 4000 in `ctx.data.db.settings` → `over` true.
    - Clear the weights → `atLeast` true, `total` 70.
  - `weights: item_lookup shows the portal weight and type`: YSN201 → `lb` 18, `type` 'CYL'.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement the actions and the overlay. Preview and save share one `weightRows(a, c)` helper that maps `a.rows` with `data.skuMap()` through `core.buildWeightImport`.
- [ ] **Step 4:** Run all → PASS.
- [ ] **Step 5:** Commit `feat(weights): weights_preview/save/list; Verify and item search use portal weights; 45k warning data`.

### Task 3: Weights in the UI

**Files:**
- Modify: `move_portal/move_ui.js`:
  - Labels tab mount (~985): add a `lb_weights` box and `labelWeights(box)`, next to `labelUpload`.
  - `scanTable` (~517): the overweight banner.
  - Item search result (`pickItem` / `skuSearch`, ~350-376): show the weight.
- Test: `move_portal/test/ui.test.js`.

**Interfaces:**
- Consumes: Task 2 actions and fields; the existing `readSheet(file)` / `mapRows` / `csvObjs` / `loadXlsx` helpers (~1095-1118).
- Produces:
  - **Weights card** ("Unit weights"):
    - Status line "N SKUs with a weight · uploaded <at> by <by>".
    - File input (.xlsx/.csv) → `api('weights_preview', {rows})`, which shows "✅ N rows · +added · changed · −removed", then errors and unknown SKUs as a list.
    - **Save weights** button → `api('weights_save')`.
    - **Download current weights** builds a CSV `SKU,Unit weight (lb),Type` from `weights_list` (Blob download).
  - **Banner:** `scanTable(sc)` prints `flash('amber', '⚠ Over ' + num(sc.max) + ' lb: ' + (sc.atLeast ? 'at least ' : '') + num(sc.total) + ' lb')` when `sc.over`. Otherwise, when `sc.atLeast`, it prints a muted line "Total is at least N lb: X SKUs have no weight". This shows on floor and manager alike, since `scanTable` is shared.
  - The ship-confirm card (`shipConfirmCard`, ~1312) repeats the banner when `x.scan && x.scan.over`.

- [ ] **Step 1: Write failing test** `ui: weights card, overweight banner and weight in item search exist`: the client source contains `api('weights_preview'`, `api('weights_save'`, `api('weights_list'`, `'Unit weights'`, `'⚠ Over '`, `'at least '`, `'Download current weights'`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. The CSV download uses `URL.createObjectURL(new Blob([csv], {type:'text/csv'}))`.
- [ ] **Step 4:** Run all → PASS. Then open the local beta (`move-preview` launch config): upload a 2-row CSV, Save, start a truck, and see the weight and banner after setting `maxTruckLb` low in `local/store.json`.
- [ ] **Step 5:** Commit `feat(weights): Unit weights card, overweight banner, weight in item search`.

### Task 4: The combined weights workbook (data deliverable)

**Files:**
- Create: `tools/build_unit_weights.py`, moved from `docs/superpowers/drafts/2026-10-19-build-unit-weights.py` (delete the draft).
- Output (not committed, product data): `G:\My Drive\Move-portal\weights\Unit weights 2026-10-19.xlsx`. Add `weights/` to `.gitignore`.

**Interfaces:**
- Args: `main.xlsx matrix.xlsx onhand.json out.xlsx`. `onhand.json` is `[{sku, descr, onhand}]` (live SuiteQL, the query in the next-version plan).
- **Unit weights** sheet columns, in this order: `SKU | Unit weight (lb) | Type | Source | Description | Pallet qty | Pallet weight (lb) | Riverside on hand`. The first three columns are exactly what `weights_preview` reads.
- **Notes** sheet: cell `B3` labeled "Pallet tare (lb)" = 35. Pallet-derived weights are `=ROUND((G{r}-Notes!$B$3)/F{r},2)`.
- **Type:** from the Main section header rows (col B text, col C blank). Cylinder sections → CYL (names containing CYLINDER, TANK, ASME, FORKLIFT, REFRIGERANT); all else PCS. Variants copy their base's Type.

- [ ] **Step 1:** Make the three script changes (tare cell, Type column, on-hand from JSON). Pull live on-hand into `onhand.json` with the prod SuiteQL connector.
- [ ] **Step 2:** Run the script, then the xlsx skill's `recalc.py` → `status: success`, 0 errors.
- [ ] **Step 3:** Spot-check that YSN201 = 18 CYL, YSN401 = 34 CYL, KT12ACR-2 = (1287−35)/360 = 3.48 PCS, and YSN201-AG = 18 (from base).
- [ ] **Step 4:** Commit the script and `.gitignore` (`chore(weights): unit weights workbook builder`). Send the workbook to Jack for review. Don't upload it to the portal before he approves.

### Task 5: BOL rules and template (pure)

**Files:**
- Modify: `move_portal/move_verify.js`: add `bolPlan` (from the draft patch); export.
- Modify: `move_portal/move_label_template.js`: add `bolXml` (from the draft patch) with the additions below; export.
- Modify: `move_portal/move_data.js`: add `locationAddresses` (from the draft patch); export.
- Modify: `move_portal/test/fake_data.js`: `locationAddresses` (from the draft patch).
- Test: `move_portal/test/verify.test.js`, `move_portal/test/template.test.js`.

**Interfaces:**
- Produces:
  - `verify.bolPlan({pallets, info, tare}) → { lines: [{item, sku, desc, units, pcs, type:'CYL'|'PCS', hm, lbs|null}], units, pcs, lbs|null, missing: string[] }` (draft body; `info` comes from `withWts`).
  - `tpl.bolXml(b)`, where `b = { date, bolNo, rev, planOnly, from:{name,addr,csz}, to:{…}, carrier, trailer, seal, ifNums, plan }`. Additions to the draft:
    - the top-right reads `Page 1 · REV <rev>` when rev > 1;
    - when `planOnly`, a `<p>` "PLAN ONLY: no TO in NetSuite (writes are off)" goes under the title, and BOL # prints "—".
  - `data.locationAddresses(ids) → {id: {name, addr, city, state, zip}}`.

- [ ] **Step 1: Write failing tests**
  - `bolPlan: one handling unit per pallet on its first SKU; weight = pcs × lb + units × 35`:
    - Pallets: 2 × `[{item:'11',pcs:60}]`, plus one mixed `[{item:'12',pcs:24},{item:'11',pcs:12}]`.
    - info: 11 = YSN201 18 lb cyl; 12 = YSN301 25 lb cyl; tare 35.
    - Expect YSN201: units 2, pcs 132, lbs 132×18 + 2×35 = 2446. YSN301: units 1, pcs 24, lbs 24×25 + 35 = 635.
    - Totals: units 3, pcs 156, lbs 3081.
  - `bolPlan: a SKU without a weight blanks the grand total and is listed` → `lbs` null, `missing` `['X']`.
  - `template.test.js` `bolXml fills the VICS boxes`: XML contains `BILL OF LADING`, `TO11702`, `ArcBest`, `537224`, `#IF54012`, `CUSTOMER ORDER INFORMATION`, `CARRIER INFORMATION`, `CYL`, `>X<`, the total `3,081`; `rev:2` → `REV 2`; `planOnly:true` → `PLAN ONLY`; a `&` in a description is escaped.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run all → PASS.
- [ ] **Step 5:** Commit `feat(bol): BOL plan, VICS template, location addresses`.

### Task 6: BOL on the server, plus the ArcBest carrier

**Files:**
- Modify: `move_portal/sl_move_portal.js`:
  - `bolData(x, c)`, `act('bol_data', true)`, the `bol` route in `onRequest` (~2349) next to `pdf`, and `function bolPdf(ctx)`;
  - `reApproveDocs` (~1428) bumps `bolRev`;
  - `'Armstrong Group'` → `'ArcBest'` at ~213, ~711, ~1380.
- Modify: `move_portal/test/preview_server.js:33` seed carrier `'ArcBest'`; `test/portal.test.js` / `test/ui.test.js` expectations `'Armstrong Group'` → `'ArcBest'`.
- Test: `move_portal/test/portal.test.js`.

**Interfaces:**
- Consumes: Task 5; Task 2 `itemInfoW`.
- Produces:
  - `bolData(x, c) → b` (the Task 5 shape). Field sources:
    - `date` = `depart.day` as MM/DD/YYYY (else today);
    - `bolNo` = `d.toNum` or '—'; `planOnly` = `!d.toId`; `rev` = `d.bolRev || 1`;
    - `from`/`to` = `c.S.bolName || 'YSN IMPORTS'` + `locationAddresses([locFrom, locTo])`, with csz `"City, ST Zip"`;
    - `carrier` = `(d.depart||{}).carrier || c.S.defaultCarrier || 'ArcBest'`; `trailer` = `d.trailer`; `seal` = `(d.depart||{}).seal || ''`;
    - `ifNums` = the distinct IF numbers in `d.docLines` (main + add-ons), else `d.ifNum`;
    - `plan` = `verify.bolPlan({ pallets: loaded pallets (at dock) or shipped pallets (after pickup), info: itemInfoW(items, c), tare: core.palletTare(c.S) })`.
  - Refused before docs: a status other than at_dock / pickup_pending / departed / receiving / received → userErr "The BOL prints after Approve docs".
  - `act('bol_data', true, {truckId}) → { bol: b }`.
  - Route `?action=bol&truckId=N` → `bolPdf(ctx)`:
    - Floor deployment or not a manager → writes `Managers only`.
    - Otherwise `render.xmlToPdf({ xmlString: tpl.bolXml(bolData(...)) })`, `writeFile(..., isInline: true)`.
    - A userErr writes its message as text.
  - `reApproveDocs`: when `delta` is non-empty, write `bolRev: (d0.bolRev || 1) + 1` with the at-dock update. Its return adds `bolRev`.

- [ ] **Step 1: Write failing tests**
  - `bol: data for an at-dock truck`:
    - `atDock(ctx, 2)` with portal weight YSN201 = 18 CYL (via `weights_save`).
    - Expect `bolNo` = `d.toNum`, `planOnly` false, `rev` 1, `carrier` 'ArcBest', `seal` '', and `plan.lines[0]` `{sku:'YSN201', units:2, pcs:240, type:'CYL', hm:true, lbs:240×18+70}`.
  - `bol: refused before Approve docs and for the floor`: a loading truck → `/after Approve docs/`; `mgr=false` → `/Managers only/`.
  - `bol: plan only when writes are off`: `atDock` with writeMode 'off' → `planOnly` true, `bolNo` '—'.
  - `bol: a re-approve that changes quantities bumps the REV`:
    - At dock, then `dock_sendback`, take a pallet off, then `ship_mark` + `ship_confirm`.
    - `bol_data` → `rev` 2. A re-approve with no change keeps 2.
  - `bol: the seal shows once saved`: `dock_seal` 1846 → `bol_data` seal '1846'.
  - `carrier: the default is ArcBest`: `truck_planned` → `carrier` 'ArcBest'.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement. Keep the new key `bolRev` separate from the office-IF flow's existing `data.bol` (the "Reprint BOL REV 2" text); don't reuse `data.bol`.
- [ ] **Step 4:** Run all → PASS.
- [ ] **Step 5:** Commit `feat(bol): bol_data + PDF route, REV on re-approve; default carrier ArcBest`.

### Task 7: BOL in the UI, plus a beta stand-in

**Files:**
- Modify: `move_portal/move_ui.js`:
  - `ACT` handler for ship_confirm (~1466-1482): auto-open;
  - `dockCard` (~910), `pickupCard` (~1436) and the manager pop-up `ACT.opentruck` (~1525): a 🖨 Print BOL button;
  - a `bolUrl(id)` helper next to `pdfUrl` (~99).
- Create: `move_portal/local/bol_html.js`: `bolHtml(b)`, a printable Letter HTML version of the same boxes for the local beta.
- Modify: `move_portal/test/preview_server.js`: route `action === 'bol'` → `bolHtml(sl._runAction('bol_data', {truckId}, true).bol)` (manager deployment only).
- Test: `move_portal/test/ui.test.js`, plus a small `move_portal/test/bol_html.test.js`.

**Interfaces:**
- Consumes: the Task 6 route and `bol_data`; `r.atDock`, `r.rewritten`, `r.toNum` from `ship_confirm`.
- Produces:
  - `bolUrl(id) = B.url + '&action=bol&truckId=' + encodeURIComponent(id)`.
  - **Auto-open:** in the Approve click handler, `const w = window.open('', '_blank')` runs **before** `await api('ship_confirm'…)`. Then:
    - on an `r.atDock` success, `w.location = bolUrl(id)`, and the message gains "🧾 BOL opened in a new tab" plus a Print BOL button;
    - on a failure, a needsFix or a non-scan response, `w.close()`;
    - if `w` is null (blocked), the message says "Pop-ups are blocked: press Print BOL".
  - The re-approve message says "🧾 BOL REV <r.bolRev> opened: throw away the old copy".
  - **Print BOL button:** `<button class="dbtn gh" data-act="printbol" data-id=…>🖨 Print BOL</button>`; `ACT.printbol = el => window.open(bolUrl(el.dataset.id), '_blank')`.

- [ ] **Step 1: Write failing tests**
  - `ui.test.js` `ui: BOL opens in a new tab from Approve and Print BOL`:
    - The source contains `'&action=bol&truckId='`, `ACT.printbol`, `'Print BOL'`, `'BOL opened in a new tab'`, `'Pop-ups are blocked'`.
    - In the ship-confirm handler's text, `window.open('', '_blank')` comes before `await api('ship_confirm'`.
  - `bol_html.test.js`: `bolHtml(b)` contains `BILL OF LADING`, the BOL #, `ArcBest` and the grand total, and escapes `<`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run all → PASS. Then the beta: approve a scan truck in `on`; a tab opens with the BOL. Send back, change the load, re-approve → REV 2 opens.
- [ ] **Step 5:** Commit `feat(bol): auto-open BOL after Approve docs, Print BOL buttons, beta HTML stand-in`.

### Task 8: Delete a truck (server)

**Files:**
- Modify: `move_portal/move_tx.js`: `ifExists(ifId)`; export.
- Modify: `move_portal/test/fake_tx.js`: `ifExists`, with `t.deletedIfs` set by a test helper.
- Modify: `move_portal/sl_move_portal.js`:
  - `const DELETED = 'deleted'` (NOT added to `verify.TRUCK`, so `allTrucks()` and every list skip deleted trucks);
  - `act('truck_delete', true, …)`;
  - `report` history includes `data.loadsByStatus([DELETED])` with stage 'Deleted';
  - `truck_get` works on a deleted truck (read-only view).
- Test: `move_portal/test/portal.test.js`.

**Interfaces:**
- Produces:
  - `tx.ifExists(ifId) → boolean`: `record.load` ITEM_FULFILLMENT. A `RCRD_DSNT_EXIST` error → false; other errors rethrow.
  - `act('truck_delete', true, {truckId, reason})`:
    - **Reason:** required, trimmed, max 300 → otherwise "Enter a reason (300 characters max)".
    - **Allowed statuses:** loading, needs_fix, ready, ship_pending, at_dock, pickup_pending.
    - **Refused:**
      - `departing` → "Docs are being written: Release it first".
      - departed / receiving / approving / received → "Already shipped: it can't be deleted".
      - Mid-pickup (any `if_stamp:` write landed or any pallet in transit; reuse the dock edits' half-done check) → "Pickup is half done: finish it or mark it picked up without NetSuite".
      - A live claim (`claim` set and not `stale`) → the usual "already being processed" message.
    - **NetSuite guard** (scan trucks with `d.toId`): for every IF id in `d.ifId` + `d.docLines[*].ifId`, `tx.ifExists` must be false, and `tx.toClosed(d.toId)` must be true. Otherwise throw userErr `'Delete ' + [IF nums still there].join(', ') + (TO open ? ' and close ' + toNum : '') + ' in NetSuite first, then press Delete again.'` (or just the close-TO part when only the TO is open).
    - **Effect:**
      - every pallet `palletsByLoad(id, [VP.LOADED])` → `{status: VP.LABELED, load: ''}`;
      - truck → `{status: DELETED, data: {deleted: {by: c.user, actor: c.actor, at: c.now.stamp, reason, toNum: d.toNum||'', ifNums}, claim: '', lastStep: stepOf('deleted', c)}}`.
    - Returns `{ deleted: true, pallets: n }`.
  - **Floor actions** on a deleted truck (`truck_scan`, `truck_remove`, `ship_mark`, …) are refused with "This truck was deleted": add the check where `mustTruck` / `mustOpenTruck` resolve.

- [ ] **Step 1: Write failing tests**
  - `delete: a loading truck: pallets back to labeled, hidden from lists, kept in history`:
    - `scanTruck(ctx,2)` → `truck_delete` with a reason.
    - Both pallets are `labeled` with no load.
    - `truck_planned().open` doesn't list it, and its trailer is offered again.
    - `dashboard().rows` has none for it. `report().history` row: `stage` 'Deleted', `status` 'deleted'.
  - `delete: reason required and managers only` → `/Enter a reason/`, `/Managers only/`.
  - `delete: refused while docs are writing and after shipping`: a departing truck → `/Release it first/`; a departed one → `/Already shipped/`.
  - `delete: at the dock it waits for the office to delete the IF and close the TO`:
    - `atDock` → expect `/Delete IF.* and close TO.* in NetSuite first/`.
    - Mark the IF deleted in fake_tx → `/close TO/` only.
    - Close the TO → it deletes.
    - `tx._t.ops` has no new write ops.
  - `delete: a plan-only at-dock truck (writes off, no TO) deletes at once`.
  - `delete: the floor's next scan on a deleted truck is refused` → `/This truck was deleted/`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run all → PASS.
- [ ] **Step 5:** Commit `feat(trucks): manager delete truck (pallets back, record kept, NetSuite cleanup guard)`.

### Task 9: Delete a truck (UI)

**Files:**
- Modify: `move_portal/move_ui.js`:
  - `ACT.opentruck` pop-up buttons row (~1546): 🗑 Delete truck for the allowed statuses;
  - `dockCard` (~910): the same button;
  - `histTable` / `statusPill`: a grey "Deleted" pill;
  - the pop-up shows "Deleted by <by> <at> · <reason>" for a deleted truck.
- Test: `move_portal/test/ui.test.js`.

**Interfaces:**
- `ACT.deltruck`:
  - `prompt('Reason for deleting <label> (required)')`; empty → `errBox('Enter a reason')`.
  - `confirm('Delete <label>? Its pallets go back to labeled. NetSuite is not changed.')`.
  - Then `api('truck_delete', {truckId, reason})` → `flash('green', '🗑 <label> deleted · <n> pallets back to labeled')` or `errBox(r.error)` (the NetSuite cleanup message shows as-is).
  - After either, refresh the screen the button came from.

- [ ] **Step 1: Write failing test** `ui: delete truck button, prompt and Deleted pill`: the source contains `api('truck_delete'`, `ACT.deltruck`, `'Delete truck'`, `'pallets go back to labeled'`, `deleted:`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run all → PASS. Beta: delete a loading truck, then an at-dock truck in `off`.
- [ ] **Step 5:** Commit `feat(trucks): Delete truck in the manager pop-up and dock card; Deleted in history`.

### Task 10: Trailers editor (server + UI)

**Files:**
- Modify: `move_portal/sl_move_portal.js`: `act('trailers_list', true)`, `act('trailers_save', true)`.
- Modify: `move_portal/move_ui.js`: Labels tab `lb_trailers` box with `labelTrailers(box)`.
- Test: `move_portal/test/portal.test.js` (next to the trailer tests ~1872/~1966), `move_portal/test/ui.test.js`.

**Interfaces:**
- `trailers_list` → `{ trailers: (c.S.trailers || DEFAULT_TRAILERS), busy: [normTrailer of trailers on TRAILER_BUSY trucks] }`.
- `trailers_save {trailers: string[]}`:
  - trim each; drop blanks;
  - reject a length over 20 ("Trailer # too long (20 characters max)") and duplicates by `normTrailer` ("<t> is listed twice");
  - max 100 entries;
  - saves `{trailers}`; returns `{ trailers, removedBusy: [removed ones still on an open truck] }`. That's a warning only: the truck keeps its trailer.
- **UI:** the list with an ✕ per trailer, an input + Add, and Save. When the response has `removedBusy`, show the amber "Still on an open truck: …".

- [ ] **Step 1: Write failing tests**
  - `trailers: save trims, refuses duplicates and long numbers, and the floor list follows`:
    - Save `[' 900100 ','537224']` → `truck_planned().trailers` equals `['900100','537224']` minus busy ones.
    - `['A','a']` → `/listed twice/`; a 21-char one → `/too long/`.
    - The floor → `/Managers only/`.
  - `trailers: removing a trailer an open truck uses warns but keeps the truck`.
  - `ui.test.js`: the source contains `api('trailers_save'`, `api('trailers_list'`, `'Trailers'`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run all → PASS.
- [ ] **Step 5:** Commit `feat(trailers): manager Trailers editor`.

### Task 11: Wrap-up (docs + beta click-through)

**Files:**
- Modify: `CLAUDE.md`: the next-version section becomes "BUILT (not uploaded)", with the test count, the commit range and the rollout list below.
- Modify: `docs/superpowers/plans/2026-10-19-move-portal-next-version.md`: mark it built.

- [ ] **Step 1:** Run `node --test "move_portal/test/*.test.js"` → all pass. Record the count.
- [ ] **Step 2:** Beta click-through in this order:
  1. Upload weights; verify a truck with a low `maxTruckLb` → banner.
  2. Approve → the BOL tab opens.
  3. Send back, take a pallet off, re-approve → REV 2.
  4. Save the seal, then Print BOL → the seal shows.
  5. Delete a loading truck.
  6. Add and remove a trailer.
  Record what passed.
- [ ] **Step 3:** Commit `docs: next version built (not uploaded)`. Push.

## Rollout (after the build, each upload with Jack's OK)
1. **Sandbox:** upload over the same File Cabinet ids: core, verify, data 2055085, tx 2055087, label_template 2055086, ui 2055088, sl 2055089. Look up the core/verify ids in CLAUDE.md. Recompile script 893, then smoke test.
2. **Prod:** upload over the ids core 3050378, verify 3050380, data 3050483, tx 3050484, label_template 3050485, ui 3050486, sl 3050487. Recompile script 1166. Then the Move Settings row 1 changes, which need Jack's OK:
   - `palletTare` 35, `maxTruckLb` 45000, `bolName` "YSN IMPORTS";
   - **`defaultCarrier` "ArcBest"**: prod has "Armstrong Group" saved, which overrides the code fallback.
3. Upload the approved weights workbook through the Unit weights card. Check one real truck's Verify weight and BOL against its scale ticket.
