# Verify Load: final-review fix report

Branch `feat/v3-verification` (not pushed). Base `d9f4727`. Suite: `node --test "move_portal/test/*.test.js"` → **202/202 pass** (was 193), with clean output.

| # | Item | Commit | Tests (RED → GREEN) |
|---|------|--------|---------------------|
| 1 | Release must not strand in-transit pallets; release clears `verify` | `e2c9993` | `final1: release puts pallets a dying departure already moved in transit back…` (RED: 2 pallets stayed `in_transit`) · `final1: the release write clears the old verify…` (RED: old ready `verify` kept after a failed re-verify) |
| 2 | No re-alert on an unchanged re-Verify; a poll change is recorded as "Auto re-check" | `fde6673` | `final2: re-pressing Verify on an unchanged truck keeps verify at/by…` (RED: by became 'Bo') · `final2: a poll flip records Auto re-check…` (RED: by = 'Poller'). Existing test I2 updated: an unchanged manual verify now keeps by = 'Ana'. |
| 3 | Stage 2 cache: `ns.resetCache` in `runAction` and after a correction write | `edc44c9` | `final3: every action resets the ns cache; truck_correct resets it again after a write…` (RED: 0 resets). Checks: 1 reset per action; a refused write gives no extra reset; a successful write resets before the re-verify reads `plannedIfs`. |
| 4 | Spec §7: manager "add any IF" picker | `214ab38` | `final4: approvals lists every Picked/Packed IF no truck has…` (RED: `freeIfs` undefined) · ui `final fixes: manager add-any-IF picker…` (RED). The `api`/`data-act` cross-check stays green (`ACT.apaddany` added). |
| 5 | Verify during a correction: "being corrected by a manager, try again in a moment" | `01789ea` | `final5: verify while a manager correction holds the claim…` (RED: "closed for changes (departing)") |
| 6 | No `correctionWrites` done-skip for `if_qty` (kept for `if_create`) | `01a7c1e` | `final6: an if_qty correction with the same numbers is written again…` (RED: 1 write instead of 2). The existing dropped-add-on and new-numbers tests still pass. |
| 7 | Smoke launch config uses a repo-relative store; gitignored | `e16319c` | Config only. `git check-ignore` confirms `move_portal/local/smoke-store.json` is ignored (its `.tmp` is ignored too). |
| 8 | `esc()` around numeric ids in `data-id` | `214ab38` (with item 4) | ui `final fixes…` asserts no unescaped `p.id` or `x.truck.id` in `data-id` (RED → GREEN). |

## Implementation notes
- **1:** `depart_release` sets each `in_transit` pallet on the truck back to `loaded` (with `load` = the truck and `shippedDay` cleared) under the release claim. Then it writes `needs_fix` with `verify: null` and re-verifies. Pallets that `finishDepart` marked `left_at_dock` (sent back to `labeled`) are not restored, because they were never in the plan.
- **2:** `verifyTruck` keeps the old `at`/`by` when `changed` is false and a previous result exists. It still writes, so ready keeps clearing `correctError`. `AUTO_BY = {id: 0, name: 'Auto re-check'}` is used only when `opt.auto` is set, which only `trucks_recheck` passes. The truck card UI now shows `by.name` when `by` is an object (approvals already used `whoName`).
- **3:** a `wrote` flag is set in the `runOps` onWrite callback. That covers partial writes before an error too.
- **4:** `approvals` returns `freeIfs: [{ifId, ifNum, toNum, lines}]` from the `plannedIfs` read it already makes. It is computed only when there is at least one needs_fix truck, otherwise `[]`. Each needs-fix card gets a `<select id="apfree_<truckId>">` plus an Add button (`data-act="apaddany"`) that calls `truck_add_if`.
- **5:** a new `closedErr(x)` is used at both closed checks in `verifyTruck`, keyed on `claim && phase === 'correct' && !depart`.

## Concerns
- **Item 2 scope:** I read "poll-driven" as the background `trucks_recheck` only. `depart_preview` and `truck_correct` also use `poll: true` to avoid needless writes, but a person presses those. If they find a change, they record that person's actor, not "Auto re-check".
- **Item 8 went beyond the 4 listed spots:** I also escaped the other unescaped `data-id` values in `move_ui.js`: request `q.id`, truck-list `t.id`, unload `uother` `p.id` and `S.lastIn`. This changes no behavior.
- **Items 4 and 8 share one commit**, because both touch `move_ui.js` and are covered by one ui test.
- **IFs listed twice:** the picker lists every free IF, including ones the card already shows as suggestions, so an IF can appear twice. It's harmless and the server re-checks it.
- **No real `move_ns` module yet:** it doesn't exist (Stage 2). `ns.resetCache` is guarded with `if (ns.resetCache)`, and the snapshot ns has a no-op.
