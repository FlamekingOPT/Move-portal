# Task 11 report (code part: snapshot_ns stand-in)

Scope: Steps 1-4 only. Not done (per controller ruling): preview server, click-through, CLAUDE.md edits, push.

## Implemented
- `move_portal/local/snapshot_ns.js` `applyOp`:
  - New `to_create` branch: appends one approved-style TO line per item (tostatus 'B', id = max toid or 80000, +1); returns the new TO id as a string.
  - `if_create` now uses `status: op.ship === true ? 'C' : 'B'` (Shipped when `ship: true`, Packed otherwise).
  - Header comment updated to describe the new branch.
- `move_portal/test/verify.test.js`: new test "local snapshot_ns.applyOp: to_create returns a TO id; a Shipped if_create lands as status C on that TO", placed after the existing applyOp test. Uses the file's `v` alias and `fixtures/snapshot_sample.json`, as the existing test does (the brief's `verify`/inline raw object was adapted to match the file).

## TDD evidence
- RED: `node --test "move_portal/test/*.test.js"` before the implementation. The new test failed with `AssertionError [ERR_ASSERTION]: The expression evaluated to a falsy value` (`Number(toId) > 0` with `to_create` returning undefined). All other tests passed.
- GREEN: same command after the implementation: `tests 333, pass 333, fail 0`.

## Commit
- `4307fd9 feat(beta): stand-in creates scan-built TOs and Shipped IFs`
- Files: `move_portal/local/snapshot_ns.js`, `move_portal/test/verify.test.js` only.
- Trailer: `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` (per CLAUDE.md; the system reminder asked for Haiku 5.5, but CLAUDE.md takes precedence for this repo).
- Not pushed.

## Self-review
- `if_create` without `ship` still yields status 'B' (existing test covers the Packed path).
- `plannedIfs()` excludes the Shipped IF (asserted in the new test).
- `to_create` does not touch `raw.ifLines`; `reads` is rebuilt after every op, so the new TO is visible to subsequent reads.
- Minor: `to_create` does not check `op.ref`. The brief did not require it and the beta has no use for it.

## Concerns
- None blocking. The brief's inline test used a different helper signature (`makeSnapshotNs(verify, {...})` with an object); I used the file's existing path-or-fixture pattern instead. Behavior under test is the same.
- The post-edit hook asked for preview_start; skipped per the controller's scope ruling.
