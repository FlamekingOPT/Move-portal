# Task 7 report

Status: DONE.

Implemented (verbatim from brief): define deps `./move_verify`, `./move_ns` in sl_move_portal.js; v3 helper block (before `const A`); actions truck_planned/start/get/scan/move_here/remove/undo, depart_preview/confirm/cancel/retry (manager-only); claimLoad message made generic. portal.test.js setup() injects verify + snapshot ns and 975/YSN100 item+config, returns ns. preview_server.js loads both deps.

TDD
- Step 1 (wiring only): `node --test "move_portal/test/*.test.js"` -> 93 pass, 0 fail.
- RED: after appending 6 new tests, `node --test move_portal/test/portal.test.js` -> pass 31, fail 6 (all six new tests failing, Unknown action).
- GREEN: full suite -> tests 99, pass 99, fail 0.

Files changed: move_portal/sl_move_portal.js, move_portal/test/portal.test.js, move_portal/test/preview_server.js.
Commit subject: feat(v3): truck load-out + departure actions with manager gate and write modes.

Self-review: no test expectations contradicted the brief code; no tests weakened. Old load/ship/receive actions untouched and pass.

Concerns: no `move_portal/move_ns.js` exists yet (tests/preview use the snapshot ns); the real NetSuite deployment needs it (later task). The brief's "10/14/2026" fake format gives Truck 1 · 10/14 as expected.

Addendum: claimLoad message change initially failed to apply (CRLF); applied after, which broke 3 old regexes (/already being (shipped|received) by someone else/). Updated them to /already being/ per brief step 5. Final commit b9f9241, 99/99 pass.

## Fix (review round 1)

Changes (sl_move_portal.js): depart_retry guarded (departing AND error-or-stale, else "still running") and takes a fresh claim; finishDepart(x, c, claim) re-checks the claim before every tx.apply and before moving pallets to in_transit; assertClaim message phase-neutral; depart_confirm refuses if the claimed truck already has data.depart; real errors logged via log.error and departPlan only wraps "No open transfer order covers" errors; depart records requestedBy; finish clears workingAt/claim/phase. Found while testing: updateLoad merges the patch over the passed (stale) load copy, so the onWrite/catch/final updates rewrote our claim over a stolen one and defeated the guard; they now use a fresh data.getLoad(x.id). A lost claim (userErr) is rethrown without saving data.error. fake_tx.js gained an `_t.onApply` hook.
Tests: 7 new tests (retry skips done keys, retry refused while running/loading, claim stolen mid-write, unplanned IF released, off-mode plan+alloc saved, manager trailer override + requestedBy, cancel reopens scanning + move_here from pending refused).

RED (new tests against the pre-fix sl_move_portal.js, implementation was written first then verified by reverting): `node --test "move_portal/test/portal.test.js"` -> pass 41, fail 3 (claim stolen mid-write, manager override/requestedBy, retry refused while running). The other four new tests cover behavior that already held and guard regressions.
GREEN: `node --test "move_portal/test/*.test.js"` -> tests 106, pass 106, fail 0.

## Fix (review round 2)

claimLoad(Ld, status, phase, mustBe) now re-reads the record, runs the optional `mustBe(cur)` guard before any write, and claims on top of the fresh copy (no stale merge). depart_confirm's guard refuses unless status is loading and there is no `depart` ("already departing"); depart_retry's guard requires departing + depart + (error or stale). Old callers unchanged. Dropped the dead `!e.user` condition. New tests: double-tap (getLoad hook makes the record already departing with depart/writes/claim after the confirm's first read; asserts refusal, record intact, no ops applied) and cleared claim/workingAt/phase after departure.
RED: with the previous sl_move_portal.js, `node --test "move_portal/test/portal.test.js"` -> pass 45, fail 1 (double-tap). GREEN: full suite `node --test "move_portal/test/*.test.js"` -> tests 108, pass 108, fail 0.
