# Move Portal — printed VICS Bill of Lading (2026-10-18) · PLAN ONLY, NOT BUILT

**Status: planning only.** Jack (2026-10-18): don't write this into the code yet, so nothing that works now gets disturbed. A draft patch from an interrupted start is kept at `docs/superpowers/drafts/2026-10-18-bol-draft.patch`. It is reference only, is not applied, and does not include the server or UI parts.

## Goal
Today the BOL is not in NetSuite; it's filled out by hand on the VICS standard form (sample: `20261005163815399.pdf`, TO11678). The portal should print a filled VICS BOL that the **manager prints at Approve docs** and hands to the driver.

## Jack's rulings
- **When:** printed at **Approve docs**, so it can be handed to the driver. The seal isn't known yet at that point, so its box prints blank and gets written in by hand (as on the sample). A reprint later picks up the seal once it's saved.
- **Who:** the **manager** prints it.
- **Commodity description:** the SKU description from NetSuite.
- **Weight:** **unit weight × pieces + pallet tare per handling unit.** The sample works out to exactly 18 lb × 2,304 + 27 lb × 32 = 42,336.
- **Weight source:** from the **Capacity Builder**, which feeds the Move Tracker, loaded into the portal by an **Excel/CSV upload**. No new NetSuite fields.
- **H.M. and package type:** cylinders get **H.M. X and CYL**. Accessories get a blank H.M. and **PCS**.

## Where every box comes from

| BOL box | Source |
|---|---|
| Date | Docs-approval day (`depart.day`), printed MM/DD/YYYY |
| Ship From / Ship To | Name = settings `bolName` (default "YSN IMPORTS"); street, city, state and zip read from the NetSuite Location records (`locFrom` / `locTo`) |
| Bill of Lading Number | TO # (`toNum`), same as the sample |
| Carrier / Trailer / Seal | `depart.carrier`, the trailer, and `depart.seal` (blank until it's saved at the dock) |
| Freight terms | Prepaid ✕, fixed |
| Customer order rows | # PKGS = pallets; weight total; Pallet = Y; additional info = `#IF…` on one row and the SKU list on the next |
| Carrier info | One row per SKU: handling units (PLT), pieces (CYL/PCS), weight, H.M. X for cylinders, SKU description; then a grand total |
| SID / CID / SCAC / Pro # / NMFC / Class / COD / signatures | Left blank, the same as the sample |

## Weight math
- **Unit weight:** the uploaded weight for that SKU wins. If there isn't one, the NetSuite item weight is used. In prod that field is empty today, so the upload is what makes weights work.
- **Handling units:** each pallet is counted once, on the SKU of its first line, so the line counts add up to the pallet count.
- **Line weight** = pieces × unit weight + handling units × `palletTare` (a Move setting, **45 lb today; the sample implies 27**, which Jack should confirm and set).
- **Missing weight:** a SKU with no weight prints a blank weight, the grand total prints blank, and a footnote lists the SKUs. A blank is safer on a legal shipping document than a wrong total.
- **Same weights elsewhere:** the manager View load pop-up and the floor weight table would use the same uploaded weights.

## ⚠ Weight data to settle before building
- Capacity Builder `weightPerUnit` for YSN201 is **19.8 lb**, and its pallet data gives 1,185 lb ÷ 60 = 19.75. The sample BOL used **18 lb**. Whichever number goes in the upload is what prints. The 18 → 19.8 difference adds about 4,100 lb on a 2,304-cylinder load, which matters against the 42,000 lb truck limit.
- The first upload file can be generated from the Capacity Builder data:
  - unit weight = `weightPerUnit` (container data), else pallet weight ÷ units per pallet;
  - Type = CYL for the tank/cylinder group.

  Jack reviews it before it goes in.

## Pieces to build (when approved)
1. `move_core.buildWeightImport(rows, skuMap)`: reads the CSV columns SKU, Unit weight (lb), Type (CYL/PCS, blank = PCS). It checks each row and returns the weights `{SKU: [lb, cyl]}`, errors, and any unknown SKUs.
2. `move_verify.withWts(info, wts)` and `move_verify.bolPlan({pallets, info, tare})`: pure functions, unit-tested.
3. `move_label_template.bolXml(b)`: one Letter page in the VICS layout, using the BFO renderer already used for labels.
4. `move_data.locationAddresses(ids)`: reads the Location records' address fields. A failed read prints blanks.
5. **Server:**
   - `weights_import` (preview, then commit, saved in the Move Settings JSON as `itemWts`, with who and when);
   - `weights_list`;
   - `bol_data`;
   - a new `?action=bol&truckId=` route that streams the PDF, manager only.
6. **UI (manager):**
   - **🖨 Print BOL** on the Approve docs success message, the At-the-dock cards, the pickup cards, and the View load pop-up.
   - A **BOL weights** section on the Labels tab: CSV upload, preview, save, and a download of the current list.
7. **Tests** for each pure piece and each action. Then the local beta, then the sandbox.

**Files touched:** `move_core`, `move_verify`, `move_label_template`, `move_data`, `sl_move_portal`, `move_ui`. Three of these aren't in today's sandbox upload list, so their File Cabinet ids need looking up: `move_core`, `move_label_template`, `move_data`.

## Open questions for Jack
1. Unit weights: use the Capacity Builder's 19.8 lb for YSN201, or correct it to the 18 lb that's on the real BOL? This applies to every SKU in the upload.
2. Pallet tare: keep 45 lb, or change it to 27 lb to match the sample?
3. Should a re-approve after a Send back reprint automatically (the quantities change), or only when the manager presses Print BOL again?
