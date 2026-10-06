# Task 13 report (Steps 1-4, 6-7; Step 5 skipped, controller does it)
Implemented: .gitignore entries, move_portal/local/local_store.js, rewritten move_portal/test/preview_server.js (verbatim from brief), store round-trip test appended to fake_data.test.js.
TDD: test first failed with "Cannot find module '../local/local_store'"; after the module, fake_data tests 3/3 pass.
Smoke: server started (0.0.0.0:8765, fixture snapshot, no snapshot dir). GET / ok (HTML), /?floor=1 page carries floor=1, POST truck_planned -> ok:true with planned IF9001 (B) and IF9002 (A) on TO500, open:[]. Stopped only that PID (port closed); deleted the generated store.json.
Full suite: 103 tests, 103 pass, 0 fail.
Files: .gitignore, move_portal/local/local_store.js, move_portal/test/preview_server.js, move_portal/test/fake_data.test.js.
Concerns: ns.resetCache is a no-op in snapshot ns; sl calls data.resetCache (fake data) - ran fine. Settings seed defaults locTo to 46 when snapshot lacks it. store.json seeded on first run persists; delete it to reseed after a new snapshot. launch.json unchanged.

## Fix (review round 1)
Atomic save (tmp+rename), clear error on corrupt store, save outside action try (failure logged, result still returned), mgrNow set right before runAction, items merged by SKU and trailers (incl. 543804, 487491) merged on every start, move-preview-beta in launch.json, store test extended (settings/seq, corrupt file, try/finally). Suite 103/103.
