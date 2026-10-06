# Final whole-branch review: fix wave report

Code commit: `27404ae` (fix(portal): final review wave). Docs commit follows it (CLAUDE.md, ledger line, this report).

## What changed

- **F1 settlePending claim.** `settlePending` now takes `claimLoad(cur, null, 'settle', decideGuard, {})` for each pallet whose `pendingDone` is truthy (a refused claim or an in-flight truck skips the pallet without throwing). After the claim it re-reads the pallet and only calls `completeAccept` if it is still `accepted_pending` with `flag === 'never_loaded'`, then releases the claim with a fresh read (`dropClaim` on failure, error rethrown to the caller's per-truck catch). `completeAccept` itself re-reads the pallet and throws `userErr('That pallet was already decided')` if the decision is already `accepted`. Note: a truck in `approving` is now skipped by settle (decideGuard only allows unloadable statuses).
- **F2 withdraw a pending accept.** `mustFlaggedOn(x, palletId, allowPending)`; `pallet_reject` passes `true`. Rejecting a pending pallet removes its `pending: true` correction entry, sets the decision to rejected with text `↩ Rejected · "<note>" · pending accept withdrawn · back to labeled`, clears the flag and drops it from `flagged`. The claim re-check also refuses if the pallet flipped between pending and non-pending since the first read. `pallet_accept` still refuses a pending pallet.
- **F3 locked-truck guard.** `mustFlaggedOn` throws `That pallet is on <truck>, which is waiting for ship confirmation: confirm or send back that truck first` when the pallet is `loaded` on a truck that fails `isOpen` (covers accept and reject).
- **F4 block inside the claim.** `receipt_approve` checks `blockReasonOf(cur)` inside the `claimLoad` guard, keeping the pre-claim check as a fail-fast.
- **F5 flagged pallet at Riverside.** `truck_scan` (load mode) refuses a pallet with `decision.kind === 'accepted_pending'` or `flag === 'never_loaded'`: result `flagged_tippecanoe`, tone `bad` (explicit), scan logged, nothing loaded. `move_ui.js` load-scan switch shows `❌ Flagged at Tippecanoe` / `A manager is deciding this pallet in Approvals. Set it aside.` (`verify.toneFor` untouched: the tone is returned explicitly.)
- **F6 docs.** CLAUDE.md: `setIfItemQty` on a Shipped (C) IF added to the Stage 2 / ON-MODE GATE line; beta note that the stand-in's writes live only in memory. Ledger: final-review line added to the dashboard block.

## Tests

New in `move_portal/test/portal.test.js` (6): F1 overlapping approvals (hook on `ns.ifInfo`, alloc 516 once, received once, no claim left), F1 completeAccept re-decide refused, F2 withdraw (receipt unblocks, TO room freed: a Riverside scan that was `no_to` becomes `addon`), F3 accept and reject refused on a `ship_pending` truck, F4 pallet flagged mid-request still blocks the approve with no claim left, F5 flagged and pending pallets refused at Riverside. `move_portal/test/ui.test.js`: asserts `Flagged at Tippecanoe` and the `flagged_tippecanoe` case.

Command: `node --test "move_portal/test/*.test.js"` → 282 pass, 0 fail (276 before), output pristine.
