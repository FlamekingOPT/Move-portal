# Task 3 report: NetSuite writes (create TO, find by tag, TO closed check)

Status: DONE. Commit 9aed7a5 on feat/v3-verification (not pushed).

## Implemented
- move_tx.js:
  - `findByToken(tok, typeCode, more)`: transaction search on memo token, mainline, type.
  - `locationSubsidiary(locId)`: lookupFields on the location.
  - `createTransferOrder(op)` (`to_create`): finds an existing TO by `[MV-<ref>]` tag, else creates a TO (subsidiary, location, transferlocation, orderstatus, memo, one line per item) and saves it.
  - `createIf` (`if_create`, `ship: true` with token): finds an earlier Shipped IF on the TO (`ItemShip:C`, createdfrom toId) by token before transforming.
  - `toClosed(toId)`: true when orderstatus is `H`, every line `isclosed`, or the load throws RCRD_DSNT_EXIST / `no rec` (comment notes the latter is the fake only). False otherwise; `n > 0` required for the all-closed case.
  - `apply` handles `to_create` first. `tranIds` supports kind `'to'` (prefix TO, regex `/^(I[FR]|TO)/i`). Exports `toClosed`.
- test/fake_tx.js: `failOn` may be a predicate on the op; `closed: {}`; `toClosed`; `tranIds` handles `'to'`.
- test/move_tx.test.js: `create` fake, TO/Location `Type` keys and `lookupFields` added to `fakeSearch` (inside `setup()`, where it is declared); 4 new tests.

## Brief deviations (deliberate)
1. `to_create` returns '650' (the fake's created id), per the controller ruling.
2. Line order: the brief expects `[['975',504],['111',36]]`. `Object.keys` sorts integer-like item ids numerically, so the TO is built 111 then 975. The expectation in the test is `[['111',36],['975',504]]`. Line order is not significant to NetSuite.
3. `makeRec` in the test helper now treats missing `lines` as `[]` (`(lines || [])`). The brief's `toClosed` test calls `setup()` without `ifLines`, which otherwise throws in the helper before the code under test runs.

## TDD evidence
- RED: `node --test "move_portal/test/move_tx.test.js"` with the 4 new tests and no implementation: 4 failures (to_create, to_create find, if_create Shipped token, toClosed).
- GREEN: `node --test "move_portal/test/move_tx.test.js"`: 18 tests, 18 pass.
- Full: `node --test "move_portal/test/*.test.js"`: 302 tests, 302 pass, 0 fail.

## Files changed
- move_portal/move_tx.js
- move_portal/test/fake_tx.js
- move_portal/test/move_tx.test.js

## Self-review
- Names and idioms match the file (single quotes, 4-space indent, terse comments).
- No extra behaviour beyond the brief. `createIf` Shipped-token lookup runs only when `ship === true && token`, so the existing no-token paths make no extra search.
- Not verified against real NetSuite: `search.Type.LOCATION` and `lookupFields` on a location for `subsidiary` are used as the brief specifies; the sandbox has not exercised them.

## Concerns
- `findByToken` for `TrnfrOrd` matches any transaction whose memo contains the token and is mainline. The token is `[MV-<ref>]`, so a ref collision across days could match an old TO. Refs are expected to be unique per load; confirm in the Task 2 ops if that matters.
- The commit trailer follows the project CLAUDE.md (Claude Fable 5.1), not the brief's Opus 5.5 line.
