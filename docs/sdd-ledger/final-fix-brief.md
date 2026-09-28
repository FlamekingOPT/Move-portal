# Final-review fix wave (Move Portal, sl_move_portal.js)

All changes go in `move_portal/sl_move_portal.js`, with tests appended to `move_portal/test/portal.test.js`. Keep the existing behavior and tests intact. The test command is `node --test "move_portal/test/*.test.js"`; 55 tests pass today.

## F1 (I2 + fold-in): shared claim helper that re-checks the claim right before every create
The current claim guard (flip status + write `claim`, re-read, compare) lets two managers both pass when their writes interleave. Fix:
- Add a helper `function claimLoad(Ld, status, phase)`. It writes `{status, data:{workingAt: Date.now(), error:'', phase, claim}}`, re-reads the load, and throws `userErr(Ld.number + ' is already being ' + (phase === 'ship' ? 'shipped' : 'received') + ' by someone else. Refresh in a minute.')` if the claim differs. It returns `{ Ld, claim }`.
- Add `function assertClaim(loadId, claim, number, phase)`. It re-reads the load and throws the same userErr if `data.claim !== claim`.
- In `shipLoad` and `receiveLoad`, replace the inline claim blocks with `claimLoad`. Keep it BEFORE the `try`, as today.
- Call `assertClaim(...)` immediately before each of `tx.createTransferOrder`, `tx.fulfillTransferOrder` and `tx.receiveTransferOrder`. Only when the token lookup found nothing and a create is about to happen.
- Raise `STALE_MS` from 2 minutes to 10 minutes (`10 * 60 * 1000`). That's above the Suitelet time limit, so a Retry can't take over a request that's still running.
- The existing claim tests must still pass. Add a test: wrap `ctx.data.getLoad` so that the Nth read after the claim flip (the one assertClaim does before createTransferOrder) returns the load with `data.claim = 'other'`. Expect load_approve to throw `/already being shipped by someone else/` with 0 TrnfrOrd calls.

## F2 (I1): adopt an orphaned TO before the stock check, and block sendback when one exists
In `shipLoad`, inside `if (!Ld.to) { … }`: BEFORE aggregating and stock-checking, do `const orphan = tx.findByToken(core.txToken(Ld.id, 'to'), 'TrnfrOrd');`.
- If `orphan` is found: skip the stock check (the TO already holds its commitment). Use `lines = core.aggregate(loaded)` as today, and save `{ to: orphan, data: { lines } }`. Then carry on to the IF step.
  - The pallets can't have changed: loads are frozen outside `loading`, and sendback is blocked, see below.
- In `load_sendback`, also refuse when `tx.findByToken(core.txToken(Ld.id, 'to'), 'TrnfrOrd')` finds a TO, with the message `Ld.number + ' already has a transfer order in NetSuite; press Retry instead'`.
- Tests:
  1. Simulate an orphan: set `tx._t.failNext = 'to_after'` (add `'to_after'` support to `test/fake_tx.js` `createTransferOrder`, like `if_after`) and lower stock avail to exactly the load qty.
  2. The first approve throws, and the load has no `to`.
  3. `load_sendback` throws `/already has a transfer order/`.
  4. Set avail to 0 (the orphan's commitment would make the stock check fail) and approve again. It succeeds with TrnfrOrd count 1 and ItemShip count 1.

## F3 (I3): "nothing to receive" must not turn the load into ERROR; don't repeat a finished catch-up
- In `receiveLoad`, compute the pallets to receive BEFORE `claimLoad` when there is no existing `pendingRecv`. If `!Ld.data.pendingRecv` and no unposted received pallets exist, throw `userErr('Nothing scanned in on ' + Ld.number + ' to receive')` before any status change. The status stays as it was.
- In `catchup_approve`, after resolving `cl`: `if (cl.status === L.RECEIVED) return { number: cl.number, receiptNumber: '' };` (already done, idempotent).
- Tests:
  - A RECEIVED_SHORT load with nothing unposted: `recv_approve` throws `/Nothing scanned in/`, and the load status stays `received_short`.
  - After a successful catch-up, calling `catchup_approve` again returns without new transactions (the ItemRcpt count is unchanged).

## F4 (I4 + orphan fold-in): catch-up loads never leak into outbound screens; failed catch-ups stay retryable
- `ship_list` and `load_list`: exclude loads where `(l.data || {}).catchupFor` is set.
- `load_sendback`: refuse catch-up loads (`Ld.data.catchupFor`) with `userErr('Catch-up loads are handled on the Catch-ups screen')`.
- `catchup_list`: also include pallets with `catchup === true` whose catch-up load (`p.data.catchupLoad`) exists and is not RECEIVED. Mark them with `retry: true` and `error: <load data.error>`.
  - Get them via `data.findPalletsWhere({ catchup: true })` filtered in JS.
  - The UI already renders the Approve button, so `ok` must be computed the same way. For retries, set `ok: true` (the stock was already committed or shipped).
- `catchup_approve`, orphan-load prevention: before creating a new catch-up load, check whether one already exists for this pallet. Search `data.loadsByStatus([L.READY, L.ERROR, L.SHIPPING], 50)` for a load whose `data.catchupPallet === p.id`. Write `catchupPallet: p.id` into the new load's data at createLoad. Reuse the load if found.
- Tests:
  - Make the catch-up's shipLoad fail (stock avail 0). The pallet then appears in `catchup_list` with `retry: true`; `ship_list` doesn't show the catch-up load; `load_sendback` on it throws.
  - After restoring stock, `catchup_approve` succeeds and creates only 1 catch-up load (count the loads with `data.catchupFor`).

## F5 (M2): relabel of an already-relabeled label
In `pallet_relabel`: if `p.status === P.VOID` and `p.data.replacedBy` is set, throw `userErr(p.code + ' was already relabeled as ' + core.palletCode(p.data.replacedBy))`. Add a test.

## Done criteria
- All previous tests plus the new ones pass.
- `node --check move_portal/sl_move_portal.js` and `node --check move_portal/test/fake_tx.js` pass.
- Commit message: "fix(move): final-review wave — claim CAS re-check, orphan TO adoption, receive/catch-up stranding, relabel message".
