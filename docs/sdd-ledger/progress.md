# SDD ledger — plan: docs/superpowers/plans/2026-09-27-move-portal.md

Spec: docs/superpowers/specs/2026-09-27-move-portal-design.md (read). Worktree C:/Users/Jack/wt/move-portal, branch feat/move-portal from 57debac.

## Pre-flight scan
Evidence: on 2026-09-27 controller assembled every code block from the plan per its insertion instructions into a scratch tree; `node --test` = 49/49 pass; move_data/fake_data API match; preview UI driven end-to-end (print, load, ship, receive, catch-up, dashboard) with no console errors.

| Pair / task | Produces vs consumes | Finding |
|---|---|---|
| T1–T4 (move_core.js) | T1 file w/ 3 section markers + return; T2–T4 fill markers + extend return | consistent; assembled file passes 19 core tests |
| T1/T6/T8 core ↔ data/fake | palletCode, PALLET/LOAD consumed | match |
| T5 tpl ↔ T8 pdf() | labelsXml(labels,{codeMode,header,fromName,toName}), loadSheetXml(model) | match |
| T6 data ↔ fake_data ↔ T8–T11 | identical API (39 fns) | API MATCH verified |
| T7 tx ↔ fake_tx ↔ T9/T10 | findByToken(tok,type), createTransferOrder, committedShortfalls, fulfillTransferOrder, receiveTransferOrder | match |
| T8 ↔ T9–T11 | helpers + act(); marker line for inserts | match; T10 inserts after act('load_approve'), T11 after act('catchup_reject') |
| T12 ui ↔ T8–T11 | action names, response shapes | driven in preview, all screens worked |
| T0, T13–T15 | NetSuite/manual | controller-run (Chrome/sandbox), not subagent |
| each task self-consistency | tests vs code | all pass when assembled |
| Global: test command | plan uses `node --test "move_portal/test/*.test.js"` | bare dir fails on Windows — already fixed in plan |

Ruling: Batch tasks by file group instead of one dispatch per task — A=T1–T4 (move_core + core tests), B=T5, C=T6+T7, D=T8, E=T9, F=T10, G=T11, H=T12 (steps 1–4 + 6; step 5 preview is controller-run) — plan code is complete and pre-verified, so per-task dispatch only multiplies overhead — cost if wrong: coarser review granularity.
Ruling: Implementers on haiku (transcription of complete, pre-tested code), reviewers on sonnet, final review on opus — cost if wrong: extra fix rounds.
Ruling: Task 0 (Chrome sandbox setup) run by controller in parallel with code batches; Tasks 13–15 are controller/Jack tasks after the code merges — cost if wrong: none (no shared files).
Ruling: Work on branch feat/move-portal in a worktree outside Google Drive (Drive-hosted .git is flaky under heavy git use) — cost if wrong: none; merge at the end via finishing-a-development-branch.

