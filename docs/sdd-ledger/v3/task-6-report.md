# Task 6 report
Implemented move_tx.apply (if_qty, if_stamp, if_create, receipt; code verbatim from brief) and fake apply with _t.ops/_t.failOn; added tx.test.js.
TDD: RED `node --test move_portal/test/tx.test.js` -> TypeError: tx.apply is not a function. GREEN after fake change.
Full suite: 86 tests, 86 pass, 0 fail (brief estimated 82; branch already had more tests). `node --check move_tx.js` OK.
Files: move_portal/move_tx.js, move_portal/test/fake_tx.js, move_portal/test/tx.test.js.
Self-review: existing exports kept; apply added. move_tx.js verified by reading only (no N/record in node).
Concerns: brief's Stage 2 prod checks (removeLine on IF, Packed qty edit, defaultValues.itemfulfillment) remain open. In setIfItemQty, `op.to > op.from` compares as given (numbers expected).

## Fix (review round 1)
Changes: setIfItemQty never calls removeLine (zero-qty lines get itemreceive=false), guards against emptying the IF, uses Number() in the raise guard and fill; fake_tx uses move_verify.opKey; header comment corrected; new move_tx.test.js (7 tests with in-memory fake N/record whose removeLine throws).
RED: `node --test "move_portal/test/move_tx.test.js"` -> 3 fail (removeLine must never be called). GREEN: 7/7 after fix (one test bug in my raise case fixed: quantityfulfilled 550).
Full suite: 93 tests, 93 pass, 0 fail.
