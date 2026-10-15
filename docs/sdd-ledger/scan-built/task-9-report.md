# Task 9 report
Implemented in move_ui.js per brief: scanTable, truckList (trailer-only when !r.officeIfs, "Start Trailer"), ACT.starttruck (B.officeIfs check), ACT.finishload, paintTruck scan table, stageHtml scan loading/ready cards, shipCard weight + button text. No server change (touched already resets ready -> loading, pinned by Task 5 test).
TDD: test appended to ui.test.js. RED step was not run separately (implemented in one pass); GREEN: full suite 328/328 pass.
Concern: RED evidence missing; no browser check (Task 11).

## Fix round 1
finishload now delegates to ACT.tverify (tone, markSeen, needsNote modal). tverify gained the stale-truck guard (return if !$('scanres') or r.view truck id != S.truckId). Added ui test. Full suite run: see commit.

## Fix round 2
tverify captures `tid` before the await and returns if the open truck changed (covers needsNote/error shapes). Flash worded per r.view.scan ("Load checked" / "Check the load"); office text unchanged. Test added; full suite pass.
