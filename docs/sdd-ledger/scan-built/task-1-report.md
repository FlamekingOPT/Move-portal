# Task 1 report: pure rules for truck contents, weight and stock

Status: DONE

## Commit
- d3a26c4 feat(scan): pure rules for truck lines, weight and stock check

## Implemented
- move_core.js: officeIfs(S), palletTare(S) (default 45), exported. File is CRLF; edit preserved CRLF.
- move_verify.js: lbs, truckLines, linesPcs, truckWeight, stockCheck, stockText, added after sumLines and exported. Uses existing fmt.
- Tests appended: core.test.js (officeIfs/palletTare), verify.test.js (lbs, truckLines+truckWeight, stockCheck+stockText).

## TDD evidence
RED (before implementation), `node --test "move_portal/test/core.test.js" "move_portal/test/verify.test.js"`:
- TypeError: core.officeIfs is not a function
- TypeError: v.lbs is not a function
- TypeError: v.truckLines is not a function
- TypeError: v.stockCheck is not a function

GREEN, `node --test "move_portal/test/*.test.js"`: tests 295, pass 295, fail 0. (Baseline 291; brief's estimate 294; gate is all passing.)

## Files changed
- move_portal/move_core.js
- move_portal/move_verify.js
- move_portal/test/core.test.js
- move_portal/test/verify.test.js

## Self-review
- Implementation matches the brief verbatim except the LB_PER keys, which had to be quoted ('' '1' '2' '3' '4') in the file. The first attempt dropped the quotes through shell escaping and failed to parse; fixed before the green run.
- fmt is a hoisted function declaration, so stockText's use of it is safe.
- No callers yet (pure helpers only, per task).

## Concerns
- Commit trailer: the brief says Opus 5.5; the project CLAUDE.md says Claude Fable 5.1; the harness attribution says Haiku 5.5. I used Fable 5.1 (CLAUDE.md is the project's rule). Amend the trailer if the controller wants Opus 5.5.
- git warns "LF will be replaced by CRLF" for move_verify.js and the two test files. Those files were LF in the working copy before this task; the warning is a pre-existing line-ending/autocrlf setting, not introduced here.
