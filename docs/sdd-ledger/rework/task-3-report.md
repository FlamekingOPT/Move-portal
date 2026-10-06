# Task 3 report: approvals split, local on-hand, Task 2 minors

**Status:** Done. Commit `47b8f0d` on `feat/v3-verification`, not pushed. It carries the Fable 5.1 trailer.
**Suite:** `node --test "move_portal/test/*.test.js"` → **223/223 pass**, and the output is pristine.

## TDD evidence
- **RED:** after adding the new and edited tests, 223 tests ran: 212 passed and 11 failed. The failures were the 2 brief tests, 3 extra approvals/minor tests, the unload-reason test, `buildReads.onHand`, and 4 existing tests edited to the new shape or messages.
- **The retargeted `toNeedsFix (pending)` test passed at once.** The Task 2 code already had that branch; the test now actually reaches it.
- **GREEN:** after the implementation, 1 failure was left. `core.parseNsStamp` now also returns `minute`, so the `core.test.js` expectations got `minute` added. Then 223/223.

## Implementation
**`approvals`** now returns `{shipPending, fixes, trucks, retries, receipts, freeIfs, writeMode}`. `needsFix` is removed.
- **`fixes`:** one entry per `if_short` / `if_over` / `no_if` diff on every `needs_fix` truck.
  - Built from `pubDiffs`, with SKU names looked up in one batch (as before).
  - Fields: `{truckId, truckLabel, key, kind, text, ifId?, ifNum?, toNum?, toId?, item?, sku?, shortNote, corrections, correctError}`.
  - `corrections` holds only that key's entries. `toId`, `item` and `sku` are extras; the Correct UI uses `toId` for `no_if`.
- **`trucks`:** one entry per `needs_fix` truck.
  - Fields: `{truck, trailer, ifs: [{ifId, ifNum, toNum, lines, gone, empty}], suggestions, orphans, verifiedBy, verifiedAt}`.
  - Extras: `stuck`, `correctError` and `shortNote`, so a truck with only gone or empty IFs (and so no fix entry) still shows them.
  - `gone` and `empty` come from the stored `if_gone` / `if_empty` diffs, or from the IF's own `gone` flag.
- **`shipPending[]`** gains `ageMin`. It uses a new `minutesSince(stamp, c)` that compares `core.parseNsStamp(shipReq.at)` with `c.now.stamp`. `parseNsStamp` now also returns `minute`; that is additive, and `core.test.js` was updated.

**`move_verify.js`**
- `SQL().onHand` is the brief's `aggregateItemLocation` query.
- `buildReads().onHand()` returns `{item: qty}`, or `{}` when the snapshot has no `onHand` rows.
- New `sealHolder(trucks, seal, exceptId)`. `sealUsed` now calls it.
- `classifyUnloadScan`: a loaded pallet on a `ship_pending` truck returns `{result: 'locked', reason: 'ship_pending', otherTruckId, otherLabel}`.

**`sl_move_portal.js`, Task 2 minors**
- `ship_mark` refuses an empty `data.trailer` with "Enter the trailer # (start the truck again with its trailer)".
- A seal collision now says "Seal X is already on Trailer Y". It uses the holder's `depart.trailer` or `data.trailer`, and falls back to `truckLabel`.

**`preview_server.js`**
- On every start it sets `db.stock[locFrom]` from `ns.onHand()` (`avail` = `onHand`). It does this only when the snapshot has `onHand` rows; otherwise the stock is left as it is.
- Snapshot items are merged by SKU: new ones are added, and existing ones get their `desc` updated.

**`move_ui.js`: minimal bridge until Task 5**
- `SCREENS.approve` uses a new `fixCards(r)` to rebuild the old one-card-per-truck input from `r.trucks` plus `r.fixes`.
  - Drop rows are made from IFs flagged `gone` or `empty`.
  - Corrections are merged across the truck's fixes.
  - `writeMode` comes from `r.writeMode`.
- The unload `locked` result with `reason === 'ship_pending'` now says "Trailer X is waiting for a manager to confirm shipping".

## Smoke test (preview server on :8799)
- Setup: a temp store and a temp copy of the test fixture with `onHand` rows (975 → 12000, 11 → 300).
- Then: commit and activate one config (YSN100 A 12) through the API, and call `plan`.
- **Result:** `rows = [YSN100 A 12 → 1000 pallets left]` and `noConfig = [YSN201]`.
- Restarted with the plain fixture (no `onHand` rows): the stock was kept and the same plan came back.
- I stopped only my own PIDs and deleted the temp store. :8765 and :8798 were not touched.

## Existing tests changed
- `approvals lists needs_fix trucks with instruction text`: now asserts `fixes[0].truckId`, `trucks[0].truck.id` and `fixes[0].text`.
- `approvals needs_fix entry says who verified and when`: reads `trucks[0]`.
- `truck_correct: a refused write surfaces correctError…`: reads `fixes[0].correctError`, and now also checks `fixes[0].corrections` keys.
- `a dropped add-on IF is not created again…`: reads `trucks[0].orphans`.
- `toNeedsFix refuses when the IFs changed…` is now `toNeedsFix (pending) refuses when the IFs changed while ship_confirm checked the marked truck`.
  - It marks first, then arms the `plannedIfs` hook so it fires inside `ship_confirm`'s pre-claim check.
  - It asserts the truck stays `ship_pending`, with no claim and its `shipReq` kept.
- `a pallet taken off right after the claim…` now also asserts `shipReq` is `null` after the post-claim mismatch.
- The seal-collision asserts in `depart: exact match…` and `ship_pending: holds its seal…` now expect "Seal X is already on Trailer …".
- `core.test.js` `parseNsStamp`: expectations now include `minute`.

## New tests
- The brief's 2: `approvals: fixes per diff…` and `buildReads.onHand and SQL.onHand`.
- `approvals: top-level keys; trucks flag empty/gone IFs; fixes skip diffs that are not if_short/if_over/no_if`.
- `ship_mark refuses a truck with no trailer; shipPending carries ageMin`. A mark at 1:30:05 pm with now at 2:14:05 pm gives 44.
- `unload scan of a pallet on a ship_pending truck: locked, with its label and reason`.

## Concerns
1. **The snapshot refresh has to pull `onHand` too.** The "refresh the move snapshot" procedure should add the `SQL().onHand` query. Its items query should also include the `onHand` item ids; otherwise SKUs not on any IF or TO show as their bare item id in the plan.
2. **`ageMin` ignores time zones.** Both stamps are LA-time NetSuite text, so the difference is right; it would be off by an hour across a DST change.
3. **The UI bridge is not a design.** It keeps the old Needs IF fix card working off the new keys until Task 5. Diffs other than fixes and gone/empty IFs (for example `no_ifs`, `plan_mismatch`) no longer show as rows on that card.
