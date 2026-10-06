# Task 4 report: Correct the IF + Packed add-on IFs + needs-fix approvals

**Status:** DONE. Commit `f687a7c` on `feat/v3-verification` (not pushed).
**Suite:** `node --test "move_portal/test/*.test.js"` gives **181/181 pass**, with pristine output. It was 173 before: the brief's 3 portal tests + 1 move_tx test, plus 4 extra tests of mine.

## TDD evidence
- **RED:** I added the 4 brief tests (3 portal, 1 move_tx) plus a refusal test, and all 5 failed for the expected reasons:
  - `Unknown action: truck_correct`;
  - `approvals` had no `needsFix`;
  - shipstatus was `C`, not `B`.
- **GREEN:** after implementing, 178/178.
- I then added these tests:
  - **The `on`-mode attach is kept when NetSuite returns the new IF.** The truck goes ready, `data.ifs` holds 901 and 9001, and `correctionWrites['if_create:700'].id = 901`. Two test bugs had to be fixed on the way: the id was read lazily inside a closure, and IFs sort by id. The code had no bug.
  - **A re-correction with the same opKey and new numbers is written again:** 504→480, then 504→492.
  - **Report "IF fix needed" rows** appear and then clear once the diff closes.
  - Final count: 181/181.

## What was built
- **`move_tx.createIf`:** with `op.ship === false` it sets shipstatus `B` and skips `stampOn`, so there is no container, custbody7 or memo. Otherwise nothing changed.
- **`truck_correct {truckId, keys?}`** (manager only):
  1. A stale claim left by `phase:'correct'` (older than 10 min) is cleared first. A live claim, a depart, or a truck that isn't `needs_fix` is refused.
  2. Re-verifies with `verifyTruck(..., {poll:true})`. If the truck now matches, it returns ready with no writes.
  3. Builds `correctionOps(diffs)`, filtered by `keys`. If nothing applies, it throws `userErr('Nothing the portal can correct here: …')`.
  4. Claims with `claimLoad(x, 'needs_fix', 'correct', guard, extra)`:
     - The guard requires `needs_fix`, no claim and no depart, with the IFs and the stored diffs unchanged since the check.
     - The extra writes `data.corrections` deduped by key (the newest entry wins) as `{key, op, by: c.user, at}` and clears `correctError`.
  5. If the loaded-pallet set changed between the check and the claim, it releases and returns "changed, Verify again".
  6. **`drop_if` is portal-only** and runs in every mode. The last live IF is never dropped (same rule as `truck_drop_if`); that op is returned in `skipped`.
  7. **The other ops go through `verify.runOps`** under `writeMode(c)`, with `assertClaim` before each apply. Several `no_if` diffs on the same TO are merged into **one** `if_create` (opKey `if_create:<toId>`).
  8. **`onWrite`** does a fresh read, then records `data.correctionWrites[key] = {id, sig, at, by}`. For an `if_create` it also attaches `{ifId, ifNum:'IF '+id, toId, toNum, status:'B', lines:[{item, sku, qty}]}` to `data.ifs` in the **same** update.
  9. Releases the claim (`claim:''`, `workingAt:0`, `phase:''`, `correctError`), then calls `verifyTruck`. It returns `{written, planOnly, skipped, verify:{match, diffs}, view}`.
  10. **A refused write** (anything that isn't a user error):
      - `log.error`;
      - `correctError` is saved and the claim released;
      - the re-verify is still attempted;
      - then `userErr('Correction refused: <msg> — fix it in NetSuite')`.

      Writes already made stay recorded and the truck stays `needs_fix`. A lost claim (a user error) is rethrown without touching state.
- **The done map is per op content:** `correctionWrites[key].sig` is `from>to` for `if_qty` and the lines JSON for `if_create`. An op only counts as done when its sig matches. Without this, a later correction of the same IF item (same `opKey`, new numbers) would be skipped forever as "already written". The separate `correctionWrites` map keeps these keys apart from the departure and receipt `writes`.
- **`approvals.needsFix`:** `[{truck, diffs (pubDiffs of the stored data.verify.diffs), suggestions, corrections, correctError, stuck, writeMode}]`.
  - It does one `palletsByStatus([LOADED])` read, grouped by truck, which feeds both the counts and pubDiffs' pallet counts.
  - It does one `ns.plannedIfs()` read, and only when a needs_fix truck exists.
  - It never re-verifies.
- **The report** adds rows `{check:'IF fix needed', ok:false, ifNum: op.ifNum || '(new)', portal: '<what>'}`. They cover each correction on a `needs_fix` truck whose op the current write mode doesn't allow and whose diff key is still open in the stored verify. This is done in the `report` action, not inside `shadowRows`. These rows have `seal: ''` and the truck is not departed, so they don't add to any day's `diffs` total.

## Concerns / notes for review
1. **A gap in add-on IF idempotence.** Suppose NetSuite saves the add-on IF but the request dies before `onWrite` records it. A retry would then create a second Packed IF. This is the same gap departure and receipt creates have. `setIfItemQty` is idempotent; `createIf` is not.
2. **A refusal during a multi-op correction stops the rest of the run** (`runOps` throws on the first failure). The ops written before it are kept; the later ones are never tried.
3. **The refusal test uses the fake's `failOn`.** The real "no TO room" refusal comes from `setIfItemQty`, which `move_tx.test.js` already covers.
4. **A re-verify that fails during the error path is swallowed** (user errors only), so the "Correction refused" message wins.
5. **No UI was added.** `move_ui` is outside this task's files, so the Approvals and Correct buttons still need wiring in a later task.
6. **The stale-claim takeover** writes `claim:''` to a just-read copy without a compare-and-set. Two requests racing there would both pass, but `claimLoad` then serializes them.

---

# Follow-up (coordinator, standing approval): commit `72c3ae4`
**Suite:** 184/184 pass, with pristine output. That's 181 plus 3 new tests; I also extended the `on`-mode attach test.

**TDD:** I wrote 4 failing tests first, and all 4 failed for the expected reasons:
- the move_tx token find;
- the attach test now checks the token and the new record keys;
- the dropped add-on;
- correctError cleared on ready.

After implementing, the suite was green.

## Changes
1. **Find before create** (`move_tx`):
   - `createIf` with `ship:false` and an `op.token` first runs `search.create` on transaction. The filters are: memo contains the token, mainline T, type ItemShip, createdfrom = toId, and status ItemShip:A/B (the old `findByToken` pattern).
   - If it finds one, it returns that id. If not, it creates the IF Packed with `memo = token`.
   - A shipped `if_create` never searches.
   - The token is `[mv:<truckId>:<opKey>:<item>x<qty>,...]`. I added the lines on purpose (see concerns).
2. **Dropped add-ons:**
   - `correctionWrites` is now keyed by `<opKey>|<sig>`, with the value `{key, op, id, sig, at, by}`.
   - `orphanCreates(x)` lists the recorded `if_create` ids that are no longer in `data.ifs`.
   - Correct skips an `if_create` whose opKey has an orphan, with `skipped: [{key, reason: 'already created as IF <id>: add it from the suggestions'}]`.
   - `skipped` is now objects everywhere; the last-IF drop skip carries a reason too.
   - `approvals.needsFix[].orphans` lists them.
3. **Report:** each orphan on any truck gets a row `{check: 'Dropped add-on IF', portal: 'Add-on IF <id> was dropped: delete or reuse it in NetSuite', ok: false}`.
4. **`verifyTruck`** writes `correctError: ''` whenever it writes `ready`.
5. **`approvals`** makes one `skuNames` call across every needs_fix truck. `pubDiffs` takes an optional pre-built SKU map.

## Concerns
- **Why the token includes the lines.** The token is `[mv:<truckId>:<opKey>]` plus the lines, not only `[mv:<truckId>:<opKey>]`. With only the opKey, a second add-on from the same TO for a different item on the same truck (possible once the first add-on is on the truck) would "find" the first IF and attach it again with the wrong lines. Including the lines keeps a retry idempotent and stops it from matching any other IF. It is still short, for example `[mv:12:if_create:700:11x120]`.
- **The memo is replaced at departure.** `stampShip` overwrites the memo with the truck memo. By then the IF is Shipped, so the A/B find would exclude it anyway.
- **An orphan blocks every later `if_create` from the same TO on that truck,** whatever the lines, until the IF is re-added through truck_add_if or the truck moves on. That is deliberate: re-add, don't duplicate.
- **An orphan row never goes away by itself.** It stays in the report even after the office deletes the IF in NetSuite, because nothing reads that back. A future cleanup could check `ns.ifInfo()`.
- **A Stage 2 prod check:** confirm that the search filter `status anyof ItemShip:A, ItemShip:B` and `createdfrom anyof <toId>` work on mainline transaction searches in prod.