## Progress
Task A (T1–T4): implemented commits 5070281..3dc573e (19/19); review dispatched
Task A (T1–T4): complete (commits 57debac..3dc573e, review clean)
Task A: minor (deferred): redundant '-' escape in catchupNumber regex char class (move_core.js:189); report line counts inaccurate (cosmetic)
Ruling: Merge planned batches B (T5) and C (T6+T7) into one dispatch B=T5–T7 — all three are verbatim transcription into separate new files with their own tests; batch A proved the haiku+verbatim approach clean — cost if wrong: one larger review.
Task B (T5–T7): implemented 935f81d..1924dbc (26/26); review dispatched. Task 0 step 1: sandbox Tippecanoe location created id 42 (Flame King, Warehouse, Indiana East, inventory available); sandbox Riverside = 35
Task B (T5–T7): complete (commits 3dc573e..1924dbc, review clean after ruling)
Task B: parked — Important (plan-mandated) unguarded search.lookupFields(location,'subsidiary') in move_tx.locationSubsidiary would throw on non-OneWorld — Ruling: code stands; account IS OneWorld (sandbox Location + Transfer Order forms both carry a Subsidiary field, value "Flame King"), so the column is valid — cost if wrong: Approve & Ship throws until wrapped in try/catch (caught in Task 14 sandbox test).
Task B: minor (deferred): setLines error text says "transfer order" even when setting IF/receipt lines (move_tx.js); configsByItem sort comparator never returns 0 (move_data.js:157)
Task 0 step 2 (in progress): TO8719 id 2587371 (YSN201 x1, Riverside→Tippecanoe, saved directly as Pending Fulfillment ⇒ no TO approval routing; toStatus 'B' OK). Before: Riverside YSN201 on hand 181,919 / committed 25,750 / avail 156,169; Tippecanoe none. IF53831 id 2587372 saved Shipped → Riverside on hand 181,918.
Task 0 step 2 DONE: after IF Shipped → Riverside on hand 181,918 / avail 156,168 / "in transit" 1 (native in-transit shown on source row; Tippecanoe "on order" 1). IR14492 id 2587373 → Tippecanoe on hand 1; TO status Received. Native in-transit (not the "In-Transit …" location records). Receipt form links one IF ("Item Fulfillment" field) — fine for 1 TO = 1 IF. Script logs: ue_if_filled_status stamped TO line Pick Status = Filled (benign); ue_if_packages logged normal create; ue_portal_link stamped picker-portal link on IF (benign); no RSM/SPS/Item-Substitute errors.
Task 8: implemented 4fdaacf (33/33); review dispatched. Task 0 step 3 DONE: sandbox Warehouse Portal Manager (2537) already had TO Full, IF Full, Fulfill Orders Full, SO Edit; added Receive Order Full.
Task 8: complete (commits 1924dbc..4fdaacf, review clean after ruling)
Task 8: parked — Important (plan-mandated) count-then-create idempotency in createPalletsForJob/cfg_commit_chunk is not safe against truly concurrent requests for the same job/batch — Ruling: code stands for v1; one office person prints (spec D5), job ids are per-click, the UI disables the button while printing, and req_print is manager-only; the realistic failure is a duplicate label that is harmless (only scanned pallets count, spec D8) and voidable — cost if wrong: occasional duplicate labels to void.
Task 8: minor (deferred): isManager()/onRequest not covered by node tests (verified in Task 13 sandbox smoke); unused L constant until Task 9.
Task 9: implemented fd9ab63 (39/39); review dispatched
Task 0 steps 4–6 DONE (sandbox): record types settings 742 / config 743 / load 744 / pallet 745 / scan 746 / label_req 747 (all No Permissions Required for Internal Roles, no name field, show ID); all 32 fields created with exact custrecord_mv* ids (verified by id list after each save); Move Settings row id 1 with {locFrom:'35', locTo:'42', target 2026-11-15, start 2026-10-01 (placeholder — Jack to confirm first move day), roster = Riverside picker names, labelCode both, toStatus B}.
Task 0: COMPLETE (sandbox). Tip: nlapiSetFieldValue/Text works on NetSuite UI forms, but List/Record field forms only save via a real mouse click on Save (JS .click() on submitter did not submit).
Task 9: review approved with Important (plan-mandated) concurrent double-approve race + 2 minors.
Ruling: fix the race now — spec §9 "Concurrency guard" requires flip-to-working-state then RE-READ and refuse if another request got there first; plan code only flips. Fix = write a random claim token with the SHIPPING flip, re-read, abort if claim differs; same pattern to be carried into Task 10 receiveLoad — cost if wrong: a few extra lines.
Ruling: also fix minors now (cheap, same function): tranids display lookup after SHIPPED must not throw; 'No pallets' path reverts to READY like the shortage path.
Task 9: fix round 1/5 (3 addressed, 0 open — claim guard, safe tranids, No-pallets revert; commits fd9ab63..053d0c9)
Task 9: complete (commits 4fdaacf..053d0c9, review clean)
Task 10: implemented c984667 (48/48) incl. claim-guard ruling; review dispatched
Task 10: review approved with Important (plan-mandated) recv_undo lacks in-flight guard + minors.
Ruling: fix recv_undo now — refuse when the pallet's load is receiving_tx, or when the pallet id is in the load's pendingRecv.ids (pinned for a receipt in progress/retry); matches spec §9.2 intent that only scanned pallets are received — cost if wrong: a worker must wait for approval to finish before undoing.
Task 10: minor (deferred): crash between createLoad and pallet patch in catchup_approve can orphan a stray catch-up Load record (no transaction impact); claim-token block duplicated in shipLoad/receiveLoad.
Task 10: fix round 1/5 (1 addressed, 0 open — recv_undo in-flight guard; commits c984667..1e44236)
Task 10: complete (commits 053d0c9..1e44236, review clean)
Ruling: Batch T11 (dashboard action) + T12 (move_ui.js steps 1–4, 6) into one dispatch — different files, both verbatim; T12 step 5 (local preview) is controller-run — cost if wrong: one larger review.
Task C (T11+T12): implemented cb5adc4..1b11e8a (52/52, move_ui identical to verified assembly); review dispatched
Task 12 step 5 (controller): local preview on branch code — print 3, load/dup/edit/ready, approve & ship, inbound scan + loaded-without-scan, approve receipt (1 missing), catch-up, dashboard — all worked at 375px, no console errors, no horizontal scroll. preview_server.js kept untracked (not committed).
Task C (T11+T12): complete (commits 1e44236..1b11e8a, review clean)
Task C: minor (deferred): dashboard k() helper and barChart() interpolate big/sub/day/n without esc() — not exploitable today (numeric/ISO/pre-escaped), fix for consistency
Ruling: New requirement from Jack 2026-09-28 — barcode payload = PLT<id>⇥SKU⇥pcs (every line for mixed), tab-separated; lookups use only the leading PLT<id>; brief task-13a-brief.md (Task 12b) — cost if wrong: longer Code128 (harder long-range reads), switchable later via labelCode=qr.
Task 12b: complete (commits 1b11e8a..12c14e4, review clean) — barcode payload PLT<id>⇥SKU⇥pcs; scan inputs keep Tab
Label tester (master, outside plan): b3586db payload, 8a4b096 embedded-preview print warning. Jack confirmed printing works from a real Chrome tab (the chat file preview blocks window.print).
Final review (opus, 57debac..12c14e4): no Critical, auth clean; Important I1 orphaned-TO retry deadlock/stale lines, I2 claim guard not CAS (two managers), I3 nothing-to-receive → ERROR strands load (+ catch-up repeat), I4 failed catch-up strands pallet / catch-up loads leak into To ship + sendback; I5 Code128 with full payload unscannable on mixed pallets (Jack decision). Minors M1–M8 listed in review.
Ruling: ONE fix dispatch for I1–I4 + fold-ins (shared claim helper w/ pre-create re-check, STALE_MS 10 min, orphan catch-up load) + M2 message; I5 → ask Jack; M1,M3–M8 deferred (see review) — cost if wrong: minor UX gaps until follow-up.
Ruling (Jack decision 2026-09-28, resolves I5): QR code only on all pallet labels — set Move Settings labelCode='qr' (sandbox + prod); Code128 path kept but unused; tester default QR-only (master 3f..). Settings record update pending sandbox re-login.
Final fix wave: complete (commits 12c14e4..c710724, 62/62; re-review all findings addressed, no new breakage)
Code build (Tasks 1–12 + 12b + final wave): COMPLETE. Next: Task 13 sandbox deploy (needs Jack's sandbox login), then Task 14 functional pass; merge via finishing-a-development-branch after sandbox sign-off.
Paused 2026-09-28 by Jack; handoff written to master CLAUDE.md (commit above).


## v3 verification portal (2026-10-05) — plan docs/superpowers/plans/2026-10-05-move-portal-verification.md, branch feat/v3-verification

Copied from the session ledger (.superpowers/sdd/progress.md). Each task: implementer + task review (spec + quality); Important findings fixed before completion.

```
# SDD progress — plan docs/superpowers/plans/2026-10-05-move-portal-verification.md (branch feat/v3-verification)
Task 1: complete (commits 51b9a92..fed1310, review clean)
Minor (T1): addonTo is only the first/oldest add-on TO (display only; planDeparture splits across TOs); PLANNED/OPEN_TO_STATUS exported but filtering lives in buildReads; missing boundary tests (after==expected, ==expected+raise), empty-lines pallet returns ok.
Task 2: complete (commits fed1310..5eacc6e, review clean)
Minor (T2): truckNoForDay counts (not max) — fine since departed trucks are never undone; toLeft assigns per toId|item (buildReads already aggregates, ok); stamp trailer/seal not normalized in plan (sl departInput trims); bol.number '' when all IFs unplanned + add-ons only; if_qty to:0 on mixed IF relies on tx removeLine (Stage 2 check); test reuses pallet id 100.
Task 3: complete (commits 5eacc6e..52d2975, review clean)
Minor (T3, plan-mandated): planReceipts cum[k]=g can drop below earlier approved qty -> consider Math.max(g, before) (posted pallets can't be undone, so low risk); received qty with no IF line is silently dropped (no surplus field); stamp must be passed; thin asserts on dup_other/locked refs and r2.cumulative.
Task 4: complete (commits 52d2975..3f4fea2, review clean after fix round 1 — Jack approved seal-by-digits + runOps no-id fixes)
Open for final review (T4): add-on IF only detected in shadow once a receipt carries the seal (between departure and unload shows (new)/null); thin tests for Trailer/Seal false, Shipped null, no-receipt path, on-mode if_create->receipt ordering; Trailer compare still normSeal; empty seal both sides -> ok:true; sealKey strips 'SEAL' prefix from alphanumeric seals.
Task 5: complete (commits 3f4fea2..5a142ed, review clean). SQL line semantics (TO positive rows at locTo; IF positive rows at locFrom) were checked against prod by the controller on 2026-10-05.
Minor (T5, plan-mandated): receipt linked to 2 IFs overwrites (1 rcpt=1 IF today); receiptsByIf not sorted by id; ifLines don't require the TO's from-location (only plannedIfs filters by toMeta); toMeta mixes key kinds; thin SQL/snapshot_ns tests; no guard on NaN location / empty {IDS}.
Task 6: complete (commits 5a142ed..432ddaf, review clean after fix round 1 — Jack approved: untick instead of removeLine + empty-IF guard; real move_tx tests with fake N/record)
Stage 2 checks (T6): does TO quantityfulfilled count Picked/Packed IFs (vs planner remaining)? bins/inventorydetail on Riverside items? itemreceive=false on a loaded Packed IF drops the line on save? defaultValues.itemfulfillment on TO->IR.
Minor (T6): cur/caps sum unticked lines too; negative op.to treated as 0; two tx test files.
Standing approval (Jack, 2026-10-05): plan-mandated hardening/test gaps that don't change portal behavior → just fix, list in final summary. Behavior changes still go to Jack.
Task 7: complete (commits 432ddaf..9cc93b1, review clean after 2 fix rounds: retry staleness, assertClaim per write, claimLoad re-read+guard, error logging, requestedBy, stronger tests)
Lesson (T7): updateLoad merges patch.data over the PASSED copy — always re-read (data.getLoad) before updateLoad in multi-step paths. Applies to Task 8 receipt_approve/receiveOn/pushStack.
Minor (T7): residual tiny race on depart write after claim (could fold depart into claim write); duplicated retry condition; seal/truck# not reserved while pending; remove/undo/move-here not logged as scans; default trailers hard-coded fallback.
Task 8: complete (commits 9cc93b1..c5d21db, review clean after 2 fix rounds: APPROVING recovery via error/stale, late-arrival visibility, rplan dedupe, postedSeq only planned ids, logging, prevStatus in claim write)
Minor (T8): unloadView findPalletsWhere over all labeled/loaded per scan (governance); undo leaves receivedAt/By; unload_list extra per-truck search; running-approval truck hidden from list up to 10 min; rplan holds unresolved new:<toId> ids.
Task 9: complete (commits c5d21db..d982f04, review clean after fix round 1: per-truck isolation in receipts, stuck approving always listed, report diffs tests)
Minor (T9): mocks position-dependent; report test relies on fake clock day.
Task 10: complete (commits d982f04..dea4804, review clean after fix round 1: PALLET==VP test, dashboard coverage, dead code removed, P->VP)
Minor (T10): move_data whereFilters still has dead shippedSince/catchup; dashboard neverLoaded JS filter + per-truck palletsByLoad (governance).
Task 11: complete + Task 12: complete (commits dea4804..719a588, one implementer, review clean after fix round 1: departing state, confirm prompts, api/handler cross-check test, form value keep, null guards)
Minor (T11-12): no fake-DOM render tests; handler regex 'ACT\.' unescaped dot; stuck no-perIf card says "Approve" not "Re-approve"; dconfirm text misleading for floor (it only requests); validation error repaints whole truck; stale queued scan may paint previous truck; manager can't reject pending departure with plan error; report table no overflow-x; perIf.short numeric used as bool. NOTE: implementer once ran taskkill /IM node.exe (killed all node processes) — tell Jack.
Task 13: complete (commits 719a588..8e6cf80 + gitignore tmp, review clean after fix round 1: atomic store, save decoupled, item/trailer merge incl 543804/487491). Snapshot pulled by controller: move_portal/snapshot/prod-2026-10-05.json (12 planned IFs, 6 open TO lines, 38 receipts).
Minor (T13): save failure not surfaced to client; partial in-memory mutation after failed action could persist on next save.
```


## Verify Load (2026-10-05 night)

```
# Verify Load plan (docs/superpowers/plans/2026-10-05-move-portal-verify-load.md), start 2cd8a85
VL Task 1: complete (commits 2cd8a85..bfdf23b, review clean). Ruling: corrections do NOT reserve TO room (needs_fix surplus already placed).
Minor (VL1): untested oldest-TO pick w/ 2 TOs, if_over routing w/ multiple carriers, diffText non-whole pallets; if_over has no TO-room check (Task 4 must handle refused raise); verifyTruck must save fresh data.ifs (Task 2) so reservations aren't stale.
VL Task 2: complete (commits bfdf23b..3da942d, review clean after fix round: gone IFs persist until manager drop; recheck reads once, writes only on change)
Minor (VL2): empty truck (no IFs, no pallets) verifies ready → Task 3 must keep no-empty-departure guard (better: verify diff 'no_ifs'); recheck later trucks use pre-loop data; keep order; M2 suggestions from saved diffs.
VL Task 3: complete (commits 3da942d..1879cb6, review clean incl. follow-ups: stamp expected-lines + idempotent (seal digits), depart_release, toNeedsFix guard, preview poll). move_tx now depends on ./move_verify.
ON-MODE GATE (VL3): (1) depart_release after a landed-but-unrecorded stamp → shows if_gone/no_if → manager could double-fulfil; probe IF before release or allow release only on changed() error. (2) partly stamped truck with a refused stamp has no exit. (3) failed re-verify after release leaves stale verify diffs. Task 5 must add Release button (confirm) next to Retry; client needsFix message should be worded from diff kinds.
VL Task 4: complete (commits 1879cb6..72c3ae4, review clean incl follow-ups: Packed if_create w/ memo token find-before-create, correctionWrites keyed opKey|sig, orphan skip+report row, correctError cleared on ready, batched skuNames).
ON-MODE GATE (VL4): orphan block per TO is too broad (block only overlapping items); orphan row/block should reflect live IF state (still A/B and on no truck); token-find must refuse an IF another truck holds. Stage 2: verify ItemShip search filters (status A/B + createdfrom) in prod.
VL Task 5: complete (commits 72c3ae4..7abe305, review clean after fix round: alert reaches every device via ready list + id|at key, wording, banner at bottom, verifiedBy/At on approvals, no self-alert).
Minor (VL5): new device alerts for every already-ready truck; re-pressing Verify on a ready truck re-alerts all devices; UI tests string-only; departure needsFix path not run in browser.
Final review (VL): done. Fixes d9f4727..e16319c (release restores in-transit pallets + clears verify; unchanged re-verify keeps at/by, poll = Auto re-check; ns.resetCache per action + after correct writes; manager add-any-IF picker; correction wording; if_qty no done-skip; smoke config; esc ids). Re-review: ready for beta. Browser smoke: Release path OK; stale Ready card after refused preview fixed in 65bc520. Tests 203/203.
TASK 15 MUST-DO: lazy move_ns reads + SQL status filter (30s recheck cost); prod check of ItemShip search filters.
```


## Floor/Manager Rework (2026-10-06)

```
# Floor/Manager Rework plan (docs/superpowers/plans/2026-10-06-move-portal-floor-manager-rework.md), start e01d03f. Commit trailer now: Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
RW Task 1: complete (commits e01d03f..9534a22, review clean + follow-ups: manager re-check needs no note; shortNote kept until finishDepart; trailer ≤20 refused / note ≤300; coverage). Tests 212.
Minor (RW1): departInput still accepts a different a.trailer (moot after Task 2); trailer uniqueness check-then-create.
RW Task 2: complete (commits 9534a22..451e4c3, review clean). Tests 218. Truck # assigned at confirm (gap-free) — keep.
Follow-ups for Task 4/5 UI: unload "locked" result names the pending truck; manager Approvals shows age of ship_pending trucks (banner > 30 min); seal-collision message names the other truck. Minor (RW2): toNeedsFix-changed test now hits verifyTruck guard; post-claim mismatch test doesn't assert shipReq cleared; ship_mark on a truck w/ empty trailer; truckNoForDay same-day race (pre-existing).
PROCESS NOTE FOR JACK: a truck can't be unloaded until a manager confirms shipping — managers should confirm before the truck pulls out.
RW Task 3: complete (commits 451e4c3..47b8f0d, review clean). Tests 223.
For Task 5: trucks[] needs otherDiffs text for plan_mismatch/no_ifs trucks; truck card Drop IF uses truck_drop_if (not a correct key); unload locked test assert 'Trailer '+trailer outright.
Snapshot refresh procedure must add the onHand query AND include onHand item ids in the items query (CLAUDE.md/plan Task 13 step 5).
RW Task 4: complete (commits 47b8f0d..0a0f51d, review clean). Tests 226.
Minor (RW4, fold into Task 5): note lost if Save fails (close modal only on success); other-item handlers check truck id after await; otherrm needWho; Shipments N+1 truck_get; scans during modal land in textarea; marked-before-midnight truck vanishes from Shipped today.
RW Task 5: complete (commits 0a0f51d..a20d375, review clean). Tests 229.
Minor (RW5): stall hint points to a missing button when a stuck truck has no fix card (add truck-level Correct when n.stuck); gone/empty duplicated in otherDiffs; manager Open truck silent on error; picker toggle erases result msg; late badge only refreshes on Approvals load; send-back uses window.prompt.
RW final review: done. Fix wave a20d375..d30d700 (trailer edit + ship_mark trailer, pallet_void mgr-only, caps, 7 default trailers, open-truck error, otherDiffs dedupe, free-stuck button). Re-review: ready. Tests 239. Old local store archived as store.before-rework-2026-10-06.json (trailer-less trucks).
OPEN: snapshot refresh needs onHand query + onHand item ids in items query — NetSuite connector in this session can't read aggregateItemLocation/location; Jack to reconnect.
Minor (RW final): free-stuck with nothing to run shows "Nothing to correct" though it freed; truckView.trailers not filtered; ttrailer uses window.prompt.
```

## Manager dashboard + flagged pallets (2026-10-06 pm)

```
# Plan docs/superpowers/plans/2026-10-06-move-portal-manager-dashboard-flagged-pallets.md, start a4c42d1. Briefs/reports in docs/sdd-ledger/dashboard/.
DB Task 1: complete (commits a4c42d1..24830c0, review clean after 2 fix waves). Tests 252.
Minor (DB1, for final review): half-done accept (pallet received, truck write failed) has no recovery/reconcile path; pre-raised IF above target leaves alloc < NetSuite (text shows base→to); corrected lastStep overwritten by the re-verify; confirmed lastStep.at = floor mark time; auto-recheck lastStep.by = polling device; receipt_approve message during an in-flight decision misleading; lastStep test misses taken_off-other/corrected/if_added/if_dropped/sent_back/pallet_rejected.
DB Task 2: complete (commits 24830c0..efbb904, review clean after 2 fix waves). Tests 269.
Minor (DB2, for final review / Stage 2): office-planned IF with identical lines on the TO can be taken by the pending-accept matcher (memo-token match needs move_ns memos; token now in the ⏳ text); pending if_create reservation stays while the matching IF is on this truck's ifs; pendingReservations adds an ns.ifInfo read per reservedToLines call when pendings exist (Task 15 lazy-read list); pending-reservation release only on approvals settle; createToken collides with Correct-the-IF creates on same truck/TO/lines; shipped add-on appended with status B; stamp-failure and on-mode loaded-elsewhere tests added; prod check: if_qty on a shipped (C) IF.
DB Task 3: complete (commits efbb904..02d3459, review clean). Tests 270.
Minor (DB3): dashboard runs approvalsView incl. settlePending (not a pure read); stockModel read per load; allTrucks read twice; grouped shipped-pallet read grows with history (Task 15 SQL filter); per-truck stillFlagged + flagged repeated per IF row (UI must not sum rows); test gaps: two-IF truck split, partial unload received, fix/trucks/retry waiting text, late≥30, avg7/avgAll/todayDone, trucksPerDay default.
DB Task 4: complete (commits 02d3459..bd0e68f, review clean). Tests 271.
Minor (DB4): markedAt fallback = confirm time for older trucks; corrText 'undefined' hardening for ops missing ifNum; corrText branches other than on-IF accept untested.
DB Task 5: complete (commits bd0e68f..ca2d468, review clean). Tests 273.
Minor (DB5): late-ship badge not primed until Approvals opens (Task 6: Dashboard calls setLate from waiting.late); error receipt card (!perIf) still ungated; flagRow nested div padding; S.scrollTo not cleared on approvals error; same pallet shows on both cards (by spec).
DB Task 6: complete (commits ca2d468..20aa1c3, review clean after 1 fix wave). Tests 275.
Minor (DB6): Sort select blank after clicking Fulfillment/TO/Truck/Pallets headers (keys not in SORTS); newest-sort || chain stops at an unparseable lastAt; tests string-level only.
DB Task 7: complete (commits 20aa1c3..0338641). Local beta stand-in: snapshot_ns.applyOp applies if_qty / if_create (returns the new id) / if_stamp; fake_tx hook may return an id. Tests 276. Browser smoke done by the controller.
ON-MODE GATE / Stage 2:
(a) setIfItemQty on a Shipped (C) IF must be verified in prod before `qty` (spec 2.6).
(b) Pending add-on IFs are matched by TO + exact lines + not on a truck (searching all statuses, preferring shipped) until move_ns exposes memos, then match by the createToken shown in the pending text; an office-planned IF with identical lines can be taken over by mistake until then.
(c) pallet_accept claims the truck with phase `accept` while the floor may still scan; both sides re-read before writing; no lost update seen in tests; keep an eye on it in the beta.
(d) The dashboard runs approvalsView incl. settlePending, so it is not a pure read.
(e) Task 15 lazy-read list: pendingReservations adds an ns.ifInfo read per reservedToLines call when pendings exist; the dashboard's grouped shipped-pallet read grows with history.
Final review: fix wave 27404ae (settle claim, withdraw pending accept, locked-truck guard, block-in-claim, flagged pallet refused at Riverside, docs). Stage 2 / ON-MODE GATE: half-done accept recovery (write truck before pallet or reconcile), pendingReservations read cost (one palletsByIds per request), stale flagged ids on old trucks, pending pallet UI text on the floor list, two-IF split tests.
Final re-review: ready for the beta walk. Minor (final): reject of a pending accept the office already did (check pendingDone after the claim, ON-MODE GATE); completeAccept guard untested; F3 wording for claimed/departing trucks; truck_move_here has no flagged guard.
```
OPEN resolved 2026-10-06 pm: prod connector reads aggregateItemLocation; snapshot prod-2026-10-06.json pulled (15 planned IFs, 382 onHand). Sandbox connector role still restricted (no transaction/location).
