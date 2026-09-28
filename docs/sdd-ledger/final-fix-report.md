# Final-review fix wave — report

Branch `feat/move-portal`, commit `c710724`. All changes in `move_portal/sl_move_portal.js`,
`move_portal/test/fake_tx.js` (comment only), and `move_portal/test/portal.test.js`.

Baseline before this wave: 55 tests passing. Final: 62 passing (0 failing).

## F1 (I2 + fold-in): shared claim helper, re-checked right before every create

**Change.** Added `claimLoad(Ld, status, phase)` — does the flip-then-reread that `shipLoad`/
`receiveLoad` each had inline, returns `{ Ld, claim }`, throws the "already being shipped/received
by someone else" `userErr` if the reread doesn't see its own claim. Added `assertClaim(loadId,
claim, number, phase)` — rereads the load and throws the same error if the claim no longer
matches. `shipLoad` and `receiveLoad` now call `claimLoad` where they used to do the flip inline.
`assertClaim` is called immediately before `tx.createTransferOrder`, `tx.fulfillTransferOrder` and
`tx.receiveTransferOrder` — but only on the branch where `findByToken` came back empty and a
create is about to happen (a token hit means we're adopting/retrying, not racing a fresh create).
`STALE_MS` raised from 2 to 10 minutes.

**Test added:** `a claim stolen right before the TO create is caught, not just at the initial
flip`. Wraps `data.getLoad` to count reads of the load once its status is `shipping`; the 1st such
read is `claimLoad`'s own reread (must see the real claim to get past it), the 2nd is
`assertClaim`'s read right before `createTransferOrder` — that one is swapped to return
`claim: 'someone-else'`. Asserts the throw matches `/already being shipped by someone else/` and
`TrnfrOrd` calls = 0.

**RED (before the fix, same test):**
```
✖ a claim stolen right before the TO create is caught, not just at the initial flip (1.36ms)
  AssertionError [ERR_ASSERTION]: Missing expected exception.
    expected: /already being shipped by someone else/
