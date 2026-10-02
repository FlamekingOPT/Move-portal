# CLAUDE.md — Move Portal

A NetSuite Suitelet for the **Riverside → Tippecanoe inventory move**. The target is Nov 15, a Sunday, so the last move day is Sat Nov 14; move days are Mon–Sat. It's a separate app from the picker portal (which lives in `FlamekingOPT/netsuite-picker-portal`, folder `G:\My Drive\Netsuite OPT`). The picker portal is untouched.

## Where things live
- **Repo:** https://github.com/FlamekingOPT/Move-portal (branch `main`).
- **Working copy:** `G:\My Drive\Move-portal`, reachable from both the desktop and the laptop. GitHub is the sync point: `git pull` before you start and `git push` when you're done, so the two machines don't fight over Drive sync.
- The old laptop worktree `C:/Users/Jack/wt/move-portal` (branch `feat/move-portal` in the Netsuite OPT repo) is **retired**. Don't commit there.
- History was split out of the Netsuite OPT repo on 2026-09-28. Commit hashes quoted in the ledger and older handoffs are from that repo and **won't match** hashes here; match by commit message.

## Files
- `move_portal/`: `move_core`, `move_label_template`, `move_data`, `move_tx`, `move_ui`, `sl_move_portal`, `label_tester.html`.
- `move_portal/test/`: node tests with in-memory fakes, plus `preview_server.js`, a local preview on port 8765 (launch config `move-preview`; pass the `floor` arg for the picker view).
- **Tests:** `node --test "move_portal/test/*.test.js"` → **62/62 pass**. A bare folder path fails on Windows.
- **Spec:** `docs/superpowers/specs/2026-09-27-move-portal-design.md`. **D2 is SUPERSEDED** by `docs/superpowers/specs/2026-09-28-move-portal-bulk-to-design.md`.
- **Plan:** `docs/superpowers/plans/2026-09-27-move-portal.md` (Tasks 0–15).
- **Mockup:** `docs/mockups/2026-09-27 move portal mockup.html`.
- **SDD ledger, with every ruling:** `docs/sdd-ledger/progress.md`, plus the task briefs and reports. The review diffs were left out (the history covers them).

## 🧭 READ FIRST — HANDOFF (2026-10-01): REDESIGN, PORTAL = VERIFICATION ONLY · ⏭ NEXT = WRITE SPEC, THEN PLAN, THEN LOCAL BETA
This **supersedes** both the original design and the bulk-TO amendment (2026-09-28). Brainstorm decisions below are Jack's, confirmed 2026-10-01. No code has changed yet.

