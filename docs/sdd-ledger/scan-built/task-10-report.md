# Task 10 report
Implemented in move_portal/move_ui.js: scan-truck Approve/Reject card (shipConfirmCard), Reject prompt 'Reason for the floor (required)', retries Release text using t.toNum ('Release (after you Close TO8812 in NetSuite)', else 'Release to the floor' for scan trucks), Labels: odd-pallet input + non-blocking over-stock warning via labels_preview in skuprint, new 'Upload an Excel' section with labelUpload/readSheet/mapRows (header names trimmed, lowercased, inner whitespace collapsed; raw cell values passed through)/xlsxpick/xlsxprint/xlsxtemplate; SheetJS 0.18.5 from cdnjs.
TDD: RED = new test failed "missing ✅ Approve" with move_ui.js stashed. GREEN = full suite 331 pass, 0 fail.
Also updated the older 2026-10-06 pm test that pinned the labels section order (now includes lb_xlsx).
Self-review: edPayload rows carry sku (newLine has sku). csvObjs guards an empty file. Not browser-tested.

## Fix round 1
- Extracted `printSpecs(pv)` (ACT.xlsxprint uses it). New behavioural test 'excel upload helpers' extracts mapRows/csvObjs/printSpecs from the serialized client (brace-counting) and runs them in new Function: header matching, missing-column error, blank odd, CRLF CSV, header-only CSV, 3 specs summing n=6.
- 0 data rows: error "No data rows found", no Print button; pv.labels 0 shows "Nothing to print".
- Substring check: the Release text is built as 'Close ' + toNum (toNum already includes "TO"), so the literal 'Close TO' is not in the source; test checks 'Release (after you Close ' instead.
- Run: node --test "move_portal/test/*.test.js" -> 332 pass, 0 fail.
