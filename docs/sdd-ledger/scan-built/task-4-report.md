# Task 4 report: Settings defaults and item weight in the data layers

Commit: 2462184 feat(scan): officeIfs/palletTare settings; items carry NetSuite weight

## Implemented
- move_data.js: DEFAULTS gains officeIfs false, palletTare 45. itemCols adds weight and weightunit; itemRow returns weight (Number, 0 if blank) and wunit (string). This flows to itemLookup, itemInfo and locationStock.
- move_verify.js: SQL.items selects i.weight AS weight, i.weightunit AS wunit. buildReads items() maps weight (Number, 0 if blank) and wunit.
- test/fake_data.js: db.settings gains officeIfs true, palletTare 45.
- test/move_data.test.js: new test using the file's existing setup() fake N/search. The settings row is { custrecord_mvs_data: '{}' }; the item row has weight '20' and weightunit '1'.
- test/verify.test.js: new SQL/reads test. The existing items deepEqual (line ~239) gained weight 0, wunit ''.

## TDD evidence
RED: node --test "move_portal/test/move_data.test.js" "move_portal/test/verify.test.js"
  - officeIfs: AssertionError, actual undefined, expected false
  - SQL.items: regex /i\.weight AS weight, i\.weightunit AS wunit/ did not match
GREEN: node --test "move_portal/test/*.test.js"
  - tests 304, pass 304, fail 0 (brief estimated 303)

## Files changed
move_portal/move_data.js, move_portal/move_verify.js, move_portal/test/fake_data.js, move_portal/test/move_data.test.js, move_portal/test/verify.test.js

## Self-review
- Line endings: all five files are CRLF throughout, matching HEAD.
- The move_data test uses the existing setup() helper unchanged; no rewrite was needed.
- Commit trailer is Claude Fable 5.1 per the implementer rules and the project CLAUDE.md. The brief's message said Opus 5.5.

## Concerns
- None blocking. Git prints "LF will be replaced by CRLF" warnings on every touched file. This is the existing repo setting and not caused by this change.