**Process (what really happens today, from real prod data + BOL photos):**
- Office creates the TO (1 per SKU), the **IF ahead of time (status Packed)**, and a VICS BOL. Today's BOL # = the TO # (not unique), "Additional shipper info" = the IF #. 1 BOL = 1 IF.
- The floor hand-writes "Truck #N" + date, trailer #, seal #, departure time and carrier (Armstrong Group) on the BOL.
- The office types trailer → **Container Number** (`custbody_rsm_container_no`) and `SEAL: <n>` → **Master BOL Number** (probably `custbody7`, ⚠ confirm) on the **Item Receipt** at Tippecanoe.
- Real data: the only Riverside move IFs so far are 17 on **TO11663 / YSN100**, created by Cesar Uicab. **42 pallets × 12 = 504 per truck.** No truck id on any IF. 30 more IFs to Tippecanoe are import containers from In-Transit California (Sherylle); the tracker already excludes them (it filters ship-from = Riverside).
- The tracker artifact (https://claude.ai/artifact/WP1LLc7kJ6Jb8kJXvzYTkG) now links each receipt to its IF via `PreviousTransactionLink` linktype `TOrdCost` (FIFO only as a `*` fallback). 1 receipt = 1 IF.

**New design (decided):**
1. **Office keeps building the TO + IF (Packed) + BOL.** Each Packed IF on a move TO = a planned truck in the portal. The portal does NOT build TOs/IFs for planned trucks.
2. **Labels:** unique serial + SKU + units (`PLT<serial>⇥SKU⇥pcs`), **no IF on the label**. The scan at the dock ties a pallet to an IF. Duplicate scans are caught.
3. **Loading:** scans verify against the IF lines (expected vs scanned pallets).
4. **Seal entered at departure (Riverside)** assigns **Truck # of the day**, stamps trailer + seal + time on every IF on the truck (same 2 fields the office uses), and marks them Shipped. All NetSuite writes happen at that one confirm, never per scan.
5. **Corrections (option C):** short → lower the IF qty (manager OK). Over, same SKU → raise the IF if the TO has qty left. Extra SKU → **add-on IF** from its oldest open office TO, on the same truck/seal. The BOL gets reprinted listing all IFs.
6. **Unload at Tippecanoe:** scan every pallet; receipt per IF for the scanned qty, with trailer/seal copied; missing serials stay in transit; pallets that were never loaded get flagged.
7. **Tracker counts trucks by distinct seal** (fallback 1 IF = 1 truck). Needs a small tracker update later.
8. **Beta = option 4:** the real Suitelet with `WRITE_MODE='off'`. No writes to IFs/TOs/receipts; it writes only its own custom records (labels, scans, trucks) plus a saved **"would write" plan**. The floor uses a no-login URL (like the picker portal). It runs on **prod data**; the sandbox is skipped.
9. **Build it locally first:** the local preview server + a **prod snapshot JSON** (pulled read-only via the SuiteQL connector) + a local scans store, then a shadow-compare report (plan vs what the office actually did in NetSuite). Same code as the Suitelet; only the data layer swaps. Optional: floor scanners hit `http://<pc>:8765` over wifi.

**Still open:** an extra SKU with no open office TO (overflow TO vs block the scan); confirm `custbody7` = Master BOL Number; BOL # on a reprint.

**Mockups:**
- `docs/mockups/2026-10-01 move portal v3 verification mockup.html` (current; also live at https://claude.ai/artifact/5W7K931oFEMdzTKoq62fNV)
- `docs/mockups/2026-10-01 move portal v2 mockup.html` (superseded: build-the-IF model)
- ⚠ The Claude app's file viewer doesn't run page scripts. Open mockups in Chrome or serve them (`python -m http.server` in docs/mockups).

**⏭ NEXT:** write the spec `docs/superpowers/specs/2026-10-01-move-portal-verification-design.md` (superpowers:brainstorming, final steps), get Jack's review, then superpowers:writing-plans, then build the local beta. Kept from the old code: label template, QR payload, test harness, preview server. Replaced: load/claim/bulk-TO/IF-building logic.

## (superseded) 🧭 SANDBOX DEPLOY DONE (2026-09-28, Task 13 steps 1–4)
- **Move Settings row 1:** `labelCode` = `qr`, `start` = **2026-09-30** (first move day, per Jack).
- **File Cabinet** `SuiteScripts/MovePortal` = folder **331983**: move_core **2055084**, move_data **2055085**, move_label_template **2055086**, move_tx **2055087**, move_ui **2055088**, sl_move_portal **2055089**.
- **Script** `customscript_move_portal` = id **893** (Suitelet, API 2.1). **Deployment** `customdeploy_move_portal` = id **2771**: Testing (owner-only), Execute As Current Role, audience Administrator, log Debug.
- **URL:** `https://8211645-sb1.app.netsuite.com/app/site/hosting/scriptlet.nl?script=893&deploy=1`
- **Verified:** the page loads in manager view with no console errors (so `clientMain.toString()` works under GraalJS). `item_lookup` YSN201 returns on-hand 181,918 at Riverside. `dashboard` works (42 move days left).
- **⏭ Next:** Jack prints 1–2 **Custom** labels from "Print a SKU" to the 4×6 printer and scans one. That checks the BFO PDF, the QR code and the page size. No configs are loaded (0 rows), so Custom is the only option.
- **Upload gotcha:** the File Cabinet and Deployment Save buttons ignore automation clicks about half the time. `document.querySelector('#btn_multibutton_submitter').click()` works. Fix the Folder with `nlapiSetFieldValue('folder', <id>)`, because it defaults to the last-used folder.

## 🧭 READ FIRST — HANDOFF (2026-09-28, latest): DESIGN CHANGED, NEXT = IMPLEMENTATION PLAN
**New design (spec written; no code changed yet):**
- The office creates **1 transfer order per SKU** by hand.
- **1 truck = N item fulfillments** against those TOs.
- Anything scanned that no office TO covers goes on **1 overflow TO**, created at Approve & Ship.

**⏭ Next:** write the implementation plan for the bulk-TO design (superpowers:writing-plans), then build it. It replaces the "1 truck = 1 TO = 1 IF" logic in Approve & Ship and Approve Receipt. Task 13 sandbox deploy should wait until this is built, or deploy the current code only as a smoke test.

## Earlier handoff (2026-09-28): code complete + reviewed, sandbox setup done
- All batches passed task review. The final opus review's I1–I4 were fixed ("final-review wave" commit) and re-reviewed clean.

**Key decisions (original design):**
- Claim-token compare-and-set on ship and receive; `STALE_MS` = 10 min.
- An orphaned TO is adopted by memo token `[mv:<loadId>:<kind>]`.
- Undo is blocked while a receipt is pinned.
- Catch-up loads are kept out of the outbound screens.
- **QR code only on labels (Jack).** Payload `PLT<id>⇥SKU⇥pcs`, with every line for mixed pallets. Lookups use the leading `PLT<id>`; scan inputs keep Tab.
- Deferred minors are in the ledger.

**Sandbox setup DONE (Task 0):**
- **Tippecanoe Warehouse location = id 42.** Riverside = 35 (same as prod).
- **Manual TO test:**
  - TO8719 (2587371) saved straight to Pending Fulfillment, so there's **no TO approval**.
  - IF53831 (2587372) Shipped: Riverside −1, **native in-transit**.
  - IR14492 (2587373): Tippecanoe +1.
  - `ue_if_filled_status` stamps TO lines Filled (harmless). No RSM/SPS errors.
- **Warehouse Portal Manager (2537):** Receive Order Full added; it already had TO/IF/Fulfill Full.
- **Record types:** settings 742, config 743, load 744, pallet 745, scan 746, label_req 747. **All 32 fields** have exact `custrecord_mv*` ids.
- **Move Settings row id 1:** locFrom 35, locTo 42, `start` 2026-10-01 (PLACEHOLDER; Jack to confirm), **labelCode 'both' (⚠ change to 'qr')**, toStatus B.
- **Tip:** `nlapiSetFieldValue/Text` fills NetSuite UI forms, but List/Record field forms only save on a real mouse click on Save.

**Task 13 / 14 checklist (still open):**
1. **Move Settings row 1:** set labelCode → `qr`; set start → the real first move day.
2. **Task 13:**
   - Upload the 6 files to File Cabinet `SuiteScripts/MovePortal`.
   - Create the Script with the file-first "New Script" page (not the 1.0 chooser): `customscript_move_portal`.
   - Create the deployment `customdeploy_move_portal`: Testing, Execute As Current Role, audience Admin + Warehouse Portal Manager + Portal Picker + FK WH Mgr variants.
   - Smoke test: CSV import, print PDF, scan.
3. **Task 14:** the full flow, checking inventory at each step. Also verify:
   - `clientMain.toString()` works under GraalJS;
   - BFO accepts `<body width/height>` and `&#9;` in the QR value;
   - a late 2nd receipt picks the right IF;
   - Portal Picker item search works under the location restriction;
   - a 5-line MIXED label fits one 4×6;
   - walk the docks for cell signal.
4. Prod (Task 15) only on Jack's go.

**Label tester:** `move_portal/label_tester.html`
- QR-only default, and the payload carries SKU and qty.
- **Printing only works from a real Chrome tab.**
- For a clean print: Scale **Default**, **Headers and footers off**, 4×6, margins None.
- Open question for Jack: should the tester build a true 4×6 PDF?

**Still unknown:** the scanner model, and whether it's wifi or cell.

## NetSuite accounts
- Sandbox: https://8211645-sb1.app.netsuite.com
- Production: https://8211645.app.netsuite.com
