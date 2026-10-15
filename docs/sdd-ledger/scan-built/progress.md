# SDD ledger — plan: docs/superpowers/plans/2026-10-15-move-portal-scan-built-to.md

Spec: docs/superpowers/specs/2026-10-14-move-portal-scan-built-to-design.md (approved 2026-10-15). Branch feat/v3-verification, start 3ee1339, baseline 291 tests.

## Pre-flight scan

| Pair / task | Produces → consumes | Finding |
|---|---|---|
| T1 → T5,T6,T7,T8 | core.officeIfs/palletTare, verify.lbs/truckLines/linesPcs/truckWeight/stockCheck/stockText | names consistent |
| T2 → T6,T7,T11 | scanApprovePlan ops (ref, toId 'new:to:<ref>'), opKey, resolveNew | consistent; fake failOn sees resolved op → T3 adds predicate failOn (in plan) |
| T3 → T6,T7 | tx.toClosed, tranIds 'to', fake _t.closed, failOn predicate | consistent |
| T4 → T5 | itemInfo weight/wunit, fake settings officeIfs:true | consistent |
| T5 → T6,T7,T9 | isScan, scanRows, truckView.scan, truck_planned.officeIfs, boot officeIfs | consistent |
| T6 → T10 | shipPending.scan/lines/lbs, retries.scan/toId | consistent |
| T8 → T10 | labels_preview rows {n,sku,item,pcs,pallets,odd,total,labels,status,msg,cfg} | consistent |
| T1 self | tests vs code | lbs(10,'kg') = 22.05 ✓ (10×2.20462); truckWeight 144×10=1440, tare 135 ✓ |
| T2 self | tests vs code | consistent |
| T3 self | tests vs code | **conflict**: fake record.create sets r.id='650', save returns r.id → '650', test expects '777' |
| T4 self | tests vs code | move_data.test fake must expose weight cols; implementer reads file first (plan says so) |
| T5 self | tests vs code | consistent (avail 1000, 2×120×10 + 90 tare = 2490) |
| T6 self | tests vs code | consistent |
| T7 self | tests vs code | consistent |
| T8 self | tests vs code | consistent (fmt = toLocaleString en-US) |
| T9 self | optional `touched` change | `touched` (sl:229) already sends READY→LOADING on a pallet change |
| T10 self | ui string checks vs code | consistent |
| T11 self | applyOp test file | applyOp tests live in verify.test.js |
| all | "Expected: PASS, N tests" counts | estimates |

Ruling: T3 to_create test expects '650' (the id the fake create sets), not '777' — the plan's fake sets r.id='650' and save returns r.id — costs nothing if wrong (test-only).
Ruling: T9 needs no server change for "scan after Verify → loading": touched() already does it; T9 adds one portal test pinning it for a scan truck — spec §4 requires the behaviour — if wrong, a re-verify is skipped (low).
Ruling: per-task "Expected: PASS, N tests" counts are estimates; the gate is "all tests pass" — cost: none.
Ruling: T11 applyOp test goes in verify.test.js (where applyOp tests already live) — cost: none.
Ruling: ledger + briefs live in the git-ignored SDD workspace (skill convention); copy the ledger to docs/sdd-ledger/scan-built/progress.md at finish (project convention) — cost: none.