```
(Without `assertClaim` there's nothing between `claimLoad`'s check and the actual
`createTransferOrder` call, so the swapped-in stale claim on read #2 is never looked at — the TO
gets created anyway.)

**GREEN:** `✔ a claim stolen right before the TO create is caught, not just at the initial flip`.

The two pre-existing "refuses when another request claimed the load first" tests (ship and recv)
still pass unchanged — they simulate the *original* race (a competing write immediately after the
status flip) via a wrapped `updateLoad`, which `claimLoad`'s own reread still catches.

## F2 (I1): adopt an orphaned TO before the stock check; block sendback when one exists

**Change.** In `shipLoad`'s `if (!Ld.to)` block, `tx.findByToken(tok, 'TrnfrOrd')` is now looked
up *before* the stock/shortage check. If found (an orphan from a prior "TO saved, then crashed
before the load record was updated" run), it's adopted directly — the stock check is skipped
entirely, since the TO already holds that commitment. If not found, the stock check runs as
before, `assertClaim` runs, then the TO is created. `load_sendback` now also throws
`"<number> already has a transfer order in NetSuite; press Retry instead"` when
`findByToken(...,'TrnfrOrd')` finds one, even though `Ld.to` itself is still empty.

**Test added:** `an orphaned TO from a crash is adopted without re-checking stock, and blocks
sendback`. Sets avail to exactly the load qty, sets `tx._t.failNext = 'to_after'` (the fake
already supports any `<kind>_after` generically via `maybeFail` — see the fake_tx.js note below),
approves (throws "crashed after save", `Ld.to` stays empty, 1 `TrnfrOrd` call recorded), confirms
`load_sendback` throws `/already has a transfer order/`, then drops avail to 0 (simulating the
commitment already being spent) and re-approves — succeeds with exactly 1 `TrnfrOrd` and 1
`ItemShip` call.

**RED:**
```
✖ an orphaned TO from a crash is adopted without re-checking stock, and blocks sendback (0.99ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  + actual - expected
  + 'error'
  - 'MV-001'
```
(Old code re-ran the stock check on the retry; with avail forced to 0 it failed with "Not enough
available" instead of adopting the orphan and shipping.)

**GREEN:** `✔ an orphaned TO from a crash is adopted without re-checking stock, and blocks
sendback`.

## F3 (I3): "nothing to receive" must not error the load; a finished catch-up doesn't repeat

**Change 1 — `receiveLoad`.** The "is there anything unposted" check now runs *before*
`claimLoad`, only when `!Ld.data.pendingRecv`. If nothing qualifies it throws immediately, before
any status write — so the load's status is untouched (was: the check ran inside the `try`, after
the status had already flipped to `receiving_tx`, so the `catch` block flipped it to `error`).

**Change 2 — `catchup_approve`.** Added `if (cl.status === L.RECEIVED) return { number: cl.number,
receiptNumber: '' };` right after `cl` is resolved (new-load or existing), before the
ship/receive machinery runs. A second call on an already-finished catch-up now short-circuits
instead of calling `receiveLoad` again (which, per Change 1, would now throw "Nothing scanned in"
instead of silently erroring — either way it shouldn't be reached).

**Tests added:**
1. `recv_approve on a load with nothing left to receive fails without flipping it to error` —
   drives a load to `received_short` (2 of 3 pallets received), then calls `recv_approve` again
   with nothing new scanned; expects `/Nothing scanned in/` and the status to stay
   `received_short`.
2. `catchup_approve on an already-finished catch-up is a no-op` — completes a catch-up, then calls
   `catchup_approve` again on the same pallet; expects `receiptNumber: ''` and the `ItemRcpt` count
   unchanged.

**RED (test 1):**
```
✖ recv_approve on a load with nothing left to receive fails without flipping it to error
  AssertionError: Expected values to be strictly equal:
  + actual   'error'
  - expected 'received_short'
```
**RED (test 2):**
```
✖ catchup_approve on an already-finished catch-up is a no-op
  Error: Nothing scanned in on MV-001-C1 to receive
```
(This second failure is itself evidence the two changes are coupled the way the brief describes:
once Change 1 lands on its own, a second `catchup_approve` call without the early-return in Change
2 would now throw instead of silently mis-behaving — Change 2 is what makes it idempotent.)

**GREEN:** both tests pass; full suite green.

## F4 (I4 + orphan fold-in): catch-ups never leak into outbound screens; failed catch-ups stay retryable

**Changes.**
- `load_list` and `ship_list`: both now also filter out `!(l.data || {}).catchupFor`.
- `load_sendback`: refuses catch-up loads first, with `"Catch-up loads are handled on the
  Catch-ups screen"` (checked before the existing status/`Ld.to` check).
- `catchup_list`: in addition to the `ARRIVED_UNSHIPPED` pallets waiting to be approved, it now
  pulls `data.findPalletsWhere({ catchup: true })`, keeps the ones whose `data.catchupLoad`'s
  current status isn't `L.RECEIVED`, and appends them with `{ retry: true, ok: true, error:
  <that load's data.error> }`.
- `catchup_approve`: before creating a brand-new catch-up load, it now searches
  `data.loadsByStatus([L.READY, L.ERROR, L.SHIPPING], 50)` for one whose `data.catchupPallet ===
  String(p.id)` and reuses it if found. New loads now also write `catchupPallet: String(p.id)`
  into their data so a later retry (if the pallet-side `catchupLoad` write itself ever failed to
  land) can find its way back to the same load instead of creating a second one.

**Tests added:**
1. `a catch-up that fails to ship stays retryable and never leaks into outbound screens` — forces
   avail to 0 so the catch-up's own `shipLoad` throws "Not enough available"; confirms
   `catchup_list` now includes a `{ retry: true, ok: true }` row, `ship_list` does not list the
   catch-up load, and `load_sendback` on it throws `/Catch-up loads/`.
2. `after restoring stock, a retried catch-up succeeds and does not create a second catch-up load`
   — same setup, then restores stock and calls `catchup_approve` again; confirms it succeeds
   (`MV-001-C1`) and that exactly one load with `data.catchupFor` exists afterward.

**RED (test 1):**
```
✖ a catch-up that fails to ship stays retryable and never leaks into outbound screens
  AssertionError: The expression evaluated to a falsy value: assert.ok(retryRow)
```
Test 2 already passed even on the unfixed code — the pallet's own `data.catchupLoad` field is
written *before* `shipLoad` is called, so the natural retry path already finds the same load via
`p.data.catchupLoad` without needing the new `catchupPallet` search. That search is a second,
narrower line of defense for the case where the load got created but the pallet-side write never
landed (e.g. a crash between the two); the brief's own test description doesn't force that specific
gap open, and I did not fabricate a scenario beyond what's specified — flagging this as the one
place where the written test is weaker than the code change it's paired with (see Concerns).

**GREEN:** both tests pass; full suite green.

## F5 (M2): relabel of an already-relabeled label

**Change.** In `pallet_relabel`, right after `mustPallet`, added: if `p.status === P.VOID &&
p.data.replacedBy`, throw `userErr(p.code + ' was already relabeled as ' +
core.palletCode(p.data.replacedBy))`. Placed before the `job`/`np` lookup — without this guard, a
second call on the same original pallet finds the same `RL<id>` job already printed and silently
returns the same `{ job, code }` again with no error at all (the `if (!np)` and `if (p.status !==
P.VOID)` guards both become no-ops on repeat).

**Test added:** `relabeling an already-relabeled label is refused` — relabels a fresh pallet, then
relabels it again; expects a throw matching `/was already relabeled as <code>/`.

**RED:**
```
✖ relabeling an already-relabeled label is refused (2.09ms)
  AssertionError [ERR_ASSERTION]: Missing expected exception.
```
(Old code returned `{ job, code }` successfully a second time — no exception, so the required
`assert.throws` failed.)

**GREEN:** `✔ relabeling an already-relabeled label is refused`.

## fake_tx.js `'to_after'`

The brief asks for `'to_after'` support "like `if_after`" in `createTransferOrder`. I checked
first: `maybeFail(kind, fn)` already handles `kind + '_after'` generically for whatever kind string
is passed in, and `createTransferOrder` already calls `maybeFail('to', ...)` — so
`failNext = 'to_after'` already throws "TO crashed after save" *after* recording the call/memo,
exactly like `if_after` does for `fulfillTransferOrder`. I verified this directly in isolation
(`tx._t.failNext='to_after'; tx.createTransferOrder(...)` throws post-save with the call already
recorded, and a follow-up `findByToken` finds it) before writing F2's test against it. Since there
was no functional gap, I made no behavior change to `fake_tx.js` — only added a comment on
`maybeFail` documenting that `<kind>_after` is the generic crash-after-save simulation, so a future
reader doesn't wonder why `'to_after'` "just works" with no dedicated code.

## Final test output

```
ℹ tests 62
ℹ suites 0
ℹ pass 62
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

`node --check move_portal/sl_move_portal.js` — OK.
`node --check move_portal/test/fake_tx.js` — OK.

(The suite also runs `core.test.js`, `fake_data.test.js`, `template.test.js` and `ui.test.js`,
which is why the total is higher than "55 + 7" would suggest at a glance for `portal.test.js`
alone — the 55/62 counts are the full `node --test "move_portal/test/*.test.js"` totals as stated
in the brief.)

## Concerns

1. **F4's "orphan-load prevention" search is exercised by code inspection, not by a failing
   test.** The brief's own test recipe for F4 (fail once, restore stock, retry once, expect one
   `catchupFor` load) is satisfied by the pre-existing `p.data.catchupLoad` field alone — that
   field is written to the pallet in the same call that creates the load, before `shipLoad` is
   invoked, so a same-pallet retry always finds the load through it regardless of whether the new
   `data.catchupPallet` search exists. The new search only matters for a narrower crash window
   (load created, but the pallet-side `catchupLoad` write itself never landed — e.g. the request
   died between the two `data.*` calls). I implemented it as specified but did not fabricate a
   test that forces that specific window open (doing so would mean monkey-patching
   `data.updatePallet` mid-request in a way not described in the brief). Flagging so a reviewer can
   decide whether a more surgical test is worth adding, or whether the code-level defense is
   sufficient on its own.
2. **`STALE_MS` at 10 minutes** means a genuinely stuck (crashed mid-request, no catch block ever
   ran) load stays un-retryable for up to 10 minutes instead of 2. This is what the brief asks for
   ("above the Suitelet time limit"), just flagging the operational tradeoff (a real crash now
   blocks a manual retry for longer) in case that surprises whoever's on call.
3. No changes were made to `move_data.js`/`move_tx.js` (out of scope per the brief) — `catchup_approve`'s
   `data.loadsByStatus([...]).find(...)` and `catchup_list`'s `data.findPalletsWhere({catchup:true})`
   both already exist with matching signatures in the real `move_data.js`, so this should behave the
   same in NetSuite as it does against the fake, but that hasn't been verified against a live account.
