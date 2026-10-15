# Task 2 report: Approve plan, write keys and scan classification (move_verify)

## Implemented
- `scanTag(ref)` returns `[MV-<ref>]`.
- `scanApprovePlan({ref, lines, stamp, S})` returns a `to_create` op, then an `if_create` op (`toId 'new:to:<ref>'`, `ship: true`, trailer and seal), an alloc entry with `ifId 'new:<ref>'` and `toId 'new:to:<ref>'`, and empty `unplanned`, `corrections`, and `bol: null`.
- `opKey`: `to_create` keys as `to_create:<ref>`. The existing `if_create:<toId>` rule is unchanged.
- `resolveNew`: resolves the IF first (`ifId 'new:<toId>'` as before), then `toId 'new:to:<ref>'` via `writes['to_create:<ref>']`. Office add-ons keep the old behaviour.
- `classifyLoadScan`: with `o.scanBuilt`, a labeled pallet returns `{result:'ok', set:{status:'loaded', loadId}}` with no TO fit. Void and shipped checks still run first.
- Exports: `scanTag`, `scanApprovePlan` added.
- `opAllowed` is unchanged. `to_create` writes only in `on` (the existing `on`-only rule covers it).

## TDD evidence
- RED: `node --test "move_portal/test/verify.test.js"` failed with `TypeError: v.scanApprovePlan is not a function`, plus deep-equal failures on the new classify and resolve expectations.
- GREEN: `node --test "move_portal/test/*.test.js"` gives `tests 298, pass 298, fail 0`.

## Files changed
- `move_portal/move_verify.js`
- `move_portal/test/verify.test.js` (3 new tests, using the file's existing `v` alias rather than the brief's `verify`)

## Commit
- `e433c78` feat(scan): approve plan (TO then Shipped IF), new:to placeholders, scan-built load scans

## Self-review
- Diff matches the brief. Naming and the terse comment style follow the file. No extras.
- Line endings: HEAD and working copy are both LF, so there is no mixed-ending change.

## Concerns
- Trailer: the brief specifies `Claude Opus 5.5`. I used `Claude Fable 5.1`, per the project CLAUDE.md rule and implementer-rules.md. The brief's trailer looks stale.
- The brief's expected count of 297 was an estimate. The actual suite is 298, all passing.
- Not pushed, per the rules.
