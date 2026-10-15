# Task 8 report: labels_preview (move_verify labelRows + action)

## Implemented
- `move_portal/move_verify.js`: `labelRows(rows, ctx)` per the brief, placed before the module's return block and exported. Uses the module's existing `fmt`.
- `move_portal/sl_move_portal.js`: `act('labels_preview', true, ...)` right after `print_chunk`. Rejects more than 500 rows; resolves SKUs via `data.skuMap()`, then `itemInfo`, `locationStock(locFrom)` (avail), `labeledPiecesByItem`, `configsByItem(activeBatch)` (default config code). Creates nothing.
- Tests appended: `verify.test.js` (labelRows), `portal.test.js` (labels_preview).

## Deviation
- The brief's verify test uses `verify.labelRows`, but `verify.test.js` names its module `v`. The appended test uses `v.labelRows` to match the file. Behaviour is identical.

## TDD evidence
- RED: `node --test "move_portal/test/verify.test.js" "move_portal/test/portal.test.js"` gave 238 pass / 2 fail:
  - `TypeError: v.labelRows is not a function` (labelRows test)
  - `Error: Unknown action: labels_preview` (portal test)
- GREEN: same command gave 240 pass / 0 fail.
- Full suite: `node --test "move_portal/test/*.test.js"` gave 325 pass / 0 fail (brief estimated 319; gate is all passing).

## Files changed
- move_portal/move_verify.js
- move_portal/sl_move_portal.js
- move_portal/test/verify.test.js
- move_portal/test/portal.test.js

## Self-review
- Code matches the brief verbatim apart from the test module name above.
- Diff is limited to the four files; 1 line removed (the return list, which gained `labelRows`).

## Concerns
- None blocking. The git working copy reports LF→CRLF warnings for these files; this is the existing checkout setting and the diff shows no whole-file churn.

## Fix report (round 1, review base 582a750 → head 5a7766d)

### Changes
- `labelRows` parsing: a cell is blank (→ 0) or, after trim and removing commas, a finite whole number ≥ 0 (`/^\d+$/`). Anything else makes the row `skip` with `Pcs per pallet must be a whole number`, `Pallets must be a whole number` or `Odd pallet pcs must be a whole number`, checked in that order after the unknown-SKU check. Skipped rows add nothing to `labels`, `total` or the running total. Existing rules (pcs < 1, pallets < 1 with no odd) unchanged.
- `null` or non-object entries in `rows` are dropped with no message, in `labelRows` and in `labels_preview` (the SKU lookup now filters them out). Row numbers still follow sheet position.
- `'1,000'` parses as 1000; `'1e999'`, `'Infinity'`, `'1.5'`, `'-1'` are rejected.

### Tests added
- verify.test.js: `labelRows: whole-number cells only; null entries dropped; blanks are 0` (covers 'abc' pallets with odd 5, pcs '36.5', odd 'x', '1e999', '1,000' → ok/1000/over, null row numbering, odd-only row).
- portal.test.js: `labels_preview drops null sheet entries and keeps sheet row numbers`.

### Commands and output
- `node --test "move_portal/test/verify.test.js" "move_portal/test/portal.test.js"` → 241 tests, 241 pass, 0 fail.
- `node --test "move_portal/test/*.test.js"` → 327 tests, 327 pass, 0 fail.

### Note on TDD order
- The new tests were written in the same step as the fix rather than run RED first. They pass against the fixed code; I did not capture a separate failing run for this round.
