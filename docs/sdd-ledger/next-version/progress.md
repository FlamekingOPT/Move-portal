# SDD ledger — plan: docs/superpowers/plans/2026-10-19-move-portal-next-version-impl.md
Spec: docs/superpowers/plans/2026-10-19-move-portal-next-version.md + docs/superpowers/specs/2026-10-18-move-portal-bol-design.md (both reachable). Start HEAD bc3fd56, tests 430/430. Branch feat/v3-verification (working copy G:\My Drive\Move-portal, the repo's established work branch; not main).

## Pre-flight scan
| Pair / task | Produces → consumes | Found |
|---|---|---|
| T1→T2 | buildWeightImport, withWts, overweight, maxTruckLb, palletTare → weights actions, scanRows | consistent |
| T1→T5 | withWts adds cyl; bolPlan reads info.cyl/desc/sku | consistent (itemInfo carries sku/desc) |
| T2→T6 | itemInfoW(items,c) → bolData | consistent |
| T5→T6 | bolPlan / bolXml(b) shape incl. rev, planOnly → bolData | consistent |
| T6→T7 | ?action=bol route, bolRev in reApproveDocs return → auto-open message | consistent |
| T8→T9 | truck_delete, status 'deleted', data.deleted → pop-up/history UI | consistent |
| T3/T10 | both add a box to the Labels tab mount (~985) | sequential tasks, no conflict |
| T1 vs existing tests | tare 45→35 changes scan totals | T1 step 4 allows expected-number edits only |
| T6 vs existing tests | 'Armstrong Group' expectations | T6 files list covers them |
| T1 self | duplicate rows: brief says first kept + error | conflicts with next-version plan text "last wins + warning" → ruling below |
| T2 self | test numbers 4390 = 240×18+2×35; removed/added/changed counts | arithmetic checked, OK |
| T5 self | 2446 / 635 / 3081 | arithmetic checked, OK |
| T6 self | at-dock lbs 240×18+70 | OK |
| T4 | tools/ + .gitignore, independent of code | OK |
| T7 self | auto-open must precede await (Review Focus 1) | test pins it |

Ruling: duplicate SKU rows in a weights upload keep the FIRST row and report an error (draft-patch behavior), not "last wins" from the next-version plan prose — the error row makes it visible either way and the draft code is reviewed — cost if wrong: a re-upload with the duplicate removed.
Ruling: deleted trucks use status 'deleted' kept OUT of verify.TRUCK so allTrucks()/all lists skip them automatically; history reads them separately — cost if wrong: a list that should show deleted trucks needs an explicit read.

## Tasks
Ruling: scanSummary (named only in Task 1's Files list, never in Interfaces) is not built — verify.overweight covers the need and no task consumes scanSummary — cost if wrong: add a 3-line helper later.
Task 1: minor (deferred): buildWeightImport caps lb>5000 with an "above 0" message, untested (move_core.js:41)
Task 1: minor (deferred): all-empty rows give "Missing SKU" (move_core.js:38) — carried to Task 2: server drops all-empty rows before buildWeightImport
Task 1: minor (deferred): /sku/i header check could skip a data row containing "sku"; duplicate palletTare assertion in core.test
Task 1: complete (commits bc3fd56..5739512, review clean)
Task 2: minor (deferred): error row numbers count after blank-row filtering (can differ from the sheet row) — sl weightRows
Task 2: minor (deferred): weightRows(a,c) unused c; item_lookup repeats wts lookup; no mixed valid/bad save test
Task 2: complete (commits 5739512..5e9764d, review clean)
Task 3: ⚠️ resolved as real gap: shipPending item.scan is a boolean, so the ship-confirm overweight banner never shows → fix round 1 (server adds item.weight)
Task 3: fix round 1/5 (3 addressed, 0 open — ship-confirm banner via item.weight; wt_msg guard; errBox in download; commits b42cfac..80269cf)
Task 3: minor (deferred): ui tests are source-string checks only; no weight shown when scanRows throws on a ship card
Task 3: complete (commits 5e9764d..80269cf, review clean after 1 fix round)
Ruling: Task 4 workbook puts computed VALUES in "Unit weight (lb)" (col B) and the live derivation in a separate "Calc (formula)" column — the portal's SheetJS upload reads cached values only and openpyxl writes formulas without them (no LibreOffice here to recalc), so formula cells in B would upload as blanks — cost if wrong: editing the Notes tare cell won't update col B (documented on Notes; rebuild with the script instead).
Ruling: KT12ACR-2 unit weight = 2.6 (Main individual weight, rule 1) — the plan's 3.48 example was computed from the Matrix and ignored rule order — cost if wrong: one SKU 0.9 lb/unit light.
Task 4: controller-found defects → fix round 1: "Refrigerant Valves" section typed CYL (REFRIGERANT word); Pallet DIVIDER/TOPPER/LEGS item rows misread as section headers.
Task 4: fix round 1/5 (3 addressed, 0 open — KT12ACR-2 ruling noted; Type exclusions; section-row detection; commits 91a7cec..39efd2b)
Task 4: minor (deferred): inconsistent duplicate handling across source sheets (no current dupes); PART/KIT substring match; ZeroDivision on empty on-hand
Task 4: complete (commits 80269cf..39efd2b, review clean) — workbook sent to Jack for review, not uploaded
Task 5: minor (deferred): a SKU only on non-first lines of mixed pallets shows "0 PLT" (spec-consistent); esc() skips "'"; no '<' escape test
Task 5: complete (commits 39efd2b..8ce8181, review clean)
Task 6: minor (deferred): bolData on a half-done pickup lists only LOADED pallets; bolRev never reset (correct: release only precedes docs); local store JSON keeps defaultCarrier Armstrong (beta only)
Task 6: complete (commits 8ce8181..07be425, review clean)
Task 7: minor (deferred): blank tab stays open if an ok response lacks r.view (no try/finally); tab opens after confirm() (activation window); "BOL REV  opened" if r.bolRev missing on a no-change re-approve — final review to check; dresync doesn't auto-open
Task 7: complete (commits 07be425..0f87d33, review clean)
Task 8: minor (deferred, final review to triage): Truck # of the day can repeat after deleting an at-dock truck (truckNoForDay counts departed; same as Release) — paperwork shows the same "Truck N · MM/DD" twice
Task 8: minor (deferred): no add-on-IF delete-guard test; ifExists regex includes fake's "no rec"; no assertClaim before final write; STAGE_ORDER lacks 'Deleted' (Task 9 UI)
Task 8: complete (commits 0f87d33..43502c8, review clean)
Task 9: minor (deferred): cancel paths differ (prompt silent vs confirm re-renders); string concat only to satisfy a test; source-string tests only
Task 9: complete (commits 43502c8..5058e37, review clean)
Task 10: minor (deferred): saving an empty trailer list leaves only "Other…" (no DEFAULT_TRAILERS fallback) — untested; busy-hidden-after-save not asserted
Task 10: complete (commits 5058e37..ccda7b5, review clean)
Beta click-through (controller, smoke store, writeMode on, tare 35): weights save/list OK; Verify 4,580 lb = 180×18+48×25+4×35 OK; Approve → docs written, BOL tab blocked in the embedded pane → "Pop-ups are blocked: press Print BOL" fallback shown OK; BOL page renders (3,345/1,235/4,580, ArcBest, seal blank) OK; re-approve with no change stays REV 1, after a take-off REV 2 with 3,345 lb OK; seal 1846 shows on BOL OK; delete loading truck OK (pallet back, trailer free, history Deleted|reason, floor scan "This truck was deleted"); delete at dock refused "Delete IF… and close TO… in NetSuite first" OK; trailers save → floor list has 900100 OK.
Beta finding (for final review): Approvals "At the dock" card has no Print BOL / Delete truck button (spec: Print BOL on the At-the-dock card) — dockCard is the Shipments card; the Approvals at-dock list is a separate renderer.
Beta finding (minor): trailer editor ✕ buttons render as large dbtn squares; the add input is small/unstyled.
Final review (opus, bc3fd56..ccda7b5): With fixes. Important: (1) workbook Notes sheet first → upload reads SheetNames[0] and fails; (2) delete refusal/success message lost on ship/dash/report screens; (3) SKU without an uploaded row prints PCS with no H.M. X on the BOL. Minor: REV-1 "throw away" wording on no-change re-approve; Page 1 hard-coded; straggler pallet on a deleted truck; empty trailer list accepted; upload row numbers off by header/blank rows. Triage: Approvals at-dock card buttons can wait but cheap → include.
Ruling: a SKU with no uploaded weight row prints Type "?" with blank H.M. and a footnote "Type unknown, check H.M.: <SKUs>" instead of defaulting to PCS/non-hazmat — never imply non-hazmat on a legal document — cost if wrong: an extra footnote line.
Ruling: the final fix wave also takes Minor 4, 6, 7, 8 and the at-dock/trailer UI items (all small, all in files already touched) — cost if wrong: a slightly larger fix diff to re-review.
Final fix wave: 9/9 addressed (commit 090dad0, re-review clean). Tests 467/467. Release complete, not uploaded.
