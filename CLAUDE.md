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
