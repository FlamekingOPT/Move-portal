# Label print (local beta) report
- New `move_portal/local/label_html.js` (`labelsHtml(pallets, {header, fromName, toName, core})`), tests in `move_portal/test/label_html.test.js` (5 tests).
- `preview_server.js`: `action=pdf` returns printable 4x6 HTML (job or ids selection mirrors `sl_move_portal.js pdf()`, void excluded); new `--port` arg (default 8765). `--store` already existed.
- QR via qrcode-generator@1.4.4 CDN, payload = `core.barcodePayload`, stored in `data-payload` with TABs as `&#9;`. Header card per run of equal summaries, like the BFO template. Auto print after render; on-screen tip hidden in print.
- Tests: 138/138 pass (133 + 5).
- Smoke test on port 8799 with a temp store: print_chunk made 2 pallets; pdf HTML had header card, 2 labels, payloads `PLT101<tab>YSN401<tab>48`. Server PID stopped, temp store deleted.
- Not verified: visual print in a real browser (needs CDN access).
