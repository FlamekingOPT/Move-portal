# Task 6 report
Implemented per brief in sl_move_portal.js (departPlan scan branch, ship_confirm stock block, finishDepart resolveNew + ids, depart_release TO-closed guard, approvalsView scan/lines/lbs and retries scan/toId/canRelease) and 7 new tests in portal.test.js.
RED: new tests failed (office plan path, truck went needs_fix). GREEN: `node --test "move_portal/test/*.test.js"` -> pass 316, fail 0.
Deviation: in the Retry test I set `ctx.tx._t.failOn = null` before depart_retry (the brief's test left the predicate failing every if_create).
Mid-way a quote-escape slip broke the file's syntax; fixed.

## Fix round 1
- Each Approve attempt has data.approveRef (load id, then '<id>-R<n>' after the n-th Release; data.releases counts). departPlan/departData/finishDepart/depart_release/retries all key on ref.
- tx.findTo(token) added to move_tx (exported) and fake_tx (_t.tags); Release refuses while an unrecorded TO with the current tag is open.
- "Close TO..." message and retries[i].toNum use tx.tranIds number.
- Tests added: fresh TO token '[MV-<id>-R1]' after Release; Release refused on open unrecorded tagged TO; Release refused once IF exists with canRelease false. Removed the redundant failOn=null (my earlier explanation was wrong; the fake clears failOn after firing).
- `node --test "move_portal/test/*.test.js"`: pass 319, fail 0.