## Tasks
Task 1: dispatched (base 3ee1339, haiku)
Ruling: commit trailer — T1 implementer used CLAUDE.md's 'Claude Fable 5.1' trailer instead of the plan's Opus 5.5; kept as is (CLAUDE.md is the user's instruction; no history rewrite) — cost if wrong: cosmetic attribution only.
Task 1: minor (deferred): move_verify lbs/stockText use double quotes (file style = single)
Task 1: minor (deferred): LB_PER plain object — unit 'constructor'/'toString' → NaN not null (use hasOwnProperty)
Task 1: minor (deferred): no tests for mixed pallet once-per-SKU, truckWeight missing info, officeIfs(null), need==avail
Task 1: complete (commits 3ee1339..d3a26c4, review clean)
Task 2: minor (deferred): reservationsFromTrucks (move_verify ~262) will count scan-truck if_create ops under key 'new:to:<ref>|item' — matches no TO line, harmless; consider skipping new:to: in Task 6+
Task 2: minor (deferred): no resolveNew test for IF resolved but TO write missing
Task 2: complete (commits d3a26c4..e433c78, review clean)
Task 3: dispatched (base e433c78, haiku)
Task 3: ⚠ resolved by controller: if_create op memo carries [MV-<ref>] — Task 2 test asserts memo 'Truck 3 · 11/02 · [MV-12]' ✓
Task 3: minor (deferred): createTransferOrder has no guard for missing op.token
Task 3: minor (deferred): findPackedByToken could reuse findByToken
Task 3: minor (deferred): toClosed matches test-only 'no rec' message — prefer fake throwing name RCRD_DSNT_EXIST
Task 3: minor (deferred): locationSubsidiary takes the first subsidiary (multi-sub location / non-OneWorld unverified)
Task 3: minor (deferred): toClosed test lacks orderstatus 'H', n===0, rethrow cases; IF find test doesn't check createdfrom filter
Task 3: complete (commits e433c78..9aed7a5, review clean)
Task 4: dispatched (base 9aed7a5, haiku)
Task 4: ⚠ resolved by controller: locationStock builds rows via itemCols().concat + itemRow (move_data.js ~112) → carries weight ✓
Task 4: minor (deferred): weight test covers itemInfo only; no blank/non-numeric weight case
Task 4: note for launch: smoke-test one item search with weight/weightunit columns in the sandbox before on-mode (a bad column id would break all item lookups)
Task 4: complete (commits 9aed7a5..2462184, review clean)
Task 5: dispatched (base 2462184, sonnet)
Task 5: ⚠ resolved by controller: ui.buildPage JSON.stringify(boot) forwards officeIfs ✓; ship_mark→departPlan with scan is Task 6
Task 5: minor (deferred): truck_drop_if not refused for a scan truck (harmless, manager-only)
Task 5: minor (deferred): verifyTruck scan empty-check re-reads palletsByLoad even with opt.loadedAll; truck_planned indentation drift
Task 5: minor (deferred): no tests for scanRows noWeight>0 or avail missing → short
Task 5: note: scanRows costs 2 searches per truckView of a scan truck (every scan response)
Task 5: complete (commits 2462184..ca95859, review clean)
Task 6: dispatched (base ca95859, sonnet)
Task 6: review → Needs fixes (1 Critical: second Approve after Release reuses the closed TO via unchanged [MV-<id>] tag; Important: Close-TO message/retries use internal id not TO number (plan-mandated); Important: no test for Release refused once IF exists)
Ruling: T6 Critical — each Approve attempt gets its own ref: data.approveRef = loadId for the first attempt, '<loadId>-R<n>' after the n-th Release; departPlan/finishDepart/depart_release/approvals read keys via that ref. Release also refuses when an unrecorded TO with the current tag exists and is not closed (new tx.findTo(token), fake map _t.tags). — spec §7 promises Release → truck back to the floor and a clean re-approve; reusing a closed TO traps the truck — cost if wrong: a stray tag variant on TO memos (cosmetic).
Ruling: T6 Important #2 (plan-mandated toId in Close-TO text) — show the TO number (tx.tranIds(…,'to')) in the message and as retries[i].toNum (keep toId too) — spec says manager closes the TO in NetSuite; managers search by number — cost if wrong: none.
Task 6: minor (deferred): off/qty test doesn't assert to/if/alloc untouched; approvalsView scanRows not try/catch-guarded; report misstated fake failOn; 'TO <id>' fallback spacing
Task 6: fix round 1/5 (3 addressed, 0 open — approveRef per attempt + findTo guard; TO number in Close-TO text/retries; Release-after-IF test; commits e8f0576..2afa3c5)
Task 6: minor (deferred): Release guard findTo search runs twice (pre-claim + in claim); search error surfaces raw (fails safe)
Task 6: complete (commits ca95859..2afa3c5, review clean after 1 fix round)
Task 7: dispatched (base 2afa3c5, sonnet)
Task 7: review → Needs fixes (Important: Accept retry after partial write re-runs stock check against stock its own TO/IF consumed → can be refused, orphaning NetSuite records; no retry test)
Task 7: minor (deferred): first test title promises late receipt but never calls receipt_approve; no off-mode accept→receipt test
Task 7: minor (deferred): planReceipts allocates received pcs in alloc order — with a missing same-SKU pallet the late pallet's pcs post on the truck's IF (pre-existing behaviour)
Task 7: minor (deferred): Reject after a failed partial accept leaves the one-pallet TO/IF in NetSuite with no hint (only in data.writes)
Task 7: minor (deferred): dashboard scan row ifId '' — check UI row keys
Task 7: fix round 1/5 (2 addressed, 0 open — stock check skipped on resumed accept + retry test; late receipt asserted; commits df52952..582a750)
Task 7: minor (deferred): stock-skip read precedes the claim (low race risk; claim + mustFlaggedOn guard writes)
Task 7: complete (commits 2afa3c5..582a750, review clean after 1 fix round)
Task 8: dispatched (base 582a750, haiku)
Task 8: review → Needs fixes (Important ×3 plan-mandated: non-numeric pallets/odd → NaN totals, false ok, bypassed cap; fractions silently truncated; '1,000'/1e999 unhandled)
Ruling: T8 number parsing — a cell is blank (→0) or, after trimming and removing thousands commas, a finite whole number ≥ 0; anything else (abc, 1.5, Infinity, negative) skips the row with '<Pcs per pallet|Pallets|Odd pallet pcs> must be a whole number'; null/non-object rows are skipped as blank — spec §6 says unmatched rows are skipped and only real rows print; silent truncation would print wrong labels — cost if wrong: a manager must fix a fractional cell instead of getting it floored.
Task 8: ⚠ header case/spacing matching lives in the client (Task 10 mapRows) — check there
Task 8: minor (deferred): numeric SKU as float (201.0) untested; leading-zero SKUs lost by Excel before reaching code
Task 8: fix round 1/5 (3 addressed, 0 open — whole-number cells, null rows dropped, 1,000 parses; commits 5a7766d..64d762e)
Task 8: minor (deferred): blank-SKU row with explicit 0 cells now shows "Unknown SKU (blank)" instead of being dropped (zero-filled filler rows add noise)
Task 8: complete (commits 582a750..64d762e, review clean after 1 fix round)
Task 9: dispatched (base 64d762e, sonnet)
Task 9: review → Needs fixes (Important: ACT.finishload lacks stale-truck guard → TypeError or paints another truck; Important: assumes r.view present)
Task 9: minor (deferred): officeIfs read from two sources (r.officeIfs vs B.officeIfs); ui test is source-string only (plan-mandated); ACT.tverify has the same weaker id-guard; scan truck needs_fix text unreachable but office-worded
Task 9: fix round 1/5 (1 addressed, 2 open — tverify guard misses view-less responses (capture S.truckId before await); scan trucks see 'matches its IFs'/'Needs IF fix' copy; commits cf55cb3..67f5a2f)
Task 9: fix round 2/5 (2 addressed, 0 open — captured-tid guard; scan-truck verify wording; commits 67f5a2f..7e12b85)
Task 9: minor (deferred): ACT.taddif lacks captured-truck guard (office path; unreachable on scan trucks)
Task 9: complete (commits 64d762e..7e12b85, review clean after 2 fix rounds)
Task 10: dispatched (base 7e12b85, sonnet)
Task 10: review → Approved with 1 Important (plan-mandated: substring-only tests leave mapRows/csvObjs/xlsxprint spec-building unexercised; 'Close TO ' loosened to 'Close ')
Ruling: T10 plan-mandated test finding — fix it: extract the pure client helpers' behaviour under test by evaluating them from _clientMain source (no browser), plus header-only feedback — spec Review Focus #5 names Excel quirks; the plan's substring test can't catch them — cost if wrong: one extra fix round.
Task 10: ⚠ apconfirm success text may say "BOL unchanged" for a scan truck — check in Task 11 click-through
Task 10: minor (deferred): quoted "1,000" in CSV shifts columns (server skips row); loadXlsx no in-flight promise cache; template offline alert wording; SheetJS 0.18.5 (last cdnjs build) has a prototype-pollution CVE on untrusted files — manager-only uploads; multi-line pallet previews first line only; odd field persists after print; file input not cleared
Ruling: T10 item 3 — accept 'Release (after you Close ' substring instead of 'Close TO' (toNum already carries 'TO') — cost: none.
Task 10: fix round 1/5 (4 addressed, 0 open — printSpecs + behavioural helper tests; Release substring; empty-sheet/zero-label guards; commits e7fd7c6..bd70420)
Task 10: minor (deferred): brace-counting extraction in ui test is fragile to unbalanced braces in strings (fails loudly); csvObjs ignores quoted commas
Task 10: complete (commits 7e12b85..bd70420, review clean after 1 fix round)
Ruling: T11 split — implementer does the snapshot stand-in code + test only; the controller does the beta click-through (needs the app's browser pane) and the CLAUDE.md handoff after the final review (needs final commit range) — cost if wrong: none.
Task 11: dispatched (base bd70420, haiku)
Controller note: local beta store inherits fake_data settings → officeIfs:true by default; the beta shows the office flow unless the store is edited (prod default is false) — candidate for final review
Task 11: minor (deferred): stand-in test doesn't assert ifInfo toId wiring or TO absent from openToLines; empty-lines to_create returns a phantom id
Task 11: complete (commits bd70420..4307fd9, review clean)
Controller click-through (local beta, smoke store, officeIfs false, writeMode on): Excel upload 3 rows → ok / warn (600 vs 500) / skip unknown → 9 labels created; Start Trailer 537224 (no IF list); 9 scans loaded with no TO check; Finish loading → Verify table with tare + "no weight" (snapshot has no weights) + over-stock warning; Shipments seal → Mark shipped; manager Approve → "Can't approve: 11037A-3A on truck 600, available 500"; Reject with reason → floor sees it; Take off PLT109 → Verify 500/500 no warning → re-ship → Approve → TO7679915 + IF7806356 written, alloc real ids; Unload 8/8 → Approve receipt → IR 610 pcs. PASS.
Controller finding: apconfirm success text says "BOL unchanged" on a scan truck — should name the new TO/IF (minor, UX)
Controller finding: local beta store inherits officeIfs:true from fake_data defaults (minor; prod default false)
Final review (opus, 3ee1339..4307fd9): With fixes — 0 Critical, 6 Important (write-outcome message/Plan saved; scan trucks reserve office TO room; label warning ignores loaded pallets; Release after unrecorded Shipped IF → double ship; failed late-pallet accept + Reject orphans TO; approvals scanRows unguarded)
Ruling: final fix wave covers all 6 Importants + beta store default officeIfs false — all are spec requirements (§3 Plan saved, S3 office unchanged, §6 labeled-or-loaded, S12 lock) or prod safety — cost if wrong: a slightly larger diff.
Final fix wave: 1849838 (7 addressed, 0 open; 343/343 verified by controller)
Final: minor (deferred): an unrecorded scan TO still counts as office room until Retry records it (narrow; Release refuses; later hardening: drop open TO lines whose memo has '[MV-')
Final: minor (deferred): labels_preview subtracts office-truck loaded pallets too (warning may be conservative)
Final review clean — branch range 3ee1339..1849838
