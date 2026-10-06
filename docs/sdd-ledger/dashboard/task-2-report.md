# Task 2 report: accept a SKU on no truck IF (add-on IF), pending completion, loaded-elsewhere

Status: DONE_WITH_CONCERNS (minor, listed below)
Commit: `c24e9d4` `feat(flagged): accept a SKU on no truck IF via an add-on IF (on mode) or a pending office IF (qty), settle pending accepts, take the pallet off its Riverside truck`

## Implemented (`move_portal/sl_move_portal.js`)
- `acceptOffIf(x0, p0, item, sk, pcs, c)` replaces the Task 1 stub, same signature. Mirrors the on-IF claim pattern:
  - Pre-claim `coveringTo` (open TO line with room, oldest first, via `reservedToLines`) is only a fail-fast: no cover returns `refused` with the ⛔ text and **never claims**.
  - `claimLoad(x0, null, 'accept', decideGuard, {})`, then `mustFlaggedOn(cl.Ld, ...)`, `ns.resetCache()`, and the covering TO is recomputed from the claimed truck and fresh reads. Failure paths call `dropClaim`. If the TO disappeared after the claim: `dropClaim` and the same `refused` outcome.
  - Ops `if_create` (ship false, token) then `if_stamp` (ifId `new:<toId>`, resolved by `verify.resolveNew`). The stamp op also carries `toId`, and its `ifNum` is rewritten to `IF <id>` right before `tx.apply` so NetSuite error messages name the real IF (the brief's test filter relies on `toId` or `ifNum 'IF 901'` matching the stamp).
  - Retry safety: before writing, a `correctionWrites` record with key `if_create:<toId>|<corrSig(create)>` whose IF is **not yet in the truck's alloc** is reused (create skipped via `runOps` done-map and `writes`); a stamp record (stored as `if_stamp:<ifId>|<sig>`, i.e. under the IF it stamped, so two add-ons on one TO cannot collide) is skipped the same way. An IF already in alloc was completed earlier, so it is never reused by a later accept with the same lines.
  - `unloadFromOther(p, c)` is called on both the pending and the completed path. Everything after the write is in a try/catch that `dropClaim`s and rethrows.
  - Plan-only (off / qty): text `⏳ Accepted · office creates IF for 120 YSN201 on TO700 · receipt waits`, decision `accepted_pending` with `op` = the create op, a pending correction entry.
- `findAddOnIf(toId, lines, planned, trucks, exceptId)`, `linesSig`, `coveringTo`, `noCoverText` added next to the accept code.
- `pendingDone` handles `if_create`: a Packed IF on that TO, on no other truck, with exactly those lines. It also ignores IFs already in this truck's alloc, so two pending accepts with identical lines settle onto two different IFs (this was not in the brief; see test below).
- `settlePending` passes `truckId: x.id` into `pendingDone`; `acceptText` handles `if_create` (`✅ Accepted · <ifNum> · new IF on <toNum>`).
- The pre-claim branch in `pallet_accept` now calls the real `acceptOffIf` (comment updated).

## Tests (`move_portal/test/portal.test.js`, 8 new)
The 4 from the brief (on-mode add-on; qty-mode pending + approvals settle; no covering TO refused, now also asserting that no claim write happens; loaded on another truck) plus 4 of mine:
- pending off-IF accept also takes the pallet off the open truck that holds it (checks `unloadFromOther` on the pending path: pallet `labeled`, other truck `loading`, lastStep `taken_off`);
- retry: `completeAccept` fails once (`updatePallet` throws on first `status: 'received'`): accept threw, pallet still flagged, no claim, `if_create` ops stay 1, `if_stamp` for IF 901 once, pallet `received`, alloc has the add-on IF once;
- a completed add-on is not reused by a second same-lines accept (second `if_create`, alloc `901`, `902`);
- two pending same-line add-ons settle onto `9100` then `9101`, never the same IF twice.

Fixture check: TO700 is status `B` (in `OPEN_TO_STATUS = [B, D, E]`) with 1200 YSN201 remaining; fake tx returns `901` for the first `if_create`. No fixture change.

## TDD evidence
- RED: `node --test move_portal/test/portal.test.js` after adding the tests: `tests 152, pass 145, fail 7` (the loaded-elsewhere test already passed: that pallet's SKU is on the truck IF, so Task 1's on-IF path covers it; it is kept as a regression test).
- GREEN: `node --test "move_portal/test/*.test.js"`: `tests 260, pass 260, fail 0`, no stray output.

## Files
- `move_portal/sl_move_portal.js`
- `move_portal/test/portal.test.js` (file is CRLF; the appended block was normalised to CRLF)

## Self-review
- Names/shape follow the brief and Task 1; no dead params. `coveringTo` is shared by the fail-fast and the recompute.
- Tests assert behaviour (ops, alloc, pallet and truck state, claim writes), not internals.

## Concerns
- `if_stamp` for an add-on is not sent with the real IF number until `tx.apply` time (the stored plan op keeps `(new)`); only matters for error text.
- A real-NetSuite note: in `on` mode, a second same-SKU stray after a completed add-on goes through the on-IF path (the add-on is in alloc and `ns.ifInfo` knows it live), so it raises that IF with `if_qty`. The snapshot fake does not know IF 901, which is why the same-lines test creates a second IF. Worth a prod check in Stage 2 (setIfItemQty on an already shipped IF is the same situation as for normal IFs).
- `pendingDone` for `if_create` matches by lines only (no memo token) until `move_ns` exposes memos, as the brief notes.

## Fix wave 1
Commit: `0ada686` `fix(flagged): settle never puts two trucks on one office IF, pending accepts reserve their TO room, matcher sees shipped add-ons and shows the memo token, retry skips an IF another truck holds`

- **Important 1 (two trucks, one office IF):** `settlePending` keeps a `shared.taken` set, adds each `ifId` it attaches via `completeAccept`, and passes it to `pendingDone` and `findAddOnIf` (merged with the truck's own alloc IFs). The trucks list is still read once per approvals call. Test: two departed trucks with the same pending accept, one IF 9100 appears, one `approvals` call attaches it to exactly one truck; after IF 9101 appears the other settles.
- **Important 2 (pending room not reserved):** new `pendingReservations(trucks)`: every truck at Tippecanoe (`UNLOADABLE` + `approving`), the accepting truck included, reserves its pending ops (`if_qty`: `to - from`, `if_create`: each line's qty) on `(toId, item)`. `reservedToLines` subtracts that from the TO lines first (via `verify.reserveToLines`), so the surplus placement of Riverside trucks sees it too. Tests: a pending 120 leaves 1,080 on TO700, so a 1,100 pallet on a Riverside truck is `no_to` and a 1,000 pallet loads (`addon`); a second accept of 1,100 after a pending create is `refused`.
- **Important 3 (matcher):** `findAddOnIf(toId, lines, info, trucks, exceptId, taken)` now searches `ns.ifInfo()` (all statuses), accepts status A, B or C, prefers C over B over A then the lowest id; `settlePending` passes `info`, `pendingDone(dec, info, trucks, taken)` lost its `planned` arg. The pending text is now `'⏳ Accepted · office creates IF for N SKU on TO (memo <token>) · receipt waits'`; the existing test string updated. Tests: shipped IF settles, preference order C > B > A and lowest id (across two trucks), IFs with other lines, on another TO, or status D are ignored. Existing settle tests now expose office IFs through both `plannedIfs` and `ifInfo` (helpers `officeIf`, `officeIfs`).
- **Minor 1 (retry reuse):** the recorded `if_create` is reused only if no other truck holds that IF (`takenByOthers(allTrucks(), id)`); otherwise a new IF is created. Test: first accept dies after the create, a manager puts IF 901 on another truck, the retry creates IF 902.
- **Minor 2 (test gap):** test with `failOn = 'if_stamp:901'`: accept throws, pallet stays flagged, claim cleared, one create, no stamp; retry stamps 901 once with no second create and completes. (Passed on the existing code: it is a regression test.)

Tests: `node --test "move_portal/test/*.test.js"`: 267 tests, 267 pass, 0 fail, no stray output (RED before the fix: 6 of the new/updated tests failed in `portal.test.js`).

Recorded for Jack: an office-planned IF with identical lines on the same TO can still be taken over by the matcher (kept as is until Stage 2 memo matching).

## Fix wave 2
Commit: `efbb904` `fix(flagged): stacked pending accepts on one IF line reserve their TO room once (highest target minus NetSuite's qty); a pending create stops reserving once the office IF exists`

- **Important (double reservation):** `pendingReservations` now groups pending `if_qty` ops by `toId|ifId|item` and reserves `max(0, max(op.to) - currentQty)` per group; `currentQty` is the IF line qty from `ns.ifInfo()` (falls back to the group's `op.from` if the IF is not in `ifInfo`). `ns.ifInfo()` is read at most once per call and only when a pending `if_qty` or `if_create` exists (the no-pending path does no reads).
- **Minor M1:** an `if_create` reservation is skipped when `findAddOnIf(op.toId, op.lines, info, trucks, null, {})` already finds the office IF (NetSuite's TO remaining counts it then).
- Tests (new, end of `portal.test.js`): two 12-pc YSN100 strays accepted pending onto IF9001 (504, targets 516 and 528), TO500 as the only open TO (48 left): a 25-pc pallet on a Riverside truck is `no_to`, a 24-pc pallet loads (`over`), i.e. exactly 24 reserved (the old code reserved 36). Plus a pending-create test: 1,100 YSN201 is `no_to` while it reserves, `addon` once the office IF 9100 exists. RED before the fix: both failed.
- Tests: `node --test "move_portal/test/*.test.js"`: 269 tests, 269 pass, 0 fail, no stray output.
